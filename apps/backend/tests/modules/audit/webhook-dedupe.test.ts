import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../../src/db/schema';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

function webhookRow(subjectId: string) {
  return {
    actorKind: 'partner' as const,
    action: 'anchor.webhook.transfer.completed',
    subjectKind: 'anchor_webhook',
    subjectId,
    payloadJson: {},
  };
}

describe('audit_log anchor_webhook dedupe index', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects a second anchor_webhook row with the same subject_id', async () => {
    const subjectId = factories.txnId();
    await testDb.insert(auditLog).values(webhookRow(subjectId));
    await expect(testDb.insert(auditLog).values(webhookRow(subjectId))).rejects.toThrow(
      /unique|duplicate/i,
    );
  });

  it('still allows duplicate subject_ids for non-webhook audit subjects', async () => {
    const subjectId = factories.txnId();
    await testDb
      .insert(auditLog)
      .values({ ...webhookRow(subjectId), subjectKind: 'transaction', action: 'txn.x' });
    await expect(
      testDb
        .insert(auditLog)
        .values({ ...webhookRow(subjectId), subjectKind: 'transaction', action: 'txn.x' }),
    ).resolves.toBeDefined();
  });
});
