import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { recentsRepo } from '../../../src/modules/vendors/recents.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedSubWallet(): Promise<string> {
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
  return sw.sub.id;
}

describe('vendor_recents (schema)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_recents' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'sub_wallet_id',
      'bank_code',
      'account_number',
      'account_name',
      'last_used_at',
      'first_seen_at',
    ]);
  });

  it('master_wallets has anchor_account_id column', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'master_wallets' AND column_name = 'anchor_account_id'
    `);
    expect(cols.length).toBe(1);
  });
});

describe('recentsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('upsert inserts new row on first call', async () => {
    const subWalletId = await seedSubWallet();
    const row = await recentsRepo.upsert(testDb, {
      subWalletId,
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(row.accountName).toBe('MUSA');
    expect(row.firstSeenAt.toISOString()).toBe(row.lastUsedAt.toISOString());
  });

  it('upsert promotes existing row (updates last_used_at, keeps first_seen_at)', async () => {
    const subWalletId = await seedSubWallet();
    const t1 = new Date('2026-05-01T10:00:00Z');
    const t2 = new Date('2026-05-03T12:00:00Z');
    const first = await recentsRepo.upsert(testDb, {
      subWalletId,
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA',
      now: t1,
    });
    const second = await recentsRepo.upsert(testDb, {
      subWalletId,
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'MUSA UPDATED',
      now: t2,
    });
    expect(second.firstSeenAt.toISOString()).toBe(first.firstSeenAt.toISOString());
    expect(second.lastUsedAt.toISOString()).toBe(t2.toISOString());
    expect(second.accountName).toBe('MUSA UPDATED');
  });

  it('listTop orders by last_used_at desc', async () => {
    const subWalletId = await seedSubWallet();
    await recentsRepo.upsert(testDb, {
      subWalletId,
      bankCode: '058',
      accountNumber: '1111111111',
      accountName: 'A',
      now: new Date('2026-05-01T10:00:00Z'),
    });
    await recentsRepo.upsert(testDb, {
      subWalletId,
      bankCode: '058',
      accountNumber: '2222222222',
      accountName: 'B',
      now: new Date('2026-05-02T10:00:00Z'),
    });
    await recentsRepo.upsert(testDb, {
      subWalletId,
      bankCode: '058',
      accountNumber: '3333333333',
      accountName: 'C',
      now: new Date('2026-05-03T10:00:00Z'),
    });
    const top = await recentsRepo.listTop(testDb, subWalletId, 2);
    expect(top.map((r) => r.accountName)).toEqual(['C', 'B']);
  });

  it('trimToLimit deletes rows beyond N most-recent', async () => {
    const subWalletId = await seedSubWallet();
    for (let i = 0; i < 5; i++) {
      await recentsRepo.upsert(testDb, {
        subWalletId,
        bankCode: '058',
        accountNumber: `${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
        accountName: `V${i}`,
        now: new Date(`2026-05-0${i + 1}T10:00:00Z`),
      });
    }
    const deleted = await recentsRepo.trimToLimit(testDb, subWalletId, 3);
    expect(deleted).toBe(2);
    const remaining = await recentsRepo.listTop(testDb, subWalletId, 10);
    expect(remaining.map((r) => r.accountName)).toEqual(['V4', 'V3', 'V2']);
  });
});
