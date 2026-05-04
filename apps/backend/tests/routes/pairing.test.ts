import { beforeEach, describe, expect, it } from 'vitest';
import { sessionService } from '../../src/modules/auth/session.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /pairing', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('principal can issue a pairing code for their own household', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id,
      name: 'HH',
    });
    const tokens = await sessionService.issue(testDb, { userId: principal.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/pairing', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ householdId: hh.id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string };
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('agent gets 403 principal_only', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id,
      name: 'HH',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const tokens = await sessionService.issue(testDb, { userId: agent.id, role: 'agent' });
    const app = createServer();
    const res = await app.request('/pairing', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ householdId: hh.id }),
    });
    expect(res.status).toBe(403);
  });

  it('principal pairing another principals household → 403 not_your_household', async () => {
    const principalA = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const principalB = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hhB = await householdsRepo.insert(testDb, {
      principalUserId: principalB.id,
      name: 'HHB',
    });
    const tokens = await sessionService.issue(testDb, {
      userId: principalA.id,
      role: 'principal',
    });
    const app = createServer();
    const res = await app.request('/pairing', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ householdId: hhB.id }),
    });
    expect(res.status).toBe(403);
  });
});
