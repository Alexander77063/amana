import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { testDb } from '../../helpers/test-db';

describe('notifications schema', () => {
  it('notification_preferences has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notification_preferences'
    `);
    const set = new Set(cols.map((r) => r.column_name));
    expect(set).toEqual(
      new Set(['user_id', 'kind', 'channel', 'preference', 'threshold_kobo', 'updated_at']),
    );
  });

  it('device_tokens has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'device_tokens'
    `);
    const set = new Set(cols.map((r) => r.column_name));
    expect(set).toEqual(
      new Set([
        'id',
        'user_id',
        'expo_push_token',
        'platform',
        'device_label',
        'registered_at',
        'last_seen_at',
      ]),
    );
  });

  it('notifications has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notifications'
    `);
    const set = new Set(cols.map((r) => r.column_name));
    expect(set).toEqual(
      new Set([
        'id',
        'recipient_user_id',
        'kind',
        'channel',
        'status',
        'dedupe_key',
        'payload_json',
        'provider_receipt',
        'error_message',
        'created_at',
        'updated_at',
      ]),
    );
  });
});
