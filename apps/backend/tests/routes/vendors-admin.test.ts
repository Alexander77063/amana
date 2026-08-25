import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('/vendors-admin', () => {
  beforeEach(async () => {
    await truncateAll();
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

    // A second approval hits the CAS in `vendorsRepo.claim` — the vendor is no longer `observed`.
    const again = await adminPost(`/vendors-admin/vendors/${v.id}/approve-claim`, {
      phone,
      category: 'food',
    });
    expect(again.status).toBe(409);
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
