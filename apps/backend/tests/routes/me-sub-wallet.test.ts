import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedPairedAgent() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '0000000001', anchorBankCode: '058', anchorAccountId: 'a1',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver wallet',
  });
  return { principal, agent, mw, sw };
}

describe('GET /me/sub-wallet', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — returns subWallet + principal for paired agent', async () => {
    const { principal, agent, mw, sw } = await seedPairedAgent();
    const app = createServer();
    const res = await app.request('/me/sub-wallet', { headers: await bearerHeaders(agent) });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWallet: { id: string; name: string; masterWalletId: string }; principal: { userId: string; phone: string } };
    expect(body.subWallet.id).toBe(sw.sub.id);
    expect(body.subWallet.name).toBe('Driver wallet');
    expect(body.subWallet.masterWalletId).toBe(mw.master.id);
    expect(body.principal.userId).toBe(principal.id);
    expect(body.principal.phone).toBe(principal.phone);
  });

  it('404 not_paired — agent with no sub-wallet', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/me/sub-wallet', { headers: await bearerHeaders(agent) });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('not_paired');
  });

  it('403 — principal caller', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/me/sub-wallet', { headers: await bearerHeaders(principal) });
    expect(res.status).toBe(403);
  });

  it('401 — unauthenticated', async () => {
    const app = createServer();
    const res = await app.request('/me/sub-wallet');
    expect(res.status).toBe(401);
  });
});
