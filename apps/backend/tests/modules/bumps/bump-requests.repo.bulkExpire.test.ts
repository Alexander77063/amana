import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('bumpRequestsRepo.bulkExpire', () => {
  beforeEach(async () => { await truncateAll(); });

  async function seed() {
    const principal = await usersRepo.insert(testDb, { role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn() });
    const agent = await usersRepo.insert(testDb, { role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1' });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const { master: mw } = await masterWalletsRepo.provision(testDb, { householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058', anchorAccountId: 'anchor-acct-test' });
    const { sub } = await subWalletsRepo.provision(testDb, { masterWalletId: mw.id, agentUserId: agent.id, name: 'SW' });
    return { principalId: principal.id, agentId: agent.id, subWalletId: sub.id, masterWalletId: mw.id };
  }

  async function insertBump(subWalletId: string, masterWalletId: string, requestedByUserId: string, expiresAt: Date) {
    const txn = await transactionsRepo.insert(testDb, { masterWalletId, kind: 'spend', amountKobo: kobo(1000n), idempotencyKey: factories.idempotencyKey() });
    return bumpRequestsRepo.insert(testDb, { transactionId: txn.id, subWalletId, requestedByUserId, amountKobo: kobo(1000n), vendorResolvedName: 'Vendor', expiresAt });
  }

  it('sets status to expired for all given ids', async () => {
    const { agentId, subWalletId, masterWalletId } = await seed();
    const past = new Date(Date.now() - 60_000);
    const b1 = await insertBump(subWalletId, masterWalletId, agentId, past);
    const b2 = await insertBump(subWalletId, masterWalletId, agentId, past);

    await bumpRequestsRepo.bulkExpire(testDb, [b1.id, b2.id], new Date());

    const r1 = await bumpRequestsRepo.findById(testDb, b1.id);
    const r2 = await bumpRequestsRepo.findById(testDb, b2.id);
    expect(r1?.status).toBe('expired');
    expect(r2?.status).toBe('expired');
  });

  it('is a no-op for empty array', async () => {
    // Should not throw
    await bumpRequestsRepo.bulkExpire(testDb, [], new Date());
  });

  it('does not expire a bump that is already decided', async () => {
    const { agentId, subWalletId, masterWalletId } = await seed();
    const past = new Date(Date.now() - 60_000);
    const b = await insertBump(subWalletId, masterWalletId, agentId, past);
    // Mark it as denied before calling bulkExpire
    await bumpRequestsRepo.setDecision(testDb, b.id, 'denied', agentId, new Date());

    await bumpRequestsRepo.bulkExpire(testDb, [b.id], new Date());

    const row = await bumpRequestsRepo.findById(testDb, b.id);
    expect(row?.status).toBe('denied'); // must NOT have been overwritten
  });
});
