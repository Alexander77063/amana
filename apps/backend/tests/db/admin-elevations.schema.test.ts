import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminElevations } from '../../src/db/schema';
import { signedInAdmin } from '../helpers/admin-session';
import { seedStuckTxn } from '../helpers/stuck-txn';
import { testDb, truncateAll } from '../helpers/test-db';

describe('admin_elevations', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stores an elevation and defaults created_at and consumed_at', async () => {
    const { adminUserId } = await signedInAdmin('elev1@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    const [row] = await testDb
      .insert(adminElevations)
      .values({
        adminUserId,
        transactionId: txnId,
        reason: 'customer called, money stuck 2 days',
        expiresAt: new Date('2026-05-03T12:15:00Z'),
      })
      .returning();

    expect(row?.consumedAt).toBeNull();
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.reason).toBe('customer called, money stuck 2 days');
  });

  // Raw SQL on purpose: the typed insert will not let us omit a NOT NULL column, and the point of
  // this test is that the DATABASE refuses it, not that TypeScript does.
  it('refuses an elevation with no reason', async () => {
    const { adminUserId } = await signedInAdmin('elev2@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    await expect(
      testDb.execute(
        sql`INSERT INTO admin_elevations (admin_user_id, transaction_id, expires_at)
            VALUES (${adminUserId}::uuid, ${txnId}::uuid, now())`,
      ),
    ).rejects.toThrow(/null value in column "reason"/);
  });

  it('refuses an elevation pointing at a transaction that does not exist', async () => {
    const { adminUserId } = await signedInAdmin('elev3@amana-ng.com', ['owner']);

    await expect(
      testDb.insert(adminElevations).values({
        adminUserId,
        transactionId: '00000000-0000-0000-0000-000000000000',
        reason: 'no such txn',
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/admin_elevations_transaction_id_transactions_id_fk/);
  });
});
