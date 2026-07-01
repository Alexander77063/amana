import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedMasterWallet() {
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
    anchorVirtualAccount: `VA-${factories.walletId().slice(0, 8)}`,
    anchorBankCode: '058',
    anchorAccountId: `anchor-${factories.walletId().slice(0, 8)}`,
  });
  return { masterWalletId: mw.master.id };
}

describe('transactionsRepo inflow fee', () => {
  beforeEach(truncateAll);

  it('persists inflowFeeAbsorbedKobo on insert and sums it per master wallet', async () => {
    const { masterWalletId } = await seedMasterWallet();

    await transactionsRepo.insert(testDb, {
      masterWalletId,
      kind: 'topup',
      amountKobo: kobo(1_000_000n), // ₦10,000
      idempotencyKey: factories.idempotencyKey(),
      inflowFeeAbsorbedKobo: kobo(5_000n), // ₦50
    });
    await transactionsRepo.insert(testDb, {
      masterWalletId,
      kind: 'topup',
      amountKobo: kobo(4_000_000n), // ₦40,000
      idempotencyKey: factories.idempotencyKey(),
      inflowFeeAbsorbedKobo: kobo(20_000n), // ₦200
    });

    const total = await transactionsRepo.sumInflowFeesAbsorbed(testDb, masterWalletId);
    expect(total).toBe(kobo(25_000n)); // ₦250
  });

  it('returns 0 when there are no top-ups', async () => {
    const { masterWalletId } = await seedMasterWallet();
    const total = await transactionsRepo.sumInflowFeesAbsorbed(testDb, masterWalletId);
    expect(total).toBe(kobo(0n));
  });
});
