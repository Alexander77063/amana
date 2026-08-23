import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

// A malformed :id must never reach Postgres. An invalid uuid literal raises a driver error
// that surfaces as a 500 — the wrong status for a client mistake, and pure Sentry noise.
// CLAUDE.md: "Validate path/query UUIDs with z.string().uuid() so malformed ids return 400,
// not a Postgres 500."
const BAD = 'not-a-uuid';
const app = createServer();

describe('malformed path ids return 400, never 500', () => {
  let principalAuth: Record<string, string>;
  let agentAuth: Record<string, string>;

  beforeEach(async () => {
    await truncateAll();
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      bvn: factories.bvn(),
      kycTier: '2',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    principalAuth = await bearerHeaders(principal);
    agentAuth = await bearerHeaders(agent);
  });

  const principalRoutes: Array<[string, string, unknown?]> = [
    ['GET', `/sub-wallets/${BAD}`],
    ['GET', `/sub-wallets/${BAD}/balance`],
    ['GET', `/sub-wallets/${BAD}/rules`],
    ['PATCH', `/sub-wallets/${BAD}`, { status: 'active' }],
    ['POST', `/sub-wallets/${BAD}/rules`, { rules: [{ kind: 'limit', priority: 1, config: {} }] }],
    ['PUT', `/sub-wallets/${BAD}/snooze`, { until: null }],
    ['DELETE', `/sub-wallets/${BAD}/snooze`],
    ['GET', `/households/${BAD}/sub-wallets`],
    [
      'POST',
      `/households/${BAD}/sub-wallets`,
      { agentUserId: '00000000-0000-0000-0000-000000000000', name: 'x' },
    ],
  ];

  for (const [method, path, body] of principalRoutes) {
    it(`${method} ${path} → 400`, async () => {
      const res = await app.request(path, {
        method,
        headers: { ...principalAuth, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      expect(res.status).toBe(400);
    });
  }

  const agentRoutes: Array<[string, string, unknown?]> = [
    ['GET', `/transactions/${BAD}`],
    ['POST', `/transactions/${BAD}/evaluate`],
    ['POST', `/transactions/${BAD}/send`],
    ['POST', `/transactions/${BAD}/resume-after-bump`, { token: 'x' }],
    ['GET', `/sub-wallets/${BAD}/transactions`],
  ];

  for (const [method, path, body] of agentRoutes) {
    it(`${method} ${path} → 400`, async () => {
      const res = await app.request(path, {
        method,
        headers: { ...agentAuth, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      expect(res.status).toBe(400);
    });
  }

  // One-shot bump tokens are single-use: an expired token, or a second tap on "resume", is
  // ordinary user behaviour and must not surface as a 500 (which would also page us via Sentry).
  it('resume-after-bump with an unknown one-shot token → 409, not 500', async () => {
    const res = await app.request(`/transactions/${factories.txnId()}/resume-after-bump`, {
      method: 'POST',
      headers: { ...agentAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'does-not-exist' }),
    });
    expect(res.status).toBe(409);
  });

  it('a well-formed but unknown id still 404s (the guard is not swallowing real lookups)', async () => {
    const res = await app.request(`/sub-wallets/${factories.walletId()}`, {
      headers: principalAuth,
    });
    expect(res.status).toBe(404);
  });
});
