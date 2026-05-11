import { beforeEach, describe, expect, it } from 'vitest';
import { sessionService } from '../../src/modules/auth/session.service';
import { pairingService } from '../../src/modules/auth/pairing.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
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

async function seedHousehold() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '0000000001', anchorBankCode: '058', anchorAccountId: 'a1',
  });
  return { principal, hh, mw };
}

describe('POST /pairing/complete', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — agent consumes valid token, returns subWalletId when sub-wallet exists', async () => {
    const { principal, hh, mw } = await seedHousehold();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Cleaner',
    });
    const token = await pairingService.issue(testDb, { principalUserId: principal.id, householdId: hh.id });

    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: { ...(await bearerHeaders(agent)), 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWalletId: string | null };
    expect(body.subWalletId).toBe(sw.sub.id);
  });

  it('200 — returns subWalletId null when no sub-wallet exists yet', async () => {
    const { principal, hh } = await seedHousehold();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const token = await pairingService.issue(testDb, { principalUserId: principal.id, householdId: hh.id });

    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: { ...(await bearerHeaders(agent)), 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWalletId: string | null };
    expect(body.subWalletId).toBeNull();
  });

  it('404 — invalid or expired token', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: { ...(await bearerHeaders(agent)), 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token' }),
    });
    expect(res.status).toBe(404);
  });

  it('403 — principal caller cannot complete pairing', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: { ...(await bearerHeaders(principal)), 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'any' }),
    });
    expect(res.status).toBe(403);
  });
});
