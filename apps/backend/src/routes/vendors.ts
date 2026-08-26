import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { isOk } from '../lib/result';
import { parseBody, parseParams, parseQuery } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { decodeNqr } from '../modules/vendors/nqr-decoder';
import { recentsService } from '../modules/vendors/recents.service';
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

export const vendorsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
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
    return c.json(
      { error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400,
    );
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
    return c.json(
      { error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400,
    );
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
    // 5xx for the two partner-side facts, because neither is the caller's fault and a 4xx would
    // say it was. No `detail` on any of them: which upstream returned what is not the payer's
    // business, and `BAD_INPUT`'s message names our banking partner verbatim.
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'VENDOR_SUSPENDED'
          ? 410
          : result.error.code === 'VENDOR_ACCOUNT_GONE'
            ? 502
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
