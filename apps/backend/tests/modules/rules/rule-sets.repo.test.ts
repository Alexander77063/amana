import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('rule_sets table (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rule_sets' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'sub_wallet_id', 'version', 'status', 'effective_from',
      'created_by_user_id', 'created_at',
    ]);
  });
});

describe('rules table (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rules' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'rule_set_id', 'kind', 'config_json', 'priority',
    ]);
  });
});
