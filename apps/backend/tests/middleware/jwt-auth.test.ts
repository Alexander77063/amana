// apps/backend/tests/middleware/jwt-auth.test.ts
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ActorVariables, jwtAuth } from '../../src/middleware/jwt-auth';
import { sessionService } from '../../src/modules/auth/session.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const buildApp = () => {
  const app = new Hono<{ Variables: ActorVariables }>().use(jwtAuth());
  app.get('/me', (c) => c.json({ actor: c.get('actor') }, 200));
  return app;
};

describe('jwtAuth middleware', () => {
  beforeEach(async () => { await truncateAll(); });

  it('401 missing_bearer when no Authorization header', async () => {
    const res = await buildApp().request('/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });

  it('401 invalid_token on malformed JWT', async () => {
    const res = await buildApp().request('/me', {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
  });

  it('200 with actor on a valid token', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const res = await buildApp().request('/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { actor: { userId: string; role: string } };
    expect(body.actor.userId).toBe(u.id);
    expect(body.actor.role).toBe('principal');
  });

  it('401 session_revoked after revoke', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    await sessionService.revoke(testDb, tokens.sessionId);
    const res = await buildApp().request('/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'session_revoked' });
  });
});
