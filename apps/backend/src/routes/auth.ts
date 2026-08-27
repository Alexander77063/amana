import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { otpService } from '../modules/auth/otp.service';
import { pairingService } from '../modules/auth/pairing.service';
import { sessionService } from '../modules/auth/session.service';
import { requiredTermsVersion, userConsentService } from '../modules/identity/user-consent.service';
import { usersRepo } from '../modules/identity/users.repo';

const PHONE_RE = /^\+\d{8,15}$/;

const OtpRequestSchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  purpose: z.enum(['login', 'pair']),
});

const OtpVerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1),
  pairingCode: z.string().optional(),
  nin: z.string().optional(),
  bvn: z.string().optional(),
  /**
   * The terms version the app displayed. Required when this call CREATES a user (either role);
   * ignored on an ordinary sign-in, because an existing user already accepted at sign-up and
   * re-prompting them is a separate flow that does not exist yet.
   */
  acceptedTermsVersion: z.string().min(1).max(40).optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
  userId: z.string().uuid(),
});

export const authRoute = new Hono()
  .post('/otp/request', async (c) => {
    const body = await parseBody(c, OtpRequestSchema);
    if (body instanceof Response) return body;
    const r = await otpService.requestCode(db, { phone: body.phone, purpose: body.purpose });
    return c.json({ challengeId: r.challengeId, expiresAt: r.expiresAt.toISOString() }, 200);
  })
  .post('/otp/verify', async (c) => {
    const body = await parseBody(c, OtpVerifySchema);
    if (body instanceof Response) return body;
    // This endpoint genuinely serves both flows in one place — with a pairingCode and no existing
    // user it creates an agent and consumes the pairing token, otherwise it logs in or creates a
    // principal. So `login` and `pair` remain interchangeable *within this endpoint*: both
    // challenges are minted for the same phone and are consumed by whoever holds that phone,
    // which is the same trust boundary either way. That is a bounded, deliberate residual, not an
    // oversight. What allowedPurposes closes off is *cross-endpoint* reuse — e.g. the retailer
    // portal, or any future purpose added on an unauthenticated endpoint, being satisfied by a
    // challenge minted here (or vice versa).
    const v = await otpService.verifyCode(db, {
      phone: body.phone,
      code: body.code,
      allowedPurposes: ['login', 'pair'],
    });
    if (v.kind !== 'verified') {
      // Collapse no_challenge / wrong_code / wrong_purpose into one generic error so a caller
      // can't distinguish "no OTP outstanding for this phone" from "wrong code" from "this code is
      // for a purpose this endpoint doesn't accept" (the last would otherwise leak which purpose a
      // phone currently holds a challenge for).
      const error = v.kind === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_code';
      return c.json({ error }, 401);
    }

    let user = await usersRepo.findByPhone(db, body.phone);

    // A retailer owner signs in at the portal, not here. Two front doors that mint different
    // actor kinds must stay separate: this route creates households and issues pairing-based
    // agent signups, neither of which means anything for a retailer, and silently accepting one
    // would hand a marketplace login a household session's shape.
    if (user?.role === 'retailer') {
      return c.json({ error: 'use_retailer_portal' }, 403);
    }

    if (!user && body.pairingCode) {
      if (!body.nin) return c.json({ error: 'nin_required_for_signup' }, 400);
      // Checked BEFORE the user row is created. A user that exists with no recorded acceptance is
      // someone whose data we are processing with no lawful basis — the gap this closes — and
      // creating them first would leave exactly that row behind on the error path.
      if (!userConsentService.isCurrentTermsVersion('agent', body.acceptedTermsVersion)) {
        return c.json(
          { error: 'terms_not_accepted', requiredVersion: requiredTermsVersion('agent') },
          400,
        );
      }
      user = await usersRepo.insert(db, {
        role: 'agent',
        phone: body.phone,
        nin: body.nin,
        kycTier: '1',
      });
      await userConsentService.recordAcceptance(db, {
        userId: user.id,
        termsVersion: requiredTermsVersion('agent'),
        source: 'signup',
        now: new Date(),
      });
      const consumed = await pairingService.consume(db, {
        code: body.pairingCode,
        agentUserId: user.id,
      });
      if (consumed.kind !== 'consumed')
        return c.json({ error: 'pairing_failed', reason: consumed.kind }, 400);
    }

    if (!user) {
      if (!body.nin || !body.bvn)
        return c.json({ error: 'nin_and_bvn_required_for_principal_signup' }, 400);
      if (!userConsentService.isCurrentTermsVersion('principal', body.acceptedTermsVersion)) {
        return c.json(
          { error: 'terms_not_accepted', requiredVersion: requiredTermsVersion('principal') },
          400,
        );
      }
      user = await usersRepo.insert(db, {
        role: 'principal',
        phone: body.phone,
        nin: body.nin,
        bvn: body.bvn,
        kycTier: '1',
      });
      await userConsentService.recordAcceptance(db, {
        userId: user.id,
        termsVersion: requiredTermsVersion('principal'),
        source: 'signup',
        now: new Date(),
      });
    }

    const tokens = await sessionService.issue(db, { userId: user.id, role: user.role });
    return c.json(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.accessExpiresAt.toISOString(),
        refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
        user: { id: user.id, role: user.role, phone: user.phone, kycTier: user.kycTier },
      },
      200,
    );
  })
  .post('/refresh', async (c) => {
    const body = await parseBody(c, RefreshSchema);
    if (body instanceof Response) return body;
    const r = await sessionService.refresh(db, body.refreshToken, body.userId);
    if (r.kind !== 'rotated') return c.json({ error: r.kind }, 401);
    return c.json(
      {
        accessToken: r.tokens.accessToken,
        refreshToken: r.tokens.refreshToken,
        accessExpiresAt: r.tokens.accessExpiresAt.toISOString(),
        refreshExpiresAt: r.tokens.refreshExpiresAt.toISOString(),
      },
      200,
    );
  });

export const meRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me', async (c) => {
    const a = c.get('actor');
    const u = await usersRepo.findById(db, a.userId);
    if (!u) return c.json({ error: 'user_not_found' }, 404);
    return c.json(
      { id: u.id, role: u.role, phone: u.phone, kycTier: u.kycTier, status: u.status },
      200,
    );
  });

export const logoutRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/auth/logout', async (c) => {
    const a = c.get('actor');
    await sessionService.revoke(db, a.sessionId);
    return c.json({ revoked: true }, 200);
  });
