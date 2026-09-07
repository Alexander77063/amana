import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimsRepo } from '../../src/modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer({ adminOidcProvider: stubOidcProvider() });
const NOW = new Date();

async function promote(displayName: string, accountNumber = factories.bankAccount()) {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber,
    displayName,
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

describe('vendor reads for ops', () => {
  beforeEach(truncateAll);

  it('GET /vendors-admin/vendors/:id masks the account number and lists claim attempts', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const v = await promote('CORNER SHOP', '0123456789');
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(Date.now() + 60_000),
      now: NOW,
    });

    const res = await app.request(`/vendors-admin/vendors/${v.id}`, {
      headers: { cookie: ops.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vendor: { accountNumberMasked: string; displayName: string; status: string };
      claimAttempts: Array<{ status: string }>;
    };
    expect(body.vendor.displayName).toBe('CORNER SHOP');
    expect(body.vendor.accountNumberMasked).toBe('••••6789');
    expect(JSON.stringify(body)).not.toContain('0123456789');
    expect(body.claimAttempts).toHaveLength(1);
    expect(body.claimAttempts[0]?.status).toBe('pending');
  });

  it('GET /vendors-admin/vendors/:id is 404 for an unknown vendor and 400 for a bad id', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const missing = await app.request(
      '/vendors-admin/vendors/00000000-0000-4000-8000-000000000000',
      { headers: { cookie: ops.cookie } },
    );
    expect(missing.status).toBe(404);
    const bad = await app.request('/vendors-admin/vendors/not-a-uuid', {
      headers: { cookie: ops.cookie },
    });
    expect(bad.status).toBe(400);
  });

  it('GET /vendors-admin/vendors filters by status and searches by name or code', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const a = await promote('MAMA PUT KITCHEN');
    const b = await promote('BOLA TYRES');
    await vendorsRepo.setStatus(testDb, b.id, 'suspended');

    const observed = await app.request('/vendors-admin/vendors?status=observed', {
      headers: { cookie: ops.cookie },
    });
    const ob = (await observed.json()) as { vendors: Array<{ id: string }> };
    expect(ob.vendors.map((v) => v.id)).toEqual([a.id]);

    const byName = await app.request('/vendors-admin/vendors?q=tyres', {
      headers: { cookie: ops.cookie },
    });
    const bn = (await byName.json()) as { vendors: Array<{ id: string }> };
    expect(bn.vendors.map((v) => v.id)).toEqual([b.id]);
  });

  it('claim-queue rows carry a masked vendor summary', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const v = await promote('QUEUE SHOP', '1122334455');
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(Date.now() + 60_000),
      now: NOW,
    });
    const res = await app.request('/vendors-admin/claim-queue', {
      headers: { cookie: ops.cookie },
    });
    const body = (await res.json()) as {
      attempts: Array<{ vendor: { displayName: string; accountNumberMasked: string } | null }>;
    };
    expect(body.attempts[0]?.vendor?.displayName).toBe('QUEUE SHOP');
    expect(body.attempts[0]?.vendor?.accountNumberMasked).toBe('••••4455');
    expect(JSON.stringify(body)).not.toContain('1122334455');
  });

  it('refuses an admin without vendor.read', async () => {
    const admin = await signedInAdmin('admin@amana-ng.com', ['admin']);
    const res = await app.request('/vendors-admin/vendors', { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(403);
  });
});
