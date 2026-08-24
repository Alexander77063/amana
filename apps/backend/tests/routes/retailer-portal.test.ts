import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as codes from '../../src/modules/auth/codes';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const JSON_HEADERS = { 'content-type': 'application/json' };
const app = createServer();

beforeEach(async () => {
  await truncateAll();
  // biome-ignore lint/performance/noDelete: unset so the OTP service takes its no-SMS skip path
  delete process.env.TERMII_API_KEY;
  vi.restoreAllMocks();
});

/** A retailer ops has created and recorded a contact number for, but nobody has claimed. */
async function unclaimedRetailer(contactPhone: string) {
  const r = await retailersRepo.insert(testDb, {
    businessName: 'Ada Salon',
    payoutBankCode: '000014',
    payoutAccountNumber: '0123456789',
    onboardingStatus: 'applied',
  });
  await retailersRepo.updateProfile(testDb, r.id, { contactPhone });
  return r;
}

/** Sign in through the real OTP flow, as the portal does. */
async function signIn(phone: string, nin?: string) {
  const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
  await app.request('/retailer/auth/otp/request', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone }),
  });
  spy.mockRestore();
  return app.request('/retailer/auth/otp/verify', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone, code: '123456', ...(nin ? { nin } : {}) }),
  });
}

/** A claimed, approved retailer plus headers for its owner. */
async function approvedRetailerWithOwner() {
  const phone = factories.phone();
  const retailer = await unclaimedRetailer(phone);
  const res = await signIn(phone, factories.nin());
  expect(res.status).toBe(200);
  const owner = await usersRepo.findByPhone(testDb, phone);
  if (!owner) throw new Error('owner not created');
  await retailersRepo.transitionOnboardingStatus(testDb, retailer.id, ['applied'], 'approved', {
    approvedAt: new Date(),
    anchorBusinessCustomerId: `acct-${retailer.id.slice(0, 8)}`,
  });
  return { retailer, owner, headers: await bearerHeaders(owner) };
}

describe('retailer portal auth', () => {
  it('claims an unclaimed retailer on first sign-in and issues a retailer session', async () => {
    const phone = factories.phone();
    const retailer = await unclaimedRetailer(phone);

    const res = await signIn(phone, factories.nin());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; retailer: { id: string } };
    expect(body.retailer.id).toBe(retailer.id);

    const claimed = await retailersRepo.findById(testDb, retailer.id);
    const owner = await usersRepo.findByPhone(testDb, phone);
    expect(claimed?.ownerUserId).toBe(owner?.id);
    expect(owner?.role).toBe('retailer');
  });

  it('needs a NIN only on the first sign-in, not on later ones', async () => {
    const phone = factories.phone();
    await unclaimedRetailer(phone);

    const first = await signIn(phone);
    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({ error: 'nin_required' });

    expect((await signIn(phone, factories.nin())).status).toBe(200);
    expect((await signIn(phone)).status).toBe(200);
  });

  // Onboarding is curated: a business nobody vetted must not be able to appear by signing up.
  it('refuses a phone with no retailer against it, and does not create a user', async () => {
    const phone = factories.phone();
    const res = await signIn(phone, factories.nin());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'no_retailer_for_phone' });
    expect(await usersRepo.findByPhone(testDb, phone)).toBeUndefined();
  });

  // Once claimed, the door is closed: re-registering the contact number must not take the
  // business over.
  it('does not let a second person claim an already-claimed retailer', async () => {
    const phone = factories.phone();
    const retailer = await unclaimedRetailer(phone);
    await signIn(phone, factories.nin());
    const firstOwner = await usersRepo.findByPhone(testDb, phone);

    // Ops records the same contact number against a second business; the original stays put.
    const second = await unclaimedRetailer(phone);
    expect(second.id).not.toBe(retailer.id);
    const res = await signIn(phone);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retailer: { id: string } };
    expect(body.retailer.id).toBe(retailer.id);
    expect((await retailersRepo.findById(testDb, retailer.id))?.ownerUserId).toBe(firstOwner?.id);
    expect((await retailersRepo.findById(testDb, second.id))?.ownerUserId).toBeNull();
  });

  it('refuses a household phone — one user row must not be both', async () => {
    const phone = factories.phone();
    await usersRepo.insert(testDb, {
      role: 'principal',
      phone,
      nin: factories.nin(),
      bvn: factories.bvn(),
      kycTier: '1',
    });
    // A principal's wallet and a retailer's payouts must not sit behind one OTP.
    const res = await signIn(phone);
    expect(res.status).toBe(403);
  });

  it('sends a retailer to the portal rather than the household login', async () => {
    const phone = factories.phone();
    await unclaimedRetailer(phone);
    await signIn(phone, factories.nin());

    const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    await app.request('/auth/otp/request', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phone, purpose: 'login' }),
    });
    spy.mockRestore();
    const res = await app.request('/auth/otp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phone, code: '123456' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'use_retailer_portal' });
  });

  it('401s the portal without a token', async () => {
    expect((await app.request('/retailer/me')).status).toBe(401);
  });

  // Authentication is not authorisation: a real principal session must reach nothing here.
  it('refuses a household session even though its token is valid', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      bvn: factories.bvn(),
      kycTier: '1',
    });
    const res = await app.request('/retailer/me', { headers: await bearerHeaders(user) });
    expect(res.status).toBe(403);
  });
});

