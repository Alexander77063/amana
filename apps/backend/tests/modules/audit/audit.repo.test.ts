import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { auditRepo } from '../../../src/modules/audit/audit.repo';

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

describe('audit.repo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('append + listBySubject', async () => {
    const subjectId = factories.txnId();
    await auditRepo.append(testDb, {
      actorKind: 'system',
      action: 'txn.rule_eval',
      subjectKind: 'transaction',
      subjectId,
      payloadJson: { decision: 'allow' },
    });
    await auditRepo.append(testDb, {
      actorKind: 'partner',
      action: 'anchor.webhook.received',
      subjectKind: 'transaction',
      subjectId,
      payloadJson: { status: 'success' },
    });
    const list = await auditRepo.listBySubject(testDb, subjectId);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.action).sort()).toEqual(
      ['anchor.webhook.received', 'txn.rule_eval'],
    );
  });
});
