import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog } from '../../../src/db/schema';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { adminElevationsRepo } from '../../../src/modules/admin/admin-elevations.repo';
import { MoneyOpsError, moneyOpsService } from '../../../src/modules/admin/money-ops.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-05-03T12:00:00Z');
/** 1h old: past the 15-minute min age, well short of the 24h force threshold. */
const HOUR_OLD = '2026-05-03T11:00:00Z';
/** 3 days old: past the force threshold. */
const ANCIENT = '2026-04-30T12:00:00Z';

const adapterFor = (fetchImpl: typeof fetch): AnchorAdapter =>
  new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });

const jsonOnce = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;

const elevateFor = (adminUserId: string, transactionId: string) =>
  adminElevationsRepo.create(testDb, {
    adminUserId,
    transactionId,
    reason: 'customer called',
    expiresAt: new Date(NOW.getTime() + 900_000),
  });

const countPostings = async (transactionId: string) =>
  (await postingsRepo.listByTransaction(testDb, transactionId)).length;

describe('moneyOpsService.listStuck', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // The incident this feature exists for -- a reference fault at Anchor -- produces many stuck rows
  // at once, so the queue is unbounded exactly when it is most loaded.
  it('caps how many rows it returns', async () => {
    await seedStuckTxn(HOUR_OLD);
    await seedStuckTxn(HOUR_OLD);
    await seedStuckTxn(HOUR_OLD);

    expect(await moneyOpsService.listStuck(testDb, NOW, 2)).toHaveLength(2);
  });

  it('returns the oldest first, because those have been stuck longest', async () => {
    const older = await seedStuckTxn('2026-05-03T09:00:00Z');
    await seedStuckTxn('2026-05-03T11:00:00Z');

    const rows = await moneyOpsService.listStuck(testDb, NOW);

    expect(rows[0]?.id).toBe(older.txnId);
  });
});

