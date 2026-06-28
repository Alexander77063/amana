import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/media/media.service', () => ({
  mediaService: {
    getUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: 'https://s3/put', key: 'media/x.jpg' }),
  },
}));

import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function makeHousehold(accountSuffix: string) {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: `000000000${accountSuffix}`,
    anchorBankCode: '058',
    anchorAccountId: `anchor-${accountSuffix}`,
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principal, agent, masterId: mw.master.id, subWalletId: sw.sub.id };
}

describe('IDOR — cross-household resource access', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("rejects /media/upload-url for another household's transaction (403)", async () => {
    const a = await makeHousehold('1');
    const b = await makeHousehold('2');
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: a.masterId,
      subWalletId: a.subWalletId,
      kind: 'spend',
      amountKobo: kobo(5000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await bearerHeaders(b.agent), // agent B
      body: JSON.stringify({ transactionId: txn.id, contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects /vendors/recents for another household's sub-wallet (403)", async () => {
    const a = await makeHousehold('1');
    const b = await makeHousehold('2');
    const app = createServer();
    const res = await app.request(`/vendors/recents?subWalletId=${a.subWalletId}`, {
      headers: await bearerHeaders(b.agent), // agent B
    });
    expect(res.status).toBe(403);
  });

  it('allows the owning agent to read their own sub-wallet recents (200)', async () => {
    const a = await makeHousehold('1');
    const app = createServer();
    const res = await app.request(`/vendors/recents?subWalletId=${a.subWalletId}`, {
      headers: await bearerHeaders(a.agent),
    });
    expect(res.status).toBe(200);
  });
});
