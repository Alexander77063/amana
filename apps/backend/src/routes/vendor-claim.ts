import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { parseBody } from '../lib/validate';
import { vendorClaimService } from '../modules/vendors/vendor-claim.service';

const PHONE_RE = /^\+\d{10,15}$/;

const RequestSchema = z.object({
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'invalid_account_number'),
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
});

const VerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1).max(10),
  category: z.string().min(1).max(64).nullable().default(null),
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
      case 'invalid_code':
        return c.json({ error: 'invalid_code' }, 401);
      case 'too_many_attempts':
        return c.json({ error: 'too_many_attempts' }, 401);
      case 'no_attempt':
        return c.json({ error: 'no_attempt' }, 404);
      case 'ownership_unproved':
        // 409, not 403: the caller proved they hold the phone. What failed is that NIBSS does not
        // link that phone to this account — a conflict with reality, and the ops queue's job now.
        return c.json({ error: 'ownership_unproved', detail: r.reason }, 409);
      case 'partner_down':
        return c.json({ error: 'anchor_unavailable' }, 503);
    }
  });
