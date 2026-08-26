import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { env } from '../env';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { logger } from '../lib/logger';
import { isOk } from '../lib/result';
import { parseBody, parseParams, parseQuery } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { rateLimit } from '../middleware/rate-limit';
import { decodeNqr } from '../modules/vendors/nqr-decoder';
import { recentsService } from '../modules/vendors/recents.service';
import type { ResolveError } from '../modules/vendors/types';
import { vendorResolutionService } from '../modules/vendors/vendor-resolution.service';
import { assertSubWalletAccess } from '../modules/wallet/wallet-access.service';

const NameEnquiryQuery = z.object({
  bankCode: z.string().min(1),
  accountNumber: z.string().min(1),
  subWalletId: z.string().uuid(),
});
const PhoneLookupQuery = z.object({
  phoneNumber: z.string().min(1),
  subWalletId: z.string().uuid(),
});
const StickerParams = z.object({ uuid: z.string().uuid() });
/**
 * `AMNV-` plus two 5-symbol groups. What this validates is the code's STRUCTURE — the prefix, the
 * two dashes, exactly five symbols per group. None of that can be repaired by normalization, so a
 * violation is genuinely malformed input and 400s here without ever reaching Postgres.
 *
 * The character class is deliberately the full alphanumeric set rather than the minted Crockford
 * alphabet, and it must stay that way:
 *
 * - `I`, `L` and `O` have to reach `vendorsRepo.findByPublicCode`, because that is where
 *   `normalizeCrockford` folds them onto `1`/`1`/`0`. Excluding them here would 400 exactly the
 *   transcription errors the alphabet was chosen to absorb, making the fold dead code.
 * - `U` has to reach the lookup too, for the opposite reason: it is excluded from the alphabet
 *   with no digit to fold into, so a `U` is a code character that cannot occur — a MISS, answered
 *   404, not malformed input. A payer standing in the shop is told "no such code", which is true,
 *   rather than "malformed", which is not.
 *
 * Once I/L/O/U all have to pass and the other 22 letters were never in question, no letter is
 * left to exclude. The `i` flag covers the `AMNV-` prefix as well as the groups: someone typing
 * the whole code by hand types `amnv-…`, and a case-sensitive prefix would reject it one
 * character before the interesting part.
 */
const VendorCodeParams = z.object({
  code: z
    .string()
    .trim()
    .regex(/^AMNV-[0-9A-Za-z]{5}-[0-9A-Za-z]{5}$/i, 'invalid_code'),
});
const SubWalletQuery = z.object({ subWalletId: z.string().uuid() });
const NqrDecodeBody = z.object({
  payload: z.string().min(1),
  subWalletId: z.string().uuid(),
});

/**
 * The shared failure response for the two NIBSS enquiry endpoints. It returns the error CODE and
 * nothing else — in particular, never the message.
 *
 * `nameEnquiryService` builds `BAD_INPUT`'s message as `Anchor <status>`: our banking partner
 * named, with its exact upstream status. Relayed to the caller that is free reconnaissance, and it
 * turns into a probing oracle the moment someone maps which inputs produce which upstream codes.
 * The variant itself is honest here and stays — on these paths the caller really did supply the
 * account number or the phone — so it is only the message that is withheld.
 *
 * Withheld, not discarded: an operator debugging a rejected enquiry needs the real status, so it
 * goes to the log. Identifiers go as named fields rather than interpolated into the message,
 * because the logger's redaction works on field paths and cannot reach inside a string — which is
 * why the phone is passed as `phone`, the exact key `redactConfig` censors.
 */
function enquiryFailure(c: Context, error: ResolveError, subject: Record<string, unknown>) {
  if ('message' in error) {
    logger.warn({ ...subject, code: error.code, err: error.message }, 'vendor enquiry rejected');
  }
  const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'PARTNER_DOWN' ? 503 : 400;
  return c.json({ error: error.code }, status);
}

