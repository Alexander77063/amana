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

/**
 * A phone and nothing else (PRE-LAUNCH GATE 3). The account moved to `/verify` so that no
 * registry-dependent decision — least of all "does an SMS go out" — happens before the caller has
 * proved they hold the phone.
 */
const RequestSchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
});

const VerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1).max(10),
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'invalid_account_number'),
  /**
   * Closed vocabulary, not free text. The claimed category REPLACES the app-supplied one before
   * `evaluateCategory` compares it (`modules/transactions/lifecycle.service.ts`), so an
   * unconstrained string is a vendor deciding whether someone else's spending lock applies: any
   * non-colliding value passes a blocklist, and `'Food'` or a trailing space silently denies a
   * legitimate spend under an allowlist. Same constraint, same reason, as `retailer-portal.ts`.
   */
  category: z.enum(SPEND_CATEGORY_VALUES).nullable().default(null),
  /**
   * The version of the terms + privacy notice the claimant was shown. Required: without it there
   * is no lawful basis to claim them (NDPA 2023). The client sends back what it displayed, so a
   * stale app cannot silently consent on the merchant's behalf to text it never rendered.
   */
  acceptedTermsVersion: z.string().min(1).max(40).optional(),
  /**
   * SEPARATE and optional, defaulting to false. Consent bundled with a different purpose is not
   * consent under the NDPA, so refusing this must cost the claimant nothing — and it does not:
   * the claim proceeds either way. See `PRICING.md` §8.1.
   */
  consentToLenderIntroduction: z.boolean().optional().default(false),
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
    await vendorClaimService.request(db, { phone: body.phone, now: new Date() });
    return c.json({ status: 'pending_verification' }, 202);
  })
  .post('/verify', async (c) => {
    const body = await parseBody(c, VerifySchema);
    if (body instanceof Response) return body;
    const r = await vendorClaimService.verify(db, anchorAdapterSingleton, {
      phone: body.phone,
      code: body.code,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
      category: body.category,
      acceptedTermsVersion: body.acceptedTermsVersion,
      consentToLenderIntroduction: body.consentToLenderIntroduction,
      now: new Date(),
    });

    switch (r.kind) {
      case 'claimed':
        return c.json({ publicCode: r.publicCode, displayName: r.displayName }, 200);
      // `invalid_code` and `too_many_attempts` fall through to ONE byte-identical response. The
      // service keeps them apart because they mean different things internally; on the wire they
      // must not.
      //
      // `routes/auth.ts`'s `/otp/verify` KEEPS `too_many_attempts` distinguishable, and that
      // precedent still does not apply here. On `/auth` the exhausted-attempts answer guards
      // nothing but the caller's own challenge. Here it would report that a phone had a live
      // `vendor_claim` challenge to exhaust — weaker than the old registry-membership leak, but
      // free, so there is no reason to give it away. What used to mask this was a coincidence
      // rather than a design: `OTP_MAX_ATTEMPTS` (5) happens to equal `RATE_LIMIT_OTP_PER_PHONE`
      // (5) in an IN-MEMORY, PER-INSTANCE limiter on a Fly app with `auto_start_machines = true`.
      // A second machine, or either constant being tuned, reopens it. Do NOT re-split these.
      //
      // GATE 3 (closed) is why this list is two kinds and not three. `no_attempt` used to sit here
      // — returned when the phone had no pending claim row, decided BEFORE the OTP was checked.
      // That was both a status channel and a timing one: it answered after a single SELECT, while
      // `invalid_code` had already paid for `argon2.verify` (argon2id, 64 MiB, t=3 —
      // `modules/auth/codes.ts`), so the two were byte-identical but never time-identical. Naming
      // the account at THIS endpoint instead of at `/request` removed the pre-OTP lookup
      // altogether, so the state cannot arise and both channels close with it.
      //
      // The residual, stated plainly: a caller who really does hold a phone can still tell
      // `vendor_unavailable` from `ownership_unproved` below and probe registry membership one
      // account at a time. That is the dearer channel — an OTP round trip per probe, bounded by
      // the per-phone limiter — and collapsing the two would take the actionable answer away from
      // an honest owner whose bank record simply does not match. See GATE 3's residual note in
      // `docs/runbook/vendor-claim.md`.
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
      case 'terms_not_accepted':
        // 400, not 409: this is a malformed submission the caller can correct, not a conflict with
        // the world. `requiredVersion` is returned so a client that shipped against older text can
        // tell it is stale rather than guessing. Safe to be explicit — it sits behind the verified
        // OTP like every other plain answer on this route.
        return c.json({ error: 'terms_not_accepted', requiredVersion: r.requiredVersion }, 400);
      case 'partner_down':
        return c.json({ error: 'anchor_unavailable' }, 503);
    }
  });
