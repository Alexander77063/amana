import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('wallet tables (schema)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('master_wallets has the expected columns', async () => {
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
    ]);
  });

  it('ledger_accounts.sub_wallet_id is nullable (set only when kind=sub)', async () => {
    const cols = await testDb.execute<{ is_nullable: string; column_name: string }>(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'ledger_accounts'
    `);
    const subCol = cols.find((r) => r.column_name === 'sub_wallet_id');
    expect(subCol?.is_nullable).toBe('YES');
  });
});
