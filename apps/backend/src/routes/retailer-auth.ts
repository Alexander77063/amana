import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { retailerAuthService } from '../modules/marketplace/retailer-auth.service';

const PHONE_RE = /^\+\d{8,15}$/;

const RequestSchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
});

const VerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1),
  /** Only needed the first time, when the owner's user row is created. */
  nin: z.string().optional(),
});

/**
 * Retailer portal sign-in. Mounted at `/retailer/auth`.
 *
 * Separate from `/auth` on purpose: that route creates households and consumes pairing codes,
 * neither of which means anything for a retailer, and the two mint different actor kinds.
 *
 * Both endpoints are rate-limited in `server.ts` — this is the only unauthenticated surface the
 * marketplace exposes, and an OTP endpoint without a limiter is an SMS bill and an enumeration
 * oracle.
 */
export const retailerAuthRoute = new Hono()
  .post('/otp/request', async (c) => {
    const body = await parseBody(c, RequestSchema);
    if (body instanceof Response) return body;
    const r = await retailerAuthService.requestCode(db, body.phone);
    // Always the same shape, whether or not this phone belongs to a retailer: the response must
    // not reveal which numbers run businesses on the platform.
    return c.json({ challengeId: r.challengeId, expiresAt: r.expiresAt.toISOString() }, 200);
  })
  .post('/otp/verify', async (c) => {
    const body = await parseBody(c, VerifySchema);
    if (body instanceof Response) return body;
    const r = await retailerAuthService.verify(db, body);

    switch (r.kind) {
      case 'too_many_attempts':
        return c.json({ error: 'too_many_attempts' }, 401);
      case 'invalid_code':
        return c.json({ error: 'invalid_code' }, 401);
      case 'nin_required':
        return c.json({ error: 'nin_required' }, 400);
      case 'no_retailer_for_phone':
        // 403 rather than 404: the caller proved they hold this phone, but it is attached to no
        // retailer they may enter. Saying which would leak the onboarding pipeline.
        return c.json({ error: 'no_retailer_for_phone' }, 403);
      default:
        return c.json(
          {
            accessToken: r.tokens.accessToken,
            refreshToken: r.tokens.refreshToken,
            accessExpiresAt: r.tokens.accessExpiresAt.toISOString(),
            refreshExpiresAt: r.tokens.refreshExpiresAt.toISOString(),
            retailer: {
              id: r.retailer.id,
              businessName: r.retailer.businessName,
              onboardingStatus: r.retailer.onboardingStatus,
            },
          },
          200,
        );
    }
  });
