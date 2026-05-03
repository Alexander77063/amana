import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeTestDb, testDb, truncateAll } from '../../helpers/test-db';

describe('users table (schema)', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    // close handled by global teardown
  });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position
    `);
    const names = cols.map((r) => r.column_name);
    expect(names).toEqual(['id', 'role', 'phone', 'bvn', 'nin', 'kyc_tier', 'status', 'created_at']);
  });

  it('rejects duplicate phones', async () => {
    await testDb.execute(sql`
      INSERT INTO users (role, phone, nin, kyc_tier) VALUES ('principal', '+2348011111111', '11111111111', '2')
    `);
    await expect(
      testDb.execute(sql`
        INSERT INTO users (role, phone, nin, kyc_tier) VALUES ('agent', '+2348011111111', '22222222222', '1')
      `),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
