import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { stickersRepo } from '../../src/modules/sticker/stickers.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedSubWallet() {
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
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { agent, agentId: agent.id, subWalletId: sw.sub.id };
}

describe('GET /vendors/sticker/:uuid', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 with ResolvedVendor for an active sticker', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA',
      vendorPhone: factories.phone(),
      status: 'active',
    });
    const app = createServer();
    const headers = await bearerHeaders(agent);
    const res = await app.request(`/vendors/sticker/${sticker.uuid}?subWalletId=${subWalletId}`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountName).toBe('MUSA');
    expect(body.source).toBe('sticker');
  });

  it('404 for unknown sticker', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const app = createServer();
    const headers = await bearerHeaders(agent);
    const res = await app.request(
      `/vendors/sticker/${factories.txnId()}?subWalletId=${subWalletId}`,
      { headers },
    );
    expect(res.status).toBe(404);
  });

  it('401 without bearer', async () => {
    const { subWalletId } = await seedSubWallet();
    const app = createServer();
    const res = await app.request(
      `/vendors/sticker/${factories.txnId()}?subWalletId=${subWalletId}`,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });
});

describe('GET /vendors/recents', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 with empty array when no recents', async () => {
    const { agent, subWalletId } = await seedSubWallet();
    const app = createServer();
    const headers = await bearerHeaders(agent);
    const res = await app.request(`/vendors/recents?subWalletId=${subWalletId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recents).toEqual([]);
  });
});
