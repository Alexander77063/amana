import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seed() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const provisioned = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
  });
  return { masterId: provisioned.master.id, ledgerAccountIds: provisioned.ledgerAccountIds };
}

describe('ledger.service.writeDoubleEntry', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('happy path: balanced postings persist', async () => {
    const { masterId, ledgerAccountIds } = await seed();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      kind: 'topup',
      amountKobo: kobo(100000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: ledgerAccountIds.master, debitKobo: kobo(100000n), creditKobo: kobo(0n) },
      {
        ledgerAccountId: ledgerAccountIds.suspense,
        debitKobo: kobo(0n),
        creditKobo: kobo(100000n),
      },
    ]);
    const written = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(written).toHaveLength(2);
    expect(await postingsRepo.accountBalance(testDb, ledgerAccountIds.master)).toBe(100000n);
  });

  it('rejects unbalanced postings with no DB write', async () => {
    const { masterId, ledgerAccountIds } = await seed();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      kind: 'topup',
      amountKobo: kobo(100000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await expect(
      ledgerService.writeDoubleEntry(testDb, txn.id, [
        {
          ledgerAccountId: ledgerAccountIds.master,
          debitKobo: kobo(100000n),
          creditKobo: kobo(0n),
        },
        {
          ledgerAccountId: ledgerAccountIds.suspense,
          debitKobo: kobo(0n),
          creditKobo: kobo(99999n),
        },
      ]),
    ).rejects.toThrow(/unbalanced|debits.*credits/i);
    const written = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(written).toHaveLength(0);
  });

  it('rejects empty posting list', async () => {
    const { masterId } = await seed();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      kind: 'topup',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await expect(ledgerService.writeDoubleEntry(testDb, txn.id, [])).rejects.toThrow(/at least 2/);
  });

  it('rejects single-row postings (need ≥2 for double-entry)', async () => {
    const { masterId, ledgerAccountIds } = await seed();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      kind: 'topup',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await expect(
      ledgerService.writeDoubleEntry(testDb, txn.id, [
        { ledgerAccountId: ledgerAccountIds.master, debitKobo: kobo(100n), creditKobo: kobo(0n) },
      ]),
    ).rejects.toThrow(/at least 2/);
  });
});