export const vendorsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  /**
   * Every valid code costs one Anchor name enquiry, and that call runs through the SAME circuit
   * breaker as real payments — so unthrottled scans can trip the breaker and take spend down with
   * them. The pattern stays narrow (`/code/*`, not `*`) so `/recents` and the other spend-path
   * reads are untouched.
   *
   * Keyed on the authenticated account, not the client IP, and mounted HERE rather than in
   * `attachRateLimiters` because that is what makes the key possible: the app-level limiters are
   * registered before `app.route('/vendors', …)`, so `c.get('actor')` is still unset when they
   * run. Registering after `jwtAuth()` on this router is the only place the actor exists.
   *
   * Why it had to be per-actor rather than merely resized:
   *
   * - Nigerian carriers CGNAT heavily, so an IP key is shared by every subscriber behind one
   *   carrier egress address. This is a PAYMENT-PATH read: a false positive costs a payment, not
   *   a login retry, and it lands on whichever customer happens to be next through that NAT.
   * - An IP key does not bound the thing this limiter exists to protect anyway. The breaker is one
   *   global resource; per-IP × per-process × N Fly machines is unbounded in aggregate. A per-
   *   account key at least bounds what any one account can spend, which is the abuse shape that
   *   matters — a stranger cannot open an account per scan.
   *
   * Known and accepted: the limiter runs ahead of the handler, so a 404 or a malformed code spends
   * the same allowance as a real enquiry. Moving the accounting behind the handler means counting
   * only requests that actually reached Anchor, which the fixed-window store cannot express today;
   * it is the right change when this moves to Redis.
   *
   * (The earlier note here claimed per-actor keying was blocked by the access token being too
   * short-lived to key on. That was wrong twice over: the key is the `sub` claim — the user id,
   * stable for the life of the account — and the actual obstacle was the middleware ordering
   * described above. Recorded rather than deleted, because a false stated reason is what kept the
   * weaker key in place.)
   */
  .use(
    '/code/*',
    rateLimit({
      limit: env.RATE_LIMIT_AUTH_PER_IP,
      windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
      keyPrefix: 'vendor-code:actor',
      // `null` skips the limiter, which is how `RATE_LIMIT_ENABLED=false` still turns this one
      // off: the app-level limiters get that escape hatch from `attachRateLimiters` returning
      // early, and a route-level `.use` in a chain has no equivalent seam.
      key: (c) => (env.RATE_LIMIT_ENABLED ? (c.get('actor') as Actor).userId : null),
    }),
  )
  .get('/name-enquiry', async (c) => {
    const q = parseQuery(c, NameEnquiryQuery);
    if (q instanceof Response) return q;
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, q.subWalletId);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'account',
      bankCode: q.bankCode,
      accountNumber: q.accountNumber,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return enquiryFailure(c, result.error, {
      bankCode: q.bankCode,
      accountNumber: q.accountNumber,
    });
  })
  .get('/phone-lookup', async (c) => {
    const q = parseQuery(c, PhoneLookupQuery);
    if (q instanceof Response) return q;
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, q.subWalletId);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'phone',
      phoneNumber: q.phoneNumber,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return enquiryFailure(c, result.error, { phone: q.phoneNumber });
  })
  .get('/sticker/:uuid', async (c) => {
    const params = parseParams(c, StickerParams);
    if (params instanceof Response) return params;
    const q = parseQuery(c, SubWalletQuery);
    if (q instanceof Response) return q;
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, q.subWalletId);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'sticker',
      stickerUuid: params.uuid,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'STICKER_REVOKED'
          ? 410
          : result.error.code === 'STICKER_UNBOUND'
            ? 409
            : 400;
    return c.json({ error: result.error.code }, status);
  })
  .get('/code/:code', async (c) => {
    const params = parseParams(c, VendorCodeParams);
    if (params instanceof Response) return params;
    const q = parseQuery(c, SubWalletQuery);
    if (q instanceof Response) return q;
    // `jwtAuth` authenticates only. This is a spend-path read scoped to a sub-wallet, so it
    // authorizes by user identity against the resource, exactly as every sibling route does.
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, q.subWalletId);

    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'vendor',
      publicCode: params.code,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    // `vendorId` crosses to the client here, and that is safe only as an OUTPUT. Never accept it
    // back on a spend intent: a client-supplied vendor id would let a payer pick which merchant's
    // category rules get applied to their spend. The vendor is re-resolved server-side from the
    // bank code and account number at evaluation time — see `vendorCategoryResolver.resolve`.
    if (isOk(result)) return c.json(result.value, 200);

    // Distinct failures get distinct statuses — deliberately the opposite of the claim rail,
    // which collapses everything into one answer. There, an unauthenticated stranger was probing
    // whether a bank account is in the registry, so every failure had to look alike. Here the
    // caller is an authenticated user who has physically scanned a code in a shop: they already
    // know the shop exists, there is no aggregate left to protect, and collapsing these would
    // leave a real payer with no idea why their scan failed.
    //
    // 410 for a suspended vendor, matching `STICKER_REVOKED` above — the identical shape, a real
    // identifier whose subject has been withdrawn. (SP-V2 answers the same fact with 409 on the
    // claim rail, but that is a MUTATION conflicting with resource state, which is what 409 is
    // for. This is a read: there is no conflict, the subject is simply gone.) Task 3's public
    // page returns 410 for the same condition; one condition, one status, across both surfaces.
    //
    // The two partner-side facts split on ONE question: would retrying ever work?
    //
    // 409 for a dead bank account — "a conflict with reality", as SP-V2's `ownership_unproved`
    // puts it. It is terminal, so the status must not invite a retry, and both 5xx candidates do:
    // 502 and 503 alike sit in the default retry set for idempotent GETs in axios-retry and most
    // fetch wrappers. A 4xx is not blaming the payer here; it is telling them the shop's account
    // is the problem and no amount of trying again will fix it.
    //
    // 502 for a failed enquiry, which IS retryable — we could not get an answer, not "the answer
    // is no". Collapsing the two would erase exactly that difference.
    //
    // No `detail` on any of them: which upstream returned what is not the payer's business, and
    // `BAD_INPUT`'s message names our banking partner verbatim.
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'VENDOR_SUSPENDED'
          ? 410
          : result.error.code === 'VENDOR_ACCOUNT_GONE'
            ? 409
            : result.error.code === 'VENDOR_ENQUIRY_FAILED'
              ? 502
              : result.error.code === 'PARTNER_DOWN'
                ? 503
                : 400;
    return c.json({ error: result.error.code }, status);
  })
  .post('/nqr-decode', async (c) => {
    const body = await parseBody(c, NqrDecodeBody);
    if (body instanceof Response) return body;
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, body.subWalletId);
    const decoded = decodeNqr(body.payload);
    if (!isOk(decoded)) return c.json({ error: 'BAD_INPUT', detail: decoded.error.message }, 400);
    // Confirm via name enquiry path to get authoritative name + touch recents
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'nqr',
      payload: body.payload,
      subWalletId: body.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json({ error: result.error.code }, 400);
  })
  .get('/recents', async (c) => {
    const q = parseQuery(c, SubWalletQuery);
    if (q instanceof Response) return q;
    await assertSubWalletAccess(db, (c.get('actor') as Actor).userId, q.subWalletId);
    const list = await recentsService.listTop10(db, q.subWalletId);
    return c.json({ recents: list }, 200);
  });
