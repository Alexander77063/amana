import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('bump_requests + one_shot_tokens (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('bump_requests has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bump_requests' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'transaction_id', 'sub_wallet_id', 'requested_by_user_id',
      'amount_kobo', 'vendor_resolved_name', 'agent_note', 'status',
      'expires_at', 'decided_by_user_id', 'decided_at', 'created_at',
    ]);
  });

  it('one_shot_tokens has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'one_shot_tokens' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'token', 'bump_request_id', 'consumed_at', 'expires_at', 'created_at',
    ]);
  });
});
