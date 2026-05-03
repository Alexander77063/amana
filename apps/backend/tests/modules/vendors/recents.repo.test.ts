import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('vendor_recents (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_recents' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'sub_wallet_id', 'bank_code', 'account_number',
      'account_name', 'last_used_at', 'first_seen_at',
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
