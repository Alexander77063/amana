import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('master-wallets.repo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('master_wallets has the expected columns (schema)', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'master_wallets' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id',
      'household_id',
      'anchor_virtual_account',
      'anchor_bank_code',
      'currency',
      'status',
      'created_at',
      'anchor_account_id',
    ]);
  });

  it('ledger_accounts.sub_wallet_id is nullable', async () => {
    const cols = await testDb.execute<{ is_nullable: string; column_name: string }>(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'ledger_accounts'
    `);
    expect(cols.find((r) => r.column_name === 'sub_wallet_id')?.is_nullable).toBe('YES');
  });

  it('provision creates wallet + 3 ledger accounts atomically', async () => {
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

    expect(provisioned.master.householdId).toBe(hh.id);
    expect(provisioned.ledgerAccountIds.master).toBeDefined();
    expect(provisioned.ledgerAccountIds.suspense).toBeDefined();
    expect(provisioned.ledgerAccountIds.fee).toBeDefined();

    const las = await testDb.execute<{ kind: string; count: string }>(sql`
      SELECT kind, COUNT(*)::text AS count FROM ledger_accounts
      WHERE master_wallet_id = ${provisioned.master.id} GROUP BY kind
    `);
    const counts = Object.fromEntries(las.map((r) => [r.kind, r.count]));
    expect(counts.master).toBe('1');
    expect(counts.suspense).toBe('1');
    expect(counts.fee).toBe('1');
  });

  it('findByHousehold resolves the wallet', async () => {
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
    const found = await masterWalletsRepo.findByHousehold(testDb, hh.id);
    expect(found?.id).toBe(provisioned.master.id);
  });
});
