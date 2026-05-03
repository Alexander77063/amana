import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('vendor_stickers (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const r = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_stickers' ORDER BY ordinal_position
    `);
    expect(r.map((x) => x.column_name)).toEqual([
      'uuid',
      'bank_code',
      'account_number',
      'account_name',
      'vendor_phone',
      'status',
      'registered_at',
    ]);
  });
});
