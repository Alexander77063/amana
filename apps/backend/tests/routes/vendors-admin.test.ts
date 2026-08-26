import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditRepo } from '../../src/modules/audit/audit.repo';
import { vendorClaimsRepo } from '../../src/modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';
import { makeHousehold } from '../helpers/vendor-seed';

const NOW = new Date('2026-09-01T10:00:00Z');
const KEY = 'test-admin-key-that-is-at-least-32-chars';
const app = createServer();

function adminPost(path: string, body: unknown, key: string | null = KEY) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-admin-api-key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

function adminGet(path: string, key: string | null = KEY) {
  return app.request(path, {
    headers: { ...(key ? { 'x-admin-api-key': key } : {}) },
  });
}

describe('/vendors-admin', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = KEY;
  });

  it('401s without the admin key', async () => {
    const res = await adminPost('/vendors-admin/vendors/x/suspend', {}, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'admin_unauthorized' });
  });

  it('401s when ADMIN_API_KEY is unset — an unconfigured admin surface must fail closed', async () => {
    process.env.ADMIN_API_KEY = undefined;
    // biome-ignore lint/performance/noDelete: must be absent, not the string "undefined"
    delete process.env.ADMIN_API_KEY;
    const res = await adminPost('/vendors-admin/vendors/x/suspend', {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'admin_unauthorized' });
  });

  it('sets an ops category that outranks a claimed one', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'food',
      publicCode: 'AMNV-AAAAA-BBBBB',
      now: NOW,
    });

    const res = await adminPost(`/vendors-admin/vendors/${v.id}/category`, {
      category: 'transport',
    });
    expect(res.status).toBe(200);
    const after = await vendorsRepo.findById(testDb, v.id);
    expect(after?.category).toBe('transport');
    expect(after?.categorySource).toBe('ops');
  });

  it('approves a claim on an operator say-so, recording ownership_proof as ops', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'CORNER SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const phone = factories.phone();
    const attempt = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
      renewableSince: new Date(NOW.getTime() - 3_600_000),
    });
    if (!attempt) throw new Error('open attempt failed');

    const res = await adminPost(`/vendors-admin/vendors/${v.id}/approve-claim`, {
      phone,
      category: 'food',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicCode: string; displayName: string };
    expect(body.publicCode).toMatch(/^AMNV-/);
    expect(body.displayName).toBe('CORNER SHOP');

    const after = await vendorsRepo.findById(testDb, v.id);
    expect(after?.status).toBe('claimed');
    expect(after?.category).toBe('food');

    const rows = await testDb.execute<{ status: string; ownership_proof: string | null }>(
      sql`SELECT status, ownership_proof FROM vendor_claim_attempts WHERE id = ${attempt.id}`,
    );
    expect(rows[0]?.status).toBe('verified');
    expect(rows[0]?.ownership_proof).toBe('ops');

    // Spec §7.1: the approval must be recorded in the audit log with the operator as actor.
    const auditRows = await auditRepo.listByAction(testDb, 'vendor.claim_approved_by_ops');
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorKind).toBe('ops');
    expect(auditRows[0]?.subjectId).toBe(v.id);
    // The claimant's phone must never appear raw anywhere in the serialised payload.
    const serialised = JSON.stringify(auditRows[0]?.payloadJson);
    expect(serialised).not.toContain(phone);

    // A second approval hits the CAS in `vendorsRepo.claim` — the vendor is no longer `observed`.
    const again = await adminPost(`/vendors-admin/vendors/${v.id}/approve-claim`, {
      phone,
      category: 'food',
    });
    expect(again.status).toBe(409);
  });

  it('claim-queue lists pending attempts but not expired ones', async () => {
    const pendingVendor = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'PENDING SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!pendingVendor) throw new Error('promotion failed');
    const pendingAttempt = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: pendingVendor.id,
      phone: factories.phone(),
      expiresAt: new Date(Date.now() + 60_000),
      now: NOW,
      renewableSince: new Date(NOW.getTime() - 3_600_000),
    });
    if (!pendingAttempt) throw new Error('open attempt failed');

    const expiredVendor = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'EXPIRED SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!expiredVendor) throw new Error('promotion failed');
    const expiredAttempt = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: expiredVendor.id,
      phone: factories.phone(),
      expiresAt: new Date(Date.now() - 60_000),
      now: NOW,
      renewableSince: new Date(NOW.getTime() - 3_600_000),
    });
    if (!expiredAttempt) throw new Error('open attempt failed');
    // Actually expire it, the way the sweep job would — a stale-but-still-`pending` row would be
    // exactly the false positive this test exists to catch.
    await vendorClaimsRepo.expireOverdue(testDb, new Date());

    const res = await adminGet('/vendors-admin/claim-queue');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attempts: Array<{ id: string }> };
    const ids = body.attempts.map((a) => a.id);
    expect(ids).toContain(pendingAttempt.id);
    expect(ids).not.toContain(expiredAttempt.id);
  });

  it('suspend actually flips the stored vendor status', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'BAD ACTOR SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'food',
      publicCode: 'AMNV-CCCCC-DDDDD',
      now: NOW,
    });

    const res = await adminPost(`/vendors-admin/vendors/${v.id}/suspend`, {});
    expect(res.status).toBe(200);

    const after = await vendorsRepo.findById(testDb, v.id);
    expect(after?.status).toBe('suspended');
  });

  it('audits an ops category override with the previous claimed answer', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'food',
      publicCode: 'AMNV-EEEEE-FFFFF',
      now: NOW,
    });

    const res = await adminPost(`/vendors-admin/vendors/${v.id}/category`, {
      category: 'transport',
    });
    expect(res.status).toBe(200);

    // Read from the DB, not the response — the response says nothing about the audit.
    const rows = await auditRepo.listByAction(testDb, 'vendor.category_set_by_ops');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorKind).toBe('ops');
    expect(rows[0]?.subjectKind).toBe('vendor');
    expect(rows[0]?.subjectId).toBe(v.id);
    expect(rows[0]?.payloadJson).toMatchObject({
      category: 'transport',
      previousCategory: 'food',
      previousCategorySource: 'claimed',
    });
  });

  it('audits a suspension', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'BAD ACTOR SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const phone = factories.phone();
    await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone,
      category: 'food',
      publicCode: 'AMNV-GGGGG-HHHHH',
      now: NOW,
    });

    const res = await adminPost(`/vendors-admin/vendors/${v.id}/suspend`, {});
    expect(res.status).toBe(200);

    const rows = await auditRepo.listByAction(testDb, 'vendor.suspended_by_ops');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorKind).toBe('ops');
    expect(rows[0]?.subjectId).toBe(v.id);
    expect(rows[0]?.payloadJson).toMatchObject({ previousStatus: 'claimed' });
    // The claimant's phone must never appear raw in an audit payload.
    expect(JSON.stringify(rows[0]?.payloadJson)).not.toContain(phone);
  });

  it('audits an enforcement flip, keeping false and null distinguishable', async () => {
    const { householdId } = await makeHousehold(testDb);

    for (const value of [true, false, null] as const) {
      const res = await adminPost(`/vendors-admin/households/${householdId}/enforcement`, {
        enforced: value,
      });
      expect(res.status).toBe(200);
    }

    const rows = await auditRepo.listByAction(testDb, 'vendor.enforcement_set_by_ops');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.actorKind).toBe('ops');
      // The subject is the HOUSEHOLD — the switch is scoped to one household, not to a vendor.
      expect(row.subjectKind).toBe('household');
      expect(row.subjectId).toBe(householdId);
    }
    const enforced = rows.map((r) => (r.payloadJson as { enforced: boolean | null }).enforced);
    // `null` ("inherit the global default") must be recorded as a value, not as a missing key —
    // it is a different commitment from `false`.
    expect(enforced.sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      false,
      null,
      true,
    ]);
  });

  it('leaves no audit row when the write changed nothing', async () => {
    const res = await adminPost(`/vendors-admin/vendors/${factories.householdId()}/suspend`, {});
    expect(res.status).toBe(404);
    expect(await auditRepo.listByAction(testDb, 'vendor.suspended_by_ops')).toHaveLength(0);
  });

  it('rolls the state change back when the audit write fails — the two are inseparable', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(auditRepo, 'append').mockRejectedValue(new Error('boom'));

    await adminPost(`/vendors-admin/vendors/${v.id}/suspend`, {});

    // Assert the STATE, not the status code: an ops action that lands without its record is
    // exactly the hole this fix closes, so the vendor must still be un-suspended.
    const after = await vendorsRepo.findById(testDb, v.id);
    expect(after?.status).toBe('observed');
  });

  it('400s a category outside the shared spend vocabulary on the ops rail too', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOP',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    const bad = await adminPost(`/vendors-admin/vendors/${v.id}/category`, {
      category: 'Groceries',
    });
    expect(bad.status).toBe(400);
    const badApprove = await adminPost(`/vendors-admin/vendors/${v.id}/approve-claim`, {
      phone: factories.phone(),
      category: 'food ',
    });
    expect(badApprove.status).toBe(400);

    // Nothing was written by either rejection.
    const after = await vendorsRepo.findById(testDb, v.id);
    expect(after?.category).toBeNull();
    expect(after?.status).toBe('observed');
  });

  it('400s a non-uuid vendor id rather than 500ing on the driver', async () => {
    const res = await adminPost('/vendors-admin/vendors/not-a-uuid/suspend', {});
    expect(res.status).toBe(400);
  });

  it('flips household enforcement on, off, and back to inherit', async () => {
    const { householdId } = await makeHousehold(testDb);

    for (const [value, expected] of [
      [true, true],
      [false, false],
      [null, null],
    ] as const) {
      const res = await adminPost(`/vendors-admin/households/${householdId}/enforcement`, {
        enforced: value,
      });
      expect(res.status).toBe(200);
      const rows = await testDb.execute<{ vendor_category_enforced: boolean | null }>(
        sql`SELECT vendor_category_enforced FROM households WHERE id = ${householdId}`,
      );
      expect(rows[0]?.vendor_category_enforced).toBe(expected);
    }
  });

  it('404s enforcement for an unknown household', async () => {
    const res = await adminPost(
      `/vendors-admin/households/${factories.householdId()}/enforcement`,
      {
        enforced: true,
      },
    );
    expect(res.status).toBe(404);
  });
});
