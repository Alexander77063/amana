import { beforeEach, describe, expect, it } from 'vitest';
import { adminElevationsRepo } from '../../../src/modules/admin/admin-elevations.repo';
import { createServer } from '../../../src/server';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const app = createServer();

/** Old enough to be stuck, young enough that the force path is not in play. */
const hourOld = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const liveElevation = (adminUserId: string, transactionId: string) =>
  adminElevationsRepo.create(testDb, {
    adminUserId,
    transactionId,
    reason: 'customer called about a stuck payment',
    expiresAt: new Date(Date.now() + 900_000),
  });

const elevate = (cookie: string, body: unknown) =>
  app.request('/admin/money/elevations', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const resolve = (cookie: string, id: string) =>
  app.request(`/admin/money/transactions/${id}/resolve`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
  });

describe('GET /admin/money/stuck', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('lists stuck transactions for an owner', async () => {
    const { cookie } = await signedInAdmin('mr1@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(hourOld());

    const res = await app.request('/admin/money/stuck', { headers: { cookie } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.transactions.map((t: { id: string }) => t.id)).toContain(stuck.txnId);
  });

  it('refuses an operator without money.operate', async () => {
    const { cookie } = await signedInAdmin('mr2@amana-ng.com', ['ops']);

    expect((await app.request('/admin/money/stuck', { headers: { cookie } })).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await app.request('/admin/money/stuck')).status).toBe(401);
  });
});

describe('POST /admin/money/elevations', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('records an elevation and returns its expiry', async () => {
    const { cookie } = await signedInAdmin('mr3@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(hourOld());

    const res = await elevate(cookie, {
      transactionId: stuck.txnId,
      reason: 'customer called about a stuck payment',
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.elevationId).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();
  });

  // A ten-character floor keeps "fix" out of the audit log while staying typable at 2am.
  it('rejects a reason that is too short at the edge', async () => {
    const { cookie } = await signedInAdmin('mr4@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(hourOld());

    expect((await elevate(cookie, { transactionId: stuck.txnId, reason: 'fix' })).status).toBe(400);
  });

  it('rejects a malformed transaction id at the edge', async () => {
    const { cookie } = await signedInAdmin('mr5@amana-ng.com', ['owner']);

    expect(
      (await elevate(cookie, { transactionId: 'not-a-uuid', reason: 'a good long reason' })).status,
    ).toBe(400);
  });

  it('refuses an operator without money.operate', async () => {
    const { cookie } = await signedInAdmin('mr6@amana-ng.com', ['ops']);
    const stuck = await seedStuckTxn(hourOld());

    expect(
      (await elevate(cookie, { transactionId: stuck.txnId, reason: 'a good long reason' })).status,
    ).toBe(403);
  });
});

describe('POST /admin/money/transactions/:id/resolve', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('refuses without a live elevation', async () => {
    const { cookie } = await signedInAdmin('mr7@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(hourOld());

    const res = await resolve(cookie, stuck.txnId);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('elevation_required');
  });

  // Elevation unlocks a permission the operator already holds; it never grants one. `admin` does
  // not hold money.operate, so no elevation row can make this reachable. Invariant 3, asserted.
  it('refuses an admin even when an elevation row exists for the transaction', async () => {
    const { cookie, adminUserId } = await signedInAdmin('mr8@amana-ng.com', ['admin']);
    const stuck = await seedStuckTxn(hourOld());
    await liveElevation(adminUserId, stuck.txnId);

    expect((await resolve(cookie, stuck.txnId)).status).toBe(403);
  });

  // A MoneyOpsError carries its own status: 403 above, 409 here, through one mapping.
  it('maps a state refusal to 409 rather than 403', async () => {
    const { cookie, adminUserId } = await signedInAdmin('mr9@amana-ng.com', ['owner']);
    // Two minutes old: the sweep still owns it.
    const stuck = await seedStuckTxn(new Date(Date.now() - 120_000).toISOString());
    await liveElevation(adminUserId, stuck.txnId);

    const res = await resolve(cookie, stuck.txnId);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('too_early');
  });

  it('rejects a malformed transaction id at the edge', async () => {
    const { cookie } = await signedInAdmin('mr10@amana-ng.com', ['owner']);

    expect((await resolve(cookie, 'not-a-uuid')).status).toBe(400);
  });

  it('refuses an unauthenticated caller', async () => {
    const stuck = await seedStuckTxn(hourOld());

    const res = await app.request(`/admin/money/transactions/${stuck.txnId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(401);
  });
});
