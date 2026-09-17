import { beforeEach, describe, expect, it } from 'vitest';
import { adminElevationsRepo } from '../../../src/modules/admin/admin-elevations.repo';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-05-03T12:00:00Z');
const in15Min = new Date('2026-05-03T12:15:00Z');

describe('adminElevationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('finds a live elevation for the operator and transaction that own it', async () => {
    const { adminUserId } = await signedInAdmin('r1@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'stuck two days',
      expiresAt: in15Min,
    });

    const live = await adminElevationsRepo.findLive(testDb, adminUserId, txnId, NOW);

    expect(live).not.toBeNull();
    expect(live?.reason).toBe('stuck two days');
  });

  it('does not find an expired elevation', async () => {
    const { adminUserId } = await signedInAdmin('r2@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'expired',
      expiresAt: new Date('2026-05-03T11:59:59Z'),
    });

    expect(await adminElevationsRepo.findLive(testDb, adminUserId, txnId, NOW)).toBeNull();
  });

  it('does not find a consumed elevation', async () => {
    const { adminUserId } = await signedInAdmin('r3@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    const row = await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'used already',
      expiresAt: in15Min,
    });
    await adminElevationsRepo.markConsumed(testDb, row.id, NOW);

    expect(await adminElevationsRepo.findLive(testDb, adminUserId, txnId, NOW)).toBeNull();
  });

  // Scoping is the whole security property: an elevation is authority over ONE row.
  it('does not find an elevation raised for a different transaction', async () => {
    const { adminUserId } = await signedInAdmin('r4@amana-ng.com', ['owner']);
    const a = await seedStuckTxn('2026-05-03T11:00:00Z');
    const b = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: a.txnId,
      reason: 'for A only',
      expiresAt: in15Min,
    });

    expect(await adminElevationsRepo.findLive(testDb, adminUserId, b.txnId, NOW)).toBeNull();
  });

  it('does not find a colleague elevation raised for the same transaction', async () => {
    const mine = await signedInAdmin('r5@amana-ng.com', ['owner']);
    const theirs = await signedInAdmin('r6@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId: theirs.adminUserId,
      transactionId: txnId,
      reason: 'their elevation',
      expiresAt: in15Min,
    });

    expect(await adminElevationsRepo.findLive(testDb, mine.adminUserId, txnId, NOW)).toBeNull();
  });

  // The `consumed_at IS NULL` predicate on the update is a concurrency guard: two resolves racing
  // must not both spend the same authorisation.
  it('consumes an elevation once and never twice', async () => {
    const { adminUserId } = await signedInAdmin('r7@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    const row = await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'once',
      expiresAt: in15Min,
    });

    const first = await adminElevationsRepo.markConsumed(testDb, row.id, NOW);
    const second = await adminElevationsRepo.markConsumed(testDb, row.id, NOW);

    expect(first?.consumedAt).not.toBeNull();
    expect(second).toBeNull();
  });
});
