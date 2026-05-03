import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';

describe('audit_log (immutability)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('INSERT allowed; UPDATE / DELETE blocked', async () => {
    const id = factories.txnId();
    const subjectId = factories.txnId();
    await testDb.execute(sql`
      INSERT INTO audit_log (id, actor_kind, action, subject_kind, subject_id, payload_json)
      VALUES (${id}, 'system', 'test.action', 'test', ${subjectId}, '{"k":"v"}'::jsonb)
    `);
    await expect(
      testDb.execute(sql`UPDATE audit_log SET action = 'changed' WHERE id = ${id}`),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.execute(sql`DELETE FROM audit_log WHERE id = ${id}`),
    ).rejects.toThrow(/append-only/);
  });
});
