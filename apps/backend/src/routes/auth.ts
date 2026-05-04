import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { otpService } from '../modules/auth/otp.service';
import { pairingService } from '../modules/auth/pairing.service';
import { sessionService } from '../modules/auth/session.service';
import { usersRepo } from '../modules/identity/users.repo';

const PHONE_RE = /^\+\d{8,15}$/;

export const authRoute = new Hono()
  .post('/otp/request', async (c) => {
    const body = await c.req.json<{ phone: string; purpose: 'login' | 'pair' }>();
    if (!PHONE_RE.test(body.phone)) {
      return c.json({ error: 'invalid_phone' }, 400);
    }
    if (body.purpose !== 'login' && body.purpose !== 'pair') {
      return c.json({ error: 'invalid_purpose' }, 400);
    }
    const r = await otpService.requestCode(db, { phone: body.phone, purpose: body.purpose });
    return c.json({ challengeId: r.challengeId, expiresAt: r.expiresAt.toISOString() }, 200);
  })
  .post('/otp/verify', async (c) => {
    const body = await c.req.json<{
      phone: string;
      code: string;
      pairingCode?: string;
      nin?: string;
      bvn?: string;
    }>();
    if (!PHONE_RE.test(body.phone)) {
      return c.json({ error: 'invalid_phone' }, 400);
    }
    const v = await otpService.verifyCode(db, { phone: body.phone, code: body.code });
    if (v.kind !== 'verified') {
      return c.json({ error: v.kind }, 401);
    }

    let user = await usersRepo.findByPhone(db, body.phone);

    if (!user && body.pairingCode) {
      if (!body.nin) return c.json({ error: 'nin_required_for_signup' }, 400);
      user = await usersRepo.insert(db, {
        role: 'agent',
        phone: body.phone,
        nin: body.nin,
        kycTier: '1',
      });
      const consumed = await pairingService.consume(db, {
        code: body.pairingCode,
        agentUserId: user.id,
      });
      if (consumed.kind !== 'consumed') {
        return c.json({ error: 'pairing_failed', reason: consumed.kind }, 400);
      }
    }

    if (!user) {
      if (!body.nin || !body.bvn) {
        return c.json({ error: 'nin_and_bvn_required_for_principal_signup' }, 400);
      }
      user = await usersRepo.insert(db, {
        role: 'principal',
        phone: body.phone,
        nin: body.nin,
        bvn: body.bvn,
        kycTier: '1',
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
    const body = await c.req.json<{
      refreshToken: string;
      userId: string;
      role: 'principal' | 'agent';
    }>();
    if (!body.refreshToken || !body.userId || !body.role) {
      return c.json({ error: 'missing_params' }, 400);
    }
    const r = await sessionService.refresh(db, body.refreshToken, body.role, body.userId);
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
      {
        id: u.id,
        role: u.role,
        phone: u.phone,
        kycTier: u.kycTier,
        status: u.status,
      },
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
