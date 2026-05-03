import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';

describe('postings table (immutability)', () => {
  beforeEach(async () => { await truncateAll(); });

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
      INSERT INTO master_wallets (id, household_id, anchor_virtual_account, anchor_bank_code) VALUES (${mwId}, ${hhId}, '1234567890', '058');
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
    const before = await testDb.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM postings`);
    expect(before[0]?.count).toBe('1');
    await expect(
      testDb.execute(sql`UPDATE postings SET debit_kobo = 99999 WHERE id = ${postingId}`),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.execute(sql`DELETE FROM postings WHERE id = ${postingId}`),
    ).rejects.toThrow(/append-only/);
  });

  it('exclusive-side check: a posting cannot have both debit and credit > 0', async () => {
    const userId = factories.userId();
    const hhId = factories.householdId();
    const mwId = factories.walletId();
    const laId = factories.walletId();
    const txnId = factories.txnId();
    await testDb.execute(sql`INSERT INTO users (id, role, phone, nin, kyc_tier) VALUES (${userId}, 'principal', ${factories.phone()}, ${factories.nin()}, '2');`);
    await testDb.execute(sql`INSERT INTO households (id, principal_user_id, name) VALUES (${hhId}, ${userId}, 'Test HH');`);
    await testDb.execute(sql`INSERT INTO master_wallets (id, household_id, anchor_virtual_account, anchor_bank_code) VALUES (${mwId}, ${hhId}, '1234567890', '058');`);
    await testDb.execute(sql`INSERT INTO ledger_accounts (id, master_wallet_id, kind, normal_side) VALUES (${laId}, ${mwId}, 'master', 'debit');`);
    await testDb.execute(sql`INSERT INTO transactions (id, master_wallet_id, kind, amount_kobo, idempotency_key) VALUES (${txnId}, ${mwId}, 'topup', 10000, ${factories.idempotencyKey()});`);

    await expect(
      testDb.execute(sql`
        INSERT INTO postings (transaction_id, ledger_account_id, debit_kobo, credit_kobo)
        VALUES (${txnId}, ${laId}, 100, 100)
      `),
    ).rejects.toThrow(/postings_exclusive_side|check/i);
  });
});
