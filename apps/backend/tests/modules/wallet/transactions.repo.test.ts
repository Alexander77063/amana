import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';

describe('transactions table (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('amount_kobo is bigint (int8)', async () => {
    const r = await testDb.execute<{ data_type: string }>(sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'amount_kobo'
    `);
    expect(r[0]?.data_type).toBe('bigint');
  });

  it('idempotency_key is unique', async () => {
    const r = await testDb.execute<{ contype: string }>(sql`
      SELECT contype FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = 'transactions'::regclass AND a.attname = 'idempotency_key'
    `);
    expect(r.some((row) => row.contype === 'u')).toBe(true);
  });

  it('geolocation is a geometry', async () => {
    const r = await testDb.execute<{ udt_name: string }>(sql`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'geolocation'
    `);
    expect(r[0]?.udt_name).toBe('geometry');
  });
});

describe('transactions.repo', () => {
  beforeEach(async () => { await truncateAll(); });

  async function seedMaster(): Promise<{ masterId: string }> {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const provisioned = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
    });
    return { masterId: provisioned.master.id };
  }

  it('insert + findById round-trips', async () => {
    const { masterId } = await seedMaster();
    const created = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, kind: 'topup', amountKobo: kobo(100000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    const found = await transactionsRepo.findById(testDb, created.id);
    expect(found?.amountKobo).toBe(100000n);
  });

  it('idempotency-key duplicate is rejected', async () => {
    const { masterId } = await seedMaster();
    const key = factories.idempotencyKey();
    await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, kind: 'topup', amountKobo: kobo(100n), idempotencyKey: key,
    });
    await expect(
      transactionsRepo.insert(testDb, {
        masterWalletId: masterId, kind: 'topup', amountKobo: kobo(100n), idempotencyKey: key,
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('findByIdempotencyKey resolves the same row', async () => {
    const { masterId } = await seedMaster();
    const key = factories.idempotencyKey();
    const created = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, kind: 'spend', amountKobo: kobo(500n), idempotencyKey: key,
    });
    const found = await transactionsRepo.findByIdempotencyKey(testDb, key);
    expect(found?.id).toBe(created.id);
  });

  it('setStatus + setNibssSessionId update the row', async () => {
    const { masterId } = await seedMaster();
    const created = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, kind: 'spend', amountKobo: kobo(100n), idempotencyKey: factories.idempotencyKey(),
    });
    const settledAt = new Date('2026-05-03T12:00:00Z');
    await transactionsRepo.setStatus(testDb, created.id, 'settled', settledAt);
    await transactionsRepo.setNibssSessionId(testDb, created.id, factories.nibssSessionId());
    const found = await transactionsRepo.findById(testDb, created.id);
    expect(found?.status).toBe('settled');
    expect(found?.settledAt?.toISOString()).toBe(settledAt.toISOString());
    expect(found?.nibssSessionId).toMatch(/^\d+$/);
  });
});
