import { SPEND_CATEGORIES } from '@amana/types';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { parseBody } from '../lib/validate';
import { vendorClaimService } from '../modules/vendors/vendor-claim.service';

const PHONE_RE = /^\+\d{10,15}$/;

/**
 * Zod needs a non-empty tuple; `SPEND_CATEGORIES` is the single source of the vocabulary. Derived
 * locally rather than importing the ready-made `SPEND_CATEGORY_VALUES`, which is `readonly
 * string[]` and so not assignable to `z.enum` — same reason `routes/retailer-portal.ts` re-derives.
 */
const SPEND_CATEGORY_VALUES = SPEND_CATEGORIES.map((c) => c.value) as [string, ...string[]];

const RequestSchema = z.object({
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'invalid_account_number'),
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
});

const VerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1).max(10),
  /**
   * Closed vocabulary, not free text. The claimed category REPLACES the app-supplied one before
   * `evaluateCategory` compares it (`modules/transactions/lifecycle.service.ts`), so an
   * unconstrained string is a vendor deciding whether someone else's spending lock applies: any
   * non-colliding value passes a blocklist, and `'Food'` or a trailing space silently denies a
   * legitimate spend under an allowlist. Same constraint, same reason, as `retailer-portal.ts`.
   */
  category: z.enum(SPEND_CATEGORY_VALUES).nullable().default(null),
});

/**
 * The vendor claim rail. Mounted at `/vendor-claim`, deliberately unauthenticated — the claimant
 * is a shopkeeper who has never used Amana and has no account to sign in to.
 *
 * Both endpoints are rate-limited in `server.ts`. An unrated OTP route is an SMS bill; an unrated
 * claim route is a way to walk the registry.
 *
 * `/request` returns the SAME body and status whether or not the account is in the registry. That
 * is not defensive vagueness — a distinguishable response would turn this endpoint into an oracle
 * for "has this account been paid by at least five Amana households", which is exactly the
 * aggregate the promotion threshold exists to keep private.
 */
export const vendorClaimRoute = new Hono()
  .post('/request', async (c) => {
    const body = await parseBody(c, RequestSchema);
    if (body instanceof Response) return body;
    await vendorClaimService.request(db, anchorAdapterSingleton, { ...body, now: new Date() });
    return c.json({ status: 'pending_verification' }, 202);
  })
  .post('/verify', async (c) => {
    const body = await parseBody(c, VerifySchema);
    if (body instanceof Response) return body;
    const r = await vendorClaimService.verify(db, anchorAdapterSingleton, {
      phone: body.phone,
      code: body.code,
      category: body.category,
      now: new Date(),
    });

    switch (r.kind) {
      case 'claimed':
        return c.json({ publicCode: r.publicCode, displayName: r.displayName }, 200);
      // `no_attempt`, `invalid_code` and `too_many_attempts` fall through to ONE byte-identical
      // response. The service keeps the three kinds apart because they mean different things
      // internally; on the wire they must not, because `verify` looks the attempt up BEFORE it
      // checks the code (`vendor-claim.service.ts`), so anything distinguishable here tells an
      // unauthenticated caller holding a junk code whether a bank account is a promoted registry
      // vendor — no control of the phone required. That is the same aggregate the uniform 202 on
      // `/request` exists to hide, so it cannot be readable here.
      //
      // `routes/auth.ts`'s `/otp/verify` collapses `no_challenge`/`wrong_code`/`wrong_purpose` for
      // the same reason but KEEPS `too_many_attempts` distinguishable, and that precedent stops
      // applying here: on `/auth` the exhausted-attempts answer guards nothing but the caller's
      // own challenge, whereas on this route it is reachable ONLY for a promoted `observed`
      // vendor — `verify` returns `no_attempt` before `verifyCode` ever runs when there is no
      // attempt row, and only `verifyCode` can produce `too_many_attempts`. Five junk `/verify`
      // calls answering `invalid_code` and a sixth answering `too_many_attempts` is the registry
      // membership bit again, read off the response body. What masks it today is a coincidence,
      // not a design: `OTP_MAX_ATTEMPTS` (5) happens to equal `RATE_LIMIT_OTP_PER_PHONE` (5) in an
      // IN-MEMORY, PER-INSTANCE limiter on a Fly app with `auto_start_machines = true`. A second
      // machine, or either constant being tuned, reopens it. Do NOT re-split these.
      //
      // NOTE — this closes the STATUS channel on `/verify` only, and the job is half done. The
      // cheapest residual needs no `/verify` call at all: `/request` sends the OTP to the
      // caller-supplied phone, so an attacker who submits their OWN number against someone else's
      // account simply observes whether an SMS arrives. A second, more expensive residual is that
      // the same attacker can then reach `409 ownership_unproved`, which stays distinguishable
      // from this 401 — two requests and a paid Anchor round trip. Both close together when
      // ownership is proved at `/request` and a code is sent only on a NIBSS match: see
      // **PRE-LAUNCH GATE 3** in `docs/runbook/vendor-claim.md`. Do NOT collapse the 409 and call
      // the gate met — that leaves the cheaper channel wide open.
      //
      // The timing channel is also still open here: `no_attempt` returns after one SELECT, while
      // `invalid_code` has paid for `argon2.verify` (argon2id, 64 MiB, t=3 — `modules/auth/
      // codes.ts`). Byte-identical, not time-identical. GATE 3 is what closes that too.
      case 'no_attempt':
      case 'invalid_code':
      case 'too_many_attempts':
        return c.json({ error: 'invalid_code' }, 401);
      case 'vendor_unavailable':
        // Reached only from BEHIND a verified OTP (the vendor stopped being `observed`, or the
        // claim compare-and-set lost a race), so it reveals nothing the 409 below does not — the
        // same gate, the same caller. Distinct because collapsing it into the 401 stranded a real
        // claimant: their code is already spent and their retry `/request` returns the uniform
        // 202 without sending another, so "invalid code" was permanent with no way out.
        return c.json({ error: 'vendor_unavailable' }, 409);
      case 'ownership_unproved':
        // 409, not 403: the caller proved they hold the phone. What failed is that NIBSS does not
        // link that phone to this account — a conflict with reality, and the ops queue's job now.
        return c.json({ error: 'ownership_unproved', detail: r.reason }, 409);
      case 'partner_down':
        return c.json({ error: 'anchor_unavailable' }, 503);
    }
  });
