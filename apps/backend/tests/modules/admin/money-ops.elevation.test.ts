import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../../src/db/schema';
import { moneyOpsService } from '../../../src/modules/admin/money-ops.service';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-05-03T12:00:00Z');

describe('moneyOpsService.grantElevation', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('records an elevation with an expiry derived from config', async () => {
    const { adminUserId } = await signedInAdmin('e1@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    const out = await moneyOpsService.grantElevation(testDb, {
      actorAdminUserId: adminUserId,
      transactionId: txnId,
      reason: 'customer called; money stuck since Tuesday',
      now: NOW,
    });

    expect(out.elevationId).toBeTruthy();
    // Default MONEY_ELEVATION_SECONDS is 900.
    expect(out.expiresAt.getTime()).toBe(NOW.getTime() + 900_000);
  });

  it('audits the grant with the reason in the payload', async () => {
    const { adminUserId } = await signedInAdmin('e2@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    await moneyOpsService.grantElevation(testDb, {
      actorAdminUserId: adminUserId,
      transactionId: txnId,
      reason: 'audited reason',
      now: NOW,
    });

    const rows = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'money.elevation_granted'), eq(auditLog.subjectId, txnId)));

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.payloadJson)).toContain('audited reason');
  });

  it('refuses a blank reason', async () => {
    const { adminUserId } = await signedInAdmin('e3@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    await expect(
      moneyOpsService.grantElevation(testDb, {
        actorAdminUserId: adminUserId,
        transactionId: txnId,
        reason: '   ',
        now: NOW,
      }),
    ).rejects.toThrow(/reason/i);
  });
});
