import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('postingsRepo.sumDebitsInWindow', () => {
  beforeEach(async () => { await truncateAll(); });

  async function seed() {
    const principal = await usersRepo.insert(testDb, { role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn() });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const { wallet: mw } = await masterWalletsRepo.provision(testDb, { householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058', anchorAccountId: 'anchor-acct-test' });
    const agent = await usersRepo.insert(testDb, { role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1' });
    const { sub, ledgerAccountId } = await subWalletsRepo.provision(testDb, { masterWalletId: mw.id, agentUserId: agent.id, name: 'Test SW' });
    return { subWalletId: sub.id, ledgerAccountId, masterWalletId: mw.id };
  }

  async function insertSettledSpend(masterWalletId: string, ledgerAccountId: string, amountKobo: bigint, settledAt: Date) {
    const txn = await transactionsRepo.insert(testDb, { masterWalletId, kind: 'spend', amountKobo: kobo(amountKobo), idempotencyKey: factories.idempotencyKey() });
    await transactionsRepo.setStatus(testDb, txn.id, 'settled', settledAt);
    await postingsRepo.insertMany(testDb, [{ transactionId: txn.id, ledgerAccountId, debitKobo: kobo(amountKobo), creditKobo: kobo(0n) }]);
    return txn;
  }

  it('sums debits within window, excludes outside', async () => {
    const { subWalletId, ledgerAccountId, masterWalletId } = await seed();
    const now = new Date('2025-01-10T12:00:00Z');
    const within = new Date('2025-01-09T12:00:00Z'); // 24h ago exactly is within
    const outside = new Date('2025-01-08T11:59:59Z'); // >24h ago is outside

    await insertSettledSpend(masterWalletId, ledgerAccountId, 5000n, within);
    await insertSettledSpend(masterWalletId, ledgerAccountId, 3000n, within);
    await insertSettledSpend(masterWalletId, ledgerAccountId, 9000n, outside);

    const result = await postingsRepo.sumDebitsInWindow(testDb, subWalletId, 24 * 60 * 60, now);
    expect(result).toBe(kobo(8000n));
  });

  it('returns zero when no debits in window', async () => {
    const { subWalletId } = await seed();
    const result = await postingsRepo.sumDebitsInWindow(testDb, subWalletId, 3600, new Date());
    expect(result).toBe(kobo(0n));
  });
});
