import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted — keep anchorAdapterSingleton mocked at module level.
// AnchorHttpError is intentionally imported from /client (not the barrel) so
// the partial mock of the barrel does not shadow the class reference.
vi.mock('../../src/integrations/anchor', () => ({
  anchorAdapterSingleton: {
    createCustomer: vi.fn(),
    provisionVirtualAccount: vi.fn(),
  },
}));

import { anchorAdapterSingleton } from '../../src/integrations/anchor';
import { AnchorHttpError } from '../../src/integrations/anchor/client';
import { householdMembersRepo } from '../../src/modules/identity/household-members.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /households', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
  });

  it('creates household + master wallet for principal', async () => {
    vi.mocked(anchorAdapterSingleton.createCustomer).mockResolvedValueOnce({
      id: 'anchor-cust-1',
      fullName: 'Test Principal',
      phoneNumber: '+2348012345678',
      kycLevel: 'TIER_1',
    });
    vi.mocked(anchorAdapterSingleton.provisionVirtualAccount).mockResolvedValueOnce({
      id: 'anchor-va-1',
      accountNumber: '0123456789',
      bankCode: '058',
      accountName: 'AMANA/TEST',
      customerId: 'anchor-cust-1',
      status: 'ACTIVE',
    });

    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Adegbola family' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      household: { id: string; name: string };
      masterWallet: { anchorVirtualAccount: string; anchorBankCode: string };
    };
    expect(body.household.name).toBe('Adegbola family');
    expect(body.masterWallet.anchorVirtualAccount).toBe('0123456789');
    expect(body.masterWallet.anchorBankCode).toBe('058');
    expect(vi.mocked(anchorAdapterSingleton.createCustomer)).toHaveBeenCalledOnce();
    expect(vi.mocked(anchorAdapterSingleton.provisionVirtualAccount)).toHaveBeenCalledOnce();

    // Verify anchorCustomerId persisted on user row
    const updatedUser = await usersRepo.findById(testDb, u.id);
    expect(updatedUser?.anchorCustomerId).toBe('anchor-cust-1');

    const mw = await masterWalletsRepo.findByHousehold(testDb, body.household.id);
    expect(mw).toBeDefined();
  });

  it('409 when principal already has a household', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await householdsRepo.insert(testDb, { principalUserId: u.id, name: 'First' });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Second' }),
    });
    expect(res.status).toBe(409);
  });

  it('403 for agents', async () => {
    const a = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const headers = await bearerHeaders(a);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'nope' }),
    });
    expect(res.status).toBe(403);
  });

  it('400 on empty name', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('503 when Anchor createCustomer fails', async () => {
    vi.mocked(anchorAdapterSingleton.createCustomer).mockRejectedValueOnce(
      new AnchorHttpError(500, { error: 'internal' }, 'Anchor POST /customers → 500'),
    );
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers: await bearerHeaders(u),
      body: JSON.stringify({ name: 'Broken household' }),
    });
    expect(res.status).toBe(503);
    // Transaction must have rolled back — no household committed
    expect(await householdsRepo.findByPrincipal(testDb, u.id)).toBeUndefined();
  });

  it('503 when Anchor provisionVirtualAccount fails', async () => {
    vi.mocked(anchorAdapterSingleton.createCustomer).mockResolvedValueOnce({
      id: 'anchor-cust-2',
      fullName: 'Test',
      phoneNumber: '+2348012345678',
      kycLevel: 'TIER_1',
    });
    vi.mocked(anchorAdapterSingleton.provisionVirtualAccount).mockRejectedValueOnce(
      new AnchorHttpError(503, { error: 'unavailable' }, 'Anchor POST /virtual-accounts → 503'),
    );
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers: await bearerHeaders(u),
      body: JSON.stringify({ name: 'Half-created' }),
    });
    expect(res.status).toBe(503);
  });

  it('skips createCustomer when user already has anchorCustomerId', async () => {
    vi.mocked(anchorAdapterSingleton.provisionVirtualAccount).mockResolvedValueOnce({
      id: 'anchor-va-2',
      accountNumber: '9876543210',
      bankCode: '058',
      accountName: 'AMANA/REENTRANT',
      customerId: 'anchor-cust-existing',
      status: 'ACTIVE',
    });
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, u.id, 'anchor-cust-existing');

    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST',
      headers: await bearerHeaders(u),
      body: JSON.stringify({ name: 'Re-entrant household' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(anchorAdapterSingleton.createCustomer)).not.toHaveBeenCalled();
  });
});

describe('GET /me/household', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('404 when principal has no household', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/me/household', { headers });
    expect(res.status).toBe(404);
  });

  it('returns household + master wallet after creation', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: u.id, name: 'HH' });
    await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '0123456789',
      anchorBankCode: '058',
      anchorAccountId: 'a-1',
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/me/household', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      household: { name: string };
      masterWallet: { anchorVirtualAccount: string };
    };
    expect(body.household.name).toBe('HH');
    expect(body.masterWallet.anchorVirtualAccount).toBe('0123456789');
  });
});

describe('GET /me/household/members', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns paired agents', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    await householdMembersRepo.add(testDb, hh.id, agent.id);
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request('/me/household/members', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: Array<{ userId: string; role: string }> };
    expect(body.members).toHaveLength(1);
    expect(body.members[0].userId).toBe(agent.id);
  });
});

describe('GET /households/:id/sub-wallets', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("lists sub-wallets for the principal's own household", async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '0123456789',
      anchorBankCode: '058',
      anchorAccountId: 'a-1',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id,
      agentUserId: agent.id,
      name: 'Driver',
    });
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/households/${hh.id}/sub-wallets`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subWallets: Array<{ name: string }> };
    expect(body.subWallets).toHaveLength(1);
    expect(body.subWallets[0].name).toBe('Driver');
  });

  it("403 not_your_household when querying another principal's household", async () => {
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
    const hhB = await householdsRepo.insert(testDb, { principalUserId: principalB.id, name: 'B' });
    const headers = await bearerHeaders(principalA);
    const app = createServer();
    const res = await app.request(`/households/${hhB.id}/sub-wallets`, { headers });
    expect(res.status).toBe(403);
  });
});

describe('POST /households/:id/sub-wallets', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates a sub-wallet for a paired agent', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '0123456789',
      anchorBankCode: '058',
      anchorAccountId: 'a-1',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    await householdMembersRepo.add(testDb, hh.id, agent.id);
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/households/${hh.id}/sub-wallets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentUserId: agent.id, name: 'School fees' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      subWallet: { name: string; agentUserId: string };
    };
    expect(body.subWallet.name).toBe('School fees');
    expect(body.subWallet.agentUserId).toBe(agent.id);
  });

  it('400 agent_not_paired when agent is not a household member', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '0123456789',
      anchorBankCode: '058',
      anchorAccountId: 'a-1',
    });
    const orphanAgent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/households/${hh.id}/sub-wallets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentUserId: orphanAgent.id, name: 'X' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'agent_not_paired' });
  });
});
