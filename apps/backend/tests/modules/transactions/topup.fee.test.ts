import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { topupService } from '../../../src/modules/transactions/topup.service';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedWallet(anchorId: string) {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  return masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: `VA-${anchorId}`,
    anchorBankCode: '058',
    anchorAccountId: anchorId,
  });
}

async function masterBalance(masterWalletId: string): Promise<bigint> {
  const la = await ledgerAccountsRepo.findByMasterAndKind(testDb, masterWalletId, 'master');
  return postingsRepo.accountBalance(testDb, la!.id);
}

const JULY = new Date('2026-07-15T12:00:00Z');

describe('topupService inflow-fee cap enforcement', () => {
  beforeEach(truncateAll);

  it('under the monthly cap: absorbs the whole fee, credits the full amount, charges nothing', async () => {
    const mw = await seedWallet('anchor-under');
    const result = await topupService.handle(testDb, {
      virtualAccountId: 'anchor-under',
      amountKobo: kobo(4_000_000n), // ₦40,000 -> ₦200 fee
      nibssSessionId: factories.nibssSessionId(),
      senderBankCode: '011',
      senderAccountNumber: '0000000001',
      senderAccountName: 'Funder',
      receivedAt: JULY,
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') throw new Error('expected created');

    const txn = await transactionsRepo.findById(testDb, result.transactionId);
    expect(txn?.inflowFeeAbsorbedKobo).toBe(20_000n); // ₦200 absorbed
    expect(txn?.inflowFeeChargedKobo).toBe(0n); // nothing charged
    expect(await masterBalance(mw.master.id)).toBe(4_000_000n); // full amount credited
  });

  it('over the ₦6,000/month cap: splits the fee and nets the credit', async () => {
    const mw = await seedWallet('anchor-over');
    // Pre-load ₦5,950 of month-to-date absorbed fee (₦50 headroom left under ₦6,000).
    await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'topup',
      amountKobo: kobo(20_000_000n),
      inflowFeeAbsorbedKobo: kobo(595_000n),
      idempotencyKey: factories.idempotencyKey(),
    });

    const result = await topupService.handle(testDb, {
      virtualAccountId: 'anchor-over',
      amountKobo: kobo(4_000_000n), // ₦40,000 -> ₦200 gross fee
      nibssSessionId: factories.nibssSessionId(),
      senderBankCode: '011',
      senderAccountNumber: '0000000002',
      senderAccountName: 'Funder',
      receivedAt: JULY,
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') throw new Error('expected created');

    const txn = await transactionsRepo.findById(testDb, result.transactionId);
    expect(txn?.inflowFeeAbsorbedKobo).toBe(5_000n); // ₦50 headroom absorbed
    expect(txn?.inflowFeeChargedKobo).toBe(15_000n); // ₦150 charged to the user
    // Only this top-up carries postings; the wallet is credited the NET (₦40,000 − ₦150).
    expect(await masterBalance(mw.master.id)).toBe(3_985_000n);
  });

  it('excludes prior-month absorption (Lagos calendar month resets the cap)', async () => {
    const mw = await seedWallet('anchor-reset');
    // A ₦5,950-absorbed top-up, but dated to the PREVIOUS Lagos month → must not count.
    const prior = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'topup',
      amountKobo: kobo(20_000_000n),
      inflowFeeAbsorbedKobo: kobo(595_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await testDb.execute(
      sql`UPDATE transactions SET created_at = '2026-06-15T12:00:00Z'::timestamptz WHERE id = ${prior.id}`,
    );

    const result = await topupService.handle(testDb, {
      virtualAccountId: 'anchor-reset',
      amountKobo: kobo(4_000_000n),
      nibssSessionId: factories.nibssSessionId(),
      senderBankCode: '011',
      senderAccountNumber: '0000000003',
      senderAccountName: 'Funder',
      receivedAt: JULY, // current month → prior month's ₦5,950 is out of scope
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') throw new Error('expected created');

    const txn = await transactionsRepo.findById(testDb, result.transactionId);
    expect(txn?.inflowFeeAbsorbedKobo).toBe(20_000n); // full fee absorbed (cap reset)
    expect(txn?.inflowFeeChargedKobo).toBe(0n);
  });
});
