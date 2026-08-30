import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorAdapterSingleton } from '../../src/integrations/anchor';
import { AnchorHttpError } from '../../src/integrations/anchor/client';
import { retailerOnboardingService } from '../../src/modules/marketplace/retailer-onboarding.service';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const JSON_HEADERS = { 'content-type': 'application/json' };

// Sub-plan A1 Task 4: the shared `x-admin-api-key` is gone. Every request below is made by a
// signed-in member of staff holding `retailer.read`/`retailer.write`, and `ADMIN` is now that
// operator's session cookie rather than a secret anyone could hold.
let ADMIN: Record<string, string>;

const applyBody = {
  businessName: 'Ada Salon',
  payoutBankCode: '000014',
  payoutAccountNumber: '0123456789',
};

const app = createServer();

function post(path: string, body?: unknown, headers: Record<string, string> = ADMIN) {
  return app.request(path, {
    method: 'POST',
    headers: { ...headers, ...JSON_HEADERS },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

beforeEach(async () => {
  await truncateAll();
  vi.restoreAllMocks();
  const { cookie } = await signedInAdmin('ops@amana-ng.com', ['ops']);
  ADMIN = { cookie };
});

describe('retailer admin routes: auth', () => {
  it('401s every route without a staff session', async () => {
    const id = factories.userId();
    const responses = await Promise.all([
      post('/retailers', applyBody, {}),
      app.request('/retailers'),
      app.request(`/retailers/${id}`),
      post(`/retailers/${id}/kyb`, { bvn: '22222222222' }, {}),
      post(`/retailers/${id}/approve`, undefined, {}),
      post(`/retailers/${id}/suspend`, undefined, {}),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
  });

  it('401s on a forged session cookie', async () => {
    const res = await post('/retailers', applyBody, {
      cookie: 'amana_admin_session=not-a-real-session',
    });
    expect(res.status).toBe(401);
  });

  it('403s a signed-in admin who does not hold retailer permissions', async () => {
    // The distinction the shared key could never make: this person is genuinely staff, and still
    // has no business admitting or suspending a marketplace business.
    const { cookie } = await signedInAdmin('iam@amana-ng.com', ['admin']);
    const res = await post('/retailers', applyBody, { cookie });
    expect(res.status).toBe(403);
  });
});

describe('POST /retailers', () => {
  it('creates an applied retailer', async () => {
    const res = await post('/retailers', applyBody);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; onboardingStatus: string };
    expect(body.onboardingStatus).toBe('applied');
    expect(await retailersRepo.findById(testDb, body.id)).toBeDefined();
  });

  it('400s on a malformed body', async () => {
    const res = await post('/retailers', { businessName: '' });
    expect(res.status).toBe(400);
  });

  it('400s on a non-numeric payout account number', async () => {
    const res = await post('/retailers', { ...applyBody, payoutAccountNumber: 'abcdefghij' });
    expect(res.status).toBe(400);
  });

  it('400s on a non-JSON body rather than 500', async () => {
    const res = await app.request('/retailers', {
      method: 'POST',
      headers: { ...ADMIN, ...JSON_HEADERS },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /retailers', () => {
  it('lists the applied review queue by default', async () => {
    await retailerOnboardingService.apply(testDb, applyBody);
    await retailersRepo.insert(testDb, { ...applyBody, onboardingStatus: 'approved' });
    const res = await app.request('/retailers', { headers: ADMIN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ onboardingStatus: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.onboardingStatus).toBe('applied');
  });

  it('filters by status', async () => {
    await retailersRepo.insert(testDb, { ...applyBody, onboardingStatus: 'suspended' });
    const res = await app.request('/retailers?status=suspended', { headers: ADMIN });
    expect((await res.json()) as unknown[]).toHaveLength(1);
  });

  it('400s on an unknown status', async () => {
    const res = await app.request('/retailers?status=bogus', { headers: ADMIN });
    expect(res.status).toBe(400);
  });
});

describe('GET /retailers/:id', () => {
  it('returns the retailer', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyBody);
    const res = await app.request(`/retailers/${r.id}`, { headers: ADMIN });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(r.id);
  });

  it('400s on a non-uuid id rather than 500', async () => {
    const res = await app.request('/retailers/not-a-uuid', { headers: ADMIN });
    expect(res.status).toBe(400);
  });

  it('404s on an unknown retailer', async () => {
    const res = await app.request(`/retailers/${factories.userId()}`, { headers: ADMIN });
    expect(res.status).toBe(404);
  });
});

describe('POST /retailers/:id/kyb', () => {
  it('submits KYB and moves the retailer to kyb_pending', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyBody);
    const spy = vi
      .spyOn(anchorAdapterSingleton, 'createBusinessCustomer')
      .mockResolvedValue({ id: 'biz-route-1', businessName: 'Ada Salon', kybStatus: 'PENDING' });

    const res = await post(`/retailers/${r.id}/kyb`, { bvn: '22222222222', rcNumber: 'RC12345' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { onboardingStatus: string }).onboardingStatus).toBe(
      'kyb_pending',
    );
    expect(spy).toHaveBeenCalledWith(
      { businessName: 'Ada Salon', bvn: '22222222222', rcNumber: 'RC12345' },
      `kyb:${r.id}`,
    );
  });

  it('400s on a malformed BVN without calling Anchor', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyBody);
    const spy = vi.spyOn(anchorAdapterSingleton, 'createBusinessCustomer');
    const res = await post(`/retailers/${r.id}/kyb`, { bvn: '123' });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('404s for an unknown retailer', async () => {
    const res = await post(`/retailers/${factories.userId()}/kyb`, { bvn: '22222222222' });
    expect(res.status).toBe(404);
  });

  it('409s when the retailer is already approved', async () => {
    const r = await retailersRepo.insert(testDb, { ...applyBody, onboardingStatus: 'approved' });
    const res = await post(`/retailers/${r.id}/kyb`, { bvn: '22222222222' });
    expect(res.status).toBe(409);
  });

  it('503s (not 500) when Anchor is unavailable, leaving the status untouched', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyBody);
    vi.spyOn(anchorAdapterSingleton, 'createBusinessCustomer').mockRejectedValue(
      new AnchorHttpError(503, 'upstream down', 'service unavailable'),
    );

    const res = await post(`/retailers/${r.id}/kyb`, { bvn: '22222222222' });

    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: 'anchor_unavailable' });
    expect((await retailersRepo.findById(testDb, r.id))?.onboardingStatus).toBe('applied');
  });
});

describe('POST /retailers/:id/approve and /suspend', () => {
  it('approve moves applied to approved', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyBody);
    const res = await post(`/retailers/${r.id}/approve`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { onboardingStatus: string }).onboardingStatus).toBe('approved');
  });

  it('approve 409s on a suspended retailer', async () => {
    const r = await retailersRepo.insert(testDb, { ...applyBody, onboardingStatus: 'suspended' });
    const res = await post(`/retailers/${r.id}/approve`);
    expect(res.status).toBe(409);
  });

  it('suspend moves approved to suspended', async () => {
    const r = await retailersRepo.insert(testDb, { ...applyBody, onboardingStatus: 'approved' });
    const res = await post(`/retailers/${r.id}/suspend`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { onboardingStatus: string }).onboardingStatus).toBe('suspended');
  });

  it('suspend 404s on an unknown retailer', async () => {
    const res = await post(`/retailers/${factories.userId()}/suspend`);
    expect(res.status).toBe(404);
  });

  it('400s on a non-uuid id for lifecycle routes', async () => {
    expect((await post('/retailers/nope/approve')).status).toBe(400);
    expect((await post('/retailers/nope/suspend')).status).toBe(400);
  });
});