describe('retailer portal: profile and storefront', () => {
  it('returns the signed-in retailer, and never one named in the request', async () => {
    const { retailer, headers } = await approvedRetailerWithOwner();
    const res = await app.request('/retailer/me', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retailer: { id: string; onboardingStatus: string } };
    expect(body.retailer.id).toBe(retailer.id);
    expect(body.retailer.onboardingStatus).toBe('approved');
  });

  it('creates an item in kobo from a naira string', async () => {
    const { headers } = await approvedRetailerWithOwner();
    const res = await app.request('/retailer/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Wash and set', priceNaira: '4820.50', section: 'hair' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { priceKobo: string } };
    expect(body.item.priceKobo).toBe('482050');
  });

  it('rejects a price that is not a plain naira amount', async () => {
    const { headers } = await approvedRetailerWithOwner();
    for (const priceNaira of ['-5', '1.234', 'abc', '']) {
      const res = await app.request('/retailer/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'x', priceNaira, section: 'hair' }),
      });
      expect(res.status).toBe(400);
    }
  });

  // The whole point of scoping by session: retailer A must not see or touch retailer B.
  it('does not leak or mutate another retailer’s item', async () => {
    const a = await approvedRetailerWithOwner();
    const b = await approvedRetailerWithOwner();

    const created = await app.request('/retailer/items', {
      method: 'POST',
      headers: a.headers,
      body: JSON.stringify({ name: 'A only', priceNaira: '100', section: 'hair' }),
    });
    const { item } = (await created.json()) as { item: { id: string } };

    const listed = await app.request('/retailer/items', { headers: b.headers });
    expect((await listed.json()) as { items: unknown[] }).toEqual({ items: [] });

    const patched = await app.request(`/retailer/items/${item.id}`, {
      method: 'PATCH',
      headers: b.headers,
      body: JSON.stringify({ name: 'stolen' }),
    });
    expect(patched.status).toBe(403);
  });

  it('reports a missing item the same way as someone else’s, so ids cannot be probed', async () => {
    const { headers } = await approvedRetailerWithOwner();
    const res = await app.request(`/retailer/items/${factories.userId()}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('400s a malformed id rather than 500ing on it', async () => {
    const { headers } = await approvedRetailerWithOwner();
    const res = await app.request('/retailer/items/not-a-uuid', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('retailer portal: suspension is asymmetric', () => {
  async function suspended() {
    const ctx = await approvedRetailerWithOwner();
    await retailersRepo.updateOnboardingStatus(testDb, ctx.retailer.id, 'suspended');
    return ctx;
  }

  it('stops a suspended retailer publishing new supply', async () => {
    const { headers } = await suspended();
    const res = await app.request('/retailer/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'new', priceNaira: '100', section: 'hair' }),
    });
    expect(res.status).toBe(403);
  });

  // Withdrawing supply is never what suspension needs to prevent.
  it('still lets a suspended retailer take an item off sale', async () => {
    const ctx = await approvedRetailerWithOwner();
    const created = await app.request('/retailer/items', {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ name: 'x', priceNaira: '100', section: 'hair' }),
    });
    const { item } = (await created.json()) as { item: { id: string } };
    await retailersRepo.updateOnboardingStatus(testDb, ctx.retailer.id, 'suspended');

    const res = await app.request(`/retailer/items/${item.id}`, {
      method: 'PATCH',
      headers: ctx.headers,
      body: JSON.stringify({ status: 'inactive' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { item: { status: string } }).toMatchObject({
      item: { status: 'inactive' },
    });
  });

  it('refuses redemption for a retailer that never passed KYB', async () => {
    const phone = factories.phone();
    const retailer = await unclaimedRetailer(phone);
    await signIn(phone, factories.nin());
    const owner = await usersRepo.findByPhone(testDb, phone);
    if (!owner) throw new Error('no owner');
    // Suspended with no approvedAt — the shape a kyb.rejected webhook leaves behind.
    await retailersRepo.updateOnboardingStatus(testDb, retailer.id, 'suspended');

    const res = await app.request('/retailer/redeem', {
      method: 'POST',
      headers: await bearerHeaders(owner),
      body: JSON.stringify({ code: 'ABC123' }),
    });
    // The error handler deliberately collapses every ForbiddenError to a generic body, so the
    // reason is not readable from outside — the status is the contract.
    expect(res.status).toBe(403);
  });

  // The decision this whole asymmetry exists for: the buyer already paid.
  it('lets a retailer suspended AFTER approval still attempt a redemption', async () => {
    const ctx = await approvedRetailerWithOwner();
    await retailersRepo.updateOnboardingStatus(testDb, ctx.retailer.id, 'suspended');
    const res = await app.request('/retailer/redeem', {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ code: 'NOSUCHCODE' }),
    });
    // Past the suspension gate: it fails on the voucher not existing, not on being suspended.
    expect(res.status).not.toBe(403);
  });
});

describe('retailer portal: deals', () => {
  it('requires exactly one of a percentage or a fixed discount', async () => {
    const { headers } = await approvedRetailerWithOwner();
    const window = {
      startsAt: new Date(Date.now() + 1000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const neither = await app.request('/retailer/deals', {
      method: 'POST',
      headers,
      body: JSON.stringify(window),
    });
    expect(neither.status).toBe(400);

    const both = await app.request('/retailer/deals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...window, discountBps: 1000, discountNaira: '100' }),
    });
    expect(both.status).toBe(400);
  });

  it('refuses a deal pointed at another retailer’s item', async () => {
    const a = await approvedRetailerWithOwner();
    const b = await approvedRetailerWithOwner();
    const created = await app.request('/retailer/items', {
      method: 'POST',
      headers: a.headers,
      body: JSON.stringify({ name: 'A only', priceNaira: '100', section: 'hair' }),
    });
    const { item } = (await created.json()) as { item: { id: string } };

    const res = await app.request('/retailer/deals', {
      method: 'POST',
      headers: b.headers,
      body: JSON.stringify({
        catalogItemId: item.id,
        discountBps: 1000,
        startsAt: new Date(Date.now() + 1000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe('retailer portal: earnings', () => {
  it('reports zeroes for a retailer that has redeemed nothing', async () => {
    const { headers } = await approvedRetailerWithOwner();
    const res = await app.request('/retailer/earnings', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { redeemedCount: number; netKobo: string; paidKobo: string };
      history: unknown[];
    };
    // Strings, not numbers: kobo totals can exceed Number.MAX_SAFE_INTEGER and this is money.
    expect(body.summary).toMatchObject({ redeemedCount: 0, netKobo: '0', paidKobo: '0' });
    expect(body.history).toEqual([]);
  });

  it('bounds the page size rather than trusting the caller', async () => {
    const { headers } = await approvedRetailerWithOwner();
    expect((await app.request('/retailer/earnings?limit=1000', { headers })).status).toBe(400);
    expect((await app.request('/retailer/redemptions?offset=-1', { headers })).status).toBe(400);
  });
});
