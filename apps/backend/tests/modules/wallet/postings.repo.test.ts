import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedMaster(): Promise<string> {
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
    anchorAccountId: `a-${factories.walletId().slice(0, 8)}`,
  });
  return mw.master.id;
}

describe('postingsRepo.findNegativeMasterBalances', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('flags an overdrawn master LA and ignores healthy ones', async () => {
    const okMasterId = await seedMaster(); // no postings → balance 0, not negative
    const badMasterId = await seedMaster();
    const masterLA = await ledgerAccountsRepo.findByMasterAndKind(testDb, badMasterId, 'master');
    const feeLA = await ledgerAccountsRepo.findByMasterAndKind(testDb, badMasterId, 'fee');
    // Book a ₦100 fee against an empty wallet → the debit-normal master LA goes to −₦100.
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: badMasterId,
      kind: 'fee',
      amountKobo: kobo(10_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: masterLA!.id, debitKobo: kobo(0n), creditKobo: kobo(10_000n) },
      { ledgerAccountId: feeLA!.id, debitKobo: kobo(10_000n), creditKobo: kobo(0n) },
    ]);

    const negs = await postingsRepo.findNegativeMasterBalances(testDb);
    const ids = negs.map((n) => n.masterWalletId);
    expect(ids).toContain(badMasterId);
    expect(ids).not.toContain(okMasterId);
    expect(negs.find((n) => n.masterWalletId === badMasterId)?.balanceKobo).toBe(kobo(-10_000n));
  });
});

describe('postings table (immutability)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert allowed; UPDATE blocked by trigger', async () => {
    const userId = factories.userId();
    const hhId = factories.householdId();
    const mwId = factories.walletId();
    const laId = factories.walletId();
    const txnId = factories.txnId();
    await testDb.execute(sql`
      INSERT INTO users (id, role, phone, nin, kyc_tier) VALUES (${userId}, 'principal', ${factories.phone()}, ${factories.nin()}, '2');
    `);
    await testDb.execute(sql`
      INSERT INTO households (id, principal_user_id, name) VALUES (${hhId}, ${userId}, 'Test HH');
    `);
    await testDb.execute(sql`
      INSERT INTO master_wallets (id, household_id, anchor_virtual_account, anchor_bank_code, anchor_account_id) VALUES (${mwId}, ${hhId}, '1234567890', '058', 'anchor-acct-test');
    `);
    await testDb.execute(sql`
      INSERT INTO ledger_accounts (id, master_wallet_id, kind, normal_side) VALUES (${laId}, ${mwId}, 'master', 'debit');
    `);
    await testDb.execute(sql`
      INSERT INTO transactions (id, master_wallet_id, kind, amount_kobo, idempotency_key)
      VALUES (${txnId}, ${mwId}, 'topup', 10000, ${factories.idempotencyKey()});
    `);
    const postingId = factories.txnId();
    await testDb.execute(sql`
      INSERT INTO postings (id, transaction_id, ledger_account_id, debit_kobo, credit_kobo)
      VALUES (${postingId}, ${txnId}, ${laId}, 10000, 0);
    `);
    const before = await testDb.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM postings`,
    );
    expect(before[0]?.count).toBe('1');
    await expect(
      testDb.execute(sql`UPDATE postings SET debit_kobo = 99999 WHERE id = ${postingId}`),
    ).rejects.toThrow(/append-only/);
    await expect(testDb.execute(sql`DELETE FROM postings WHERE id = ${postingId}`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('exclusive-side check', async () => {
    const userId = factories.userId();
    const hhId = factories.householdId();
    const mwId = factories.walletId();
    const laId = factories.walletId();
    const txnId = factories.txnId();
    await testDb.execute(
      sql`INSERT INTO users (id, role, phone, nin, kyc_tier) VALUES (${userId}, 'principal', ${factories.phone()}, ${factories.nin()}, '2');`,
    );
    await testDb.execute(
      sql`INSERT INTO households (id, principal_user_id, name) VALUES (${hhId}, ${userId}, 'Test HH');`,
    );
    await testDb.execute(
      sql`INSERT INTO master_wallets (id, household_id, anchor_virtual_account, anchor_bank_code, anchor_account_id) VALUES (${mwId}, ${hhId}, '1234567890', '058', 'anchor-acct-test');`,
    );
    await testDb.execute(
      sql`INSERT INTO ledger_accounts (id, master_wallet_id, kind, normal_side) VALUES (${laId}, ${mwId}, 'master', 'debit');`,
    );
    await testDb.execute(
      sql`INSERT INTO transactions (id, master_wallet_id, kind, amount_kobo, idempotency_key) VALUES (${txnId}, ${mwId}, 'topup', 10000, ${factories.idempotencyKey()});`,
    );

    await expect(
      testDb.execute(sql`
        INSERT INTO postings (transaction_id, ledger_account_id, debit_kobo, credit_kobo)
        VALUES (${txnId}, ${laId}, 100, 100)
      `),
    ).rejects.toThrow(/postings_exclusive_side|check/i);
  });
});

describe('postings.repo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insertMany appends + accountBalance is debits - credits', async () => {
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
      anchorAccountId: 'anchor-acct-test',
    });
    const masterLA = provisioned.ledgerAccountIds.master;

    const txn1 = await transactionsRepo.insert(testDb, {
      masterWalletId: provisioned.master.id,
      kind: 'topup',
      amountKobo: kobo(100000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await postingsRepo.insertMany(testDb, [
      {
        transactionId: txn1.id,
        ledgerAccountId: masterLA,
        debitKobo: kobo(100000n),
        creditKobo: kobo(0n),
      },
    ]);

    const txn2 = await transactionsRepo.insert(testDb, {
      masterWalletId: provisioned.master.id,
      kind: 'fee',
      amountKobo: kobo(2500n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await postingsRepo.insertMany(testDb, [
      {
        transactionId: txn2.id,
        ledgerAccountId: masterLA,
        debitKobo: kobo(0n),
        creditKobo: kobo(2500n),
      },
    ]);

    const bal = await postingsRepo.accountBalance(testDb, masterLA);
    expect(bal).toBe(97500n);
  });

  it('listByTransaction returns all postings for a txn', async () => {
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
      anchorAccountId: 'anchor-acct-test',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: provisioned.master.id,
      kind: 'topup',
      amountKobo: kobo(100n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await postingsRepo.insertMany(testDb, [
      {
        transactionId: txn.id,
        ledgerAccountId: provisioned.ledgerAccountIds.master,
        debitKobo: kobo(100n),
        creditKobo: kobo(0n),
      },
      {
        transactionId: txn.id,
        ledgerAccountId: provisioned.ledgerAccountIds.suspense,
        debitKobo: kobo(0n),
        creditKobo: kobo(100n),
      },
    ]);
    const all = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(all).toHaveLength(2);
  });
});
