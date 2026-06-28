import { beforeEach, describe, expect, it } from 'vitest';
import { sessionService } from '../../src/modules/auth/session.service';
import { verifyAccessToken } from '../../src/modules/auth/tokens';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /auth/refresh — privilege escalation guard', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('ignores a client-supplied role and signs the token with the DB role', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const tokens = await sessionService.issue(testDb, { userId: agent.id, role: 'agent' });
    const app = createServer();
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: tokens.refreshToken,
        userId: agent.id,
        role: 'principal', // attacker attempts to escalate
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };
    const claims = await verifyAccessToken(body.accessToken);
    expect(claims.role).toBe('agent');
  });
});