describe('moneyOpsService.resolveStuckTransaction', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('settles when Anchor reports COMPLETED', async () => {
    const { adminUserId } = await signedInAdmin('m1@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({
          id: 'tr-1',
          status: 'COMPLETED',
          reference: stuck.idempotencyKey,
          nibssSessionId: '777',
        }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    expect(out.outcome).toBe('settled');
    expect((await transactionsRepo.findById(testDb, stuck.txnId))?.status).toBe('settled');
  });

  it('reverses when Anchor reports FAILED, returning the money', async () => {
    const { adminUserId } = await signedInAdmin('m2@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({
          id: 'tr-1',
          status: 'FAILED',
          reference: stuck.idempotencyKey,
          failureReason: 'recipient closed',
        }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    expect(out.outcome).toBe('reversed');
    expect((await transactionsRepo.findById(testDb, stuck.txnId))?.status).toBe('failed');
  });

  it('refuses a transaction Anchor still reports as PENDING, and writes no postings', async () => {
    const { adminUserId } = await signedInAdmin('m3@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);
    const before = await countPostings(stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ id: 'tr-1', status: 'PENDING', reference: stuck.idempotencyKey })),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'still_pending' });

    expect(await countPostings(stuck.txnId)).toBe(before);
  });

  it('force-reverses an ancient transaction Anchor has no record of, and audits it distinctly', async () => {
    const { adminUserId } = await signedInAdmin('m4@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(ANCIENT);
    await elevateFor(adminUserId, stuck.txnId);

    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(jsonOnce({ error: 'not_found' }, 404)),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    expect(out.outcome).toBe('reversed');
    const audits = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'money.force_reversed'), eq(auditLog.subjectId, stuck.txnId)));
    expect(audits).toHaveLength(1);
  });

  it('refuses to force-reverse a transaction that is not old enough', async () => {
    const { adminUserId } = await signedInAdmin('m5@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ error: 'not_found' }, 404)),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'too_early' });
  });

  // THE test. An Anchor outage must never be laundered into a reversal, even on an ancient row
  // where the force path would otherwise fire.
  it('refuses when the Anchor call fails, and never force-reverses on an error', async () => {
    const { adminUserId } = await signedInAdmin('m6@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(ANCIENT);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ error: 'boom' }, 500)),
        {
          actorAdminUserId: adminUserId,
          transactionId: stuck.txnId,
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'anchor_unreachable' });

    expect((await transactionsRepo.findById(testDb, stuck.txnId))?.status).toBe('in_flight');
  });

  it('leaves the elevation live when the Anchor call fails, so a retry needs no new reason', async () => {
    const { adminUserId } = await signedInAdmin('m7@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ error: 'boom' }, 500)),
        {
          actorAdminUserId: adminUserId,
          transactionId: stuck.txnId,
          now: NOW,
        },
      ),
    ).rejects.toBeInstanceOf(MoneyOpsError);

    expect(
      await adminElevationsRepo.findLive(testDb, adminUserId, stuck.txnId, NOW),
    ).not.toBeNull();

    // And the retry succeeds without a fresh elevation.
    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(jsonOnce({ id: 'tr-1', status: 'FAILED', reference: stuck.idempotencyKey })),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );
    expect(out.outcome).toBe('reversed');
  });

  it('consumes the elevation on success, so a second resolve is refused', async () => {
    const { adminUserId } = await signedInAdmin('m8@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);
    const input = { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW };

    await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(jsonOnce({ id: 'tr-1', status: 'FAILED', reference: stuck.idempotencyKey })),
      input,
    );
    const postingsAfterFirst = await countPostings(stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ id: 'tr-1', status: 'FAILED', reference: stuck.idempotencyKey })),
        input,
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });

    // The money moved exactly once.
    expect(await countPostings(stuck.txnId)).toBe(postingsAfterFirst);
  });

  it('refuses with no elevation at all', async () => {
    const { adminUserId } = await signedInAdmin('m9@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(vi.fn() as unknown as typeof fetch),
        {
          actorAdminUserId: adminUserId,
          transactionId: stuck.txnId,
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('refuses on an expired elevation', async () => {
    const { adminUserId } = await signedInAdmin('m10@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: stuck.txnId,
      reason: 'stale',
      expiresAt: new Date(NOW.getTime() - 1000),
    });

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(vi.fn() as unknown as typeof fetch),
        {
          actorAdminUserId: adminUserId,
          transactionId: stuck.txnId,
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('refuses an elevation raised for a different transaction', async () => {
    const { adminUserId } = await signedInAdmin('m11@amana-ng.com', ['owner']);
    const a = await seedStuckTxn(HOUR_OLD);
    const b = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, a.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(vi.fn() as unknown as typeof fetch),
        {
          actorAdminUserId: adminUserId,
          transactionId: b.txnId,
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('refuses a transaction that is too young, without calling Anchor', async () => {
    const { adminUserId } = await signedInAdmin('m12@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn('2026-05-03T11:58:00Z'); // 2 minutes old
    await elevateFor(adminUserId, stuck.txnId);
    const fetchSpy = vi.fn();

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(fetchSpy as unknown as typeof fetch),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'too_early' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['settled', 'failed', 'reversed'] as const)(
    'refuses a transaction already in terminal status %s',
    async (status) => {
      const { adminUserId } = await signedInAdmin(`m13${status}@amana-ng.com`, ['owner']);
      const stuck = await seedStuckTxn(HOUR_OLD);
      await elevateFor(adminUserId, stuck.txnId);
      await transactionsRepo.setStatus(testDb, stuck.txnId, status);

      await expect(
        moneyOpsService.resolveStuckTransaction(
          testDb,
          adapterFor(vi.fn() as unknown as typeof fetch),
          { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
        ),
      ).rejects.toMatchObject({ code: 'not_stuck' });
    },
  );

  it('audits every refusal with its reason code', async () => {
    const { adminUserId } = await signedInAdmin('m14@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ id: 'tr-1', status: 'PENDING', reference: stuck.idempotencyKey })),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toBeInstanceOf(MoneyOpsError);

    const audits = await testDb
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, 'money.resolve_refused'), eq(auditLog.subjectId, stuck.txnId)),
      );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.payloadJson)).toContain('still_pending');
  });

  it('never writes the operator reason onto the transaction record', async () => {
    const { adminUserId } = await signedInAdmin('m15@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: stuck.txnId,
      reason: 'OPERATOR_SECRET_NOTE',
      expiresAt: new Date(NOW.getTime() + 900_000),
    });

    await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({
          id: 'tr-1',
          status: 'FAILED',
          reference: stuck.idempotencyKey,
          failureReason: 'recipient closed',
        }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    // This is why the rule is load-bearing, not cosmetic: `reverse` calls
    // `transactionsRepo.setErrorMessage(txn.id, input.reason)` (reversal.service.ts:75-76), so
    // whatever is passed as `reason` is written onto the ORIGINAL transaction's error_message.
    // Passing the operator's justification there would persist internal staff notes on a
    // customer's transaction record.
    const original = await transactionsRepo.findById(testDb, stuck.txnId);
    expect(original?.errorMessage).toBe('recipient closed');
    expect(original?.errorMessage).not.toContain('OPERATOR_SECRET_NOTE');
  });
});
