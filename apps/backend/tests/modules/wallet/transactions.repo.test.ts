import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

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

  it('geolocation is a geometry(Point, 4326)', async () => {
    const r = await testDb.execute<{ udt_name: string }>(sql`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'geolocation'
    `);
    expect(r[0]?.udt_name).toBe('geometry');
  });
});
