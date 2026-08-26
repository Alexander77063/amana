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
      // `no_attempt` and `invalid_code` fall through to ONE byte-identical response, the same way
      // `routes/auth.ts`'s `/otp/verify` collapses no_challenge / wrong_code / wrong_purpose. The
      // service keeps the two kinds apart because they mean different things internally; on the
      // wire they must not, because `verify` looks the attempt up BEFORE it checks the code
      // (`vendor-claim.service.ts`), so a distinguishable 404 tells an unauthenticated caller
      // holding a junk code whether a bank account is a promoted registry vendor — one probe, no
      // control of the phone required. That is the same aggregate the uniform 202 on `/request`
      // exists to hide, so it cannot be readable here.
      //
      // NOTE — this closes the junk-code channel ONLY, and the job is half done. A caller who
      // supplies their own phone genuinely receives the OTP (it is sent to the number they
      // supplied), so they can still reach `409 ownership_unproved`, which stays distinguishable
      // from this 401 — and differs from it by a paid Anchor round trip besides. Closing that
      // needs the ownership proof moved to `/request`, which is a deliberate deferral, not an
      // oversight: see **PRE-LAUNCH GATE 3** in `docs/runbook/vendor-claim.md` for the residual,
      // the cost of the fix, and what must ship before launch. Do NOT collapse the 409 here.
      case 'no_attempt':
      case 'invalid_code':
        return c.json({ error: 'invalid_code' }, 401);
      case 'too_many_attempts':
        return c.json({ error: 'too_many_attempts' }, 401);
      case 'ownership_unproved':
        // 409, not 403: the caller proved they hold the phone. What failed is that NIBSS does not
        // link that phone to this account — a conflict with reality, and the ops queue's job now.
        return c.json({ error: 'ownership_unproved', detail: r.reason }, 409);
      case 'partner_down':
        return c.json({ error: 'anchor_unavailable' }, 503);
    }
  });
