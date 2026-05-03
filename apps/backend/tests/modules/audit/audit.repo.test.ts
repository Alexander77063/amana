import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('audit_log (immutability)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

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
    await expect(testDb.execute(sql`DELETE FROM audit_log WHERE id = ${id}`)).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('audit.repo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

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
    expect(list.map((r) => r.action).sort()).toEqual(['anchor.webhook.received', 'txn.rule_eval']);
  });
});

describe('auditRepo.listByActor + listByAction', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('listByActor returns entries for that actor only', async () => {
    const u1 = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const u2 = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    await auditRepo.append(testDb, {
      actorKind: 'user',
      actorUserId: u1.id,
      action: 'a',
      subjectKind: 'x',
      subjectId: factories.txnId(),
      payloadJson: {},
    });
    await auditRepo.append(testDb, {
      actorKind: 'user',
      actorUserId: u2.id,
      action: 'a',
      subjectKind: 'x',
      subjectId: factories.txnId(),
      payloadJson: {},
    });
    const list = await auditRepo.listByActor(testDb, u1.id);
    expect(list).toHaveLength(1);
  });

  it('listByAction returns entries with that action only', async () => {
    const subjectId = factories.txnId();
    await auditRepo.append(testDb, {
      actorKind: 'system',
      action: 'txn.rule_eval',
      subjectKind: 'transaction',
      subjectId,
      payloadJson: {},
    });
    await auditRepo.append(testDb, {
      actorKind: 'system',
      action: 'txn.settled',
      subjectKind: 'transaction',
      subjectId,
      payloadJson: {},
    });
    const list = await auditRepo.listByAction(testDb, 'txn.rule_eval');
    expect(list).toHaveLength(1);
    expect(list[0]?.action).toBe('txn.rule_eval');
  });
});
