import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import * as codes from '../../src/modules/auth/codes';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { redemptionsRepo } from '../../src/modules/marketplace/redemptions.repo';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
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

/** A claimed, approved retailer and headers for its owner — the ordinary signed-in case. */
async function signedIn() {
  const phone = factories.phone();
  const retailer = await retailersRepo.insert(testDb, {
    businessName: 'Ada Salon',
    payoutBankCode: '000014',
    payoutAccountNumber: '0123456789',
    onboardingStatus: 'applied',
  });
  await retailersRepo.updateProfile(testDb, retailer.id, { contactPhone: phone });

  const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
  await app.request('/retailer/auth/otp/request', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone }),
  });
  spy.mockRestore();
  const res = await app.request('/retailer/auth/otp/verify', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone, code: '123456', nin: factories.nin() }),
  });
  expect(res.status).toBe(200);

  const owner = await usersRepo.findByPhone(testDb, phone);
  if (!owner) throw new Error('owner missing');
  await retailersRepo.transitionOnboardingStatus(testDb, retailer.id, ['applied'], 'approved', {
    approvedAt: new Date(),
    anchorBusinessCustomerId: `acct-${retailer.id.slice(0, 8)}`,
  });
  return { retailer, owner, headers: await bearerHeaders(owner) };
}

const post = (path: string, headers: HeadersInit, body: unknown) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });

async function makeItem(headers: HeadersInit, name = 'Wash and set', priceNaira = '4820.50') {
  const res = await post('/retailer/items', headers, { name, priceNaira, section: 'hair' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: { id: string } }).item;
}

describe('retailer portal: profile, payout and KYB', () => {
  it('updates the business profile', async () => {
    const { headers } = await signedIn();
    const res = await app.request('/retailer/me', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ businessName: 'Ada Salon & Spa', contactPhone: factories.phone() }),
    });
    expect(res.status).toBe(200);
    const me = await app.request('/retailer/me', { headers });
    expect((await me.json()) as { retailer: { businessName: string } }).toMatchObject({
      retailer: { businessName: 'Ada Salon & Spa' },
    });
  });

  it('updates the payout account, which a business changing bank must be able to do', async () => {
    const { retailer, headers } = await signedIn();
    const res = await app.request('/retailer/me/payout', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ payoutBankCode: '000015', payoutAccountNumber: '9876543210' }),
    });
    expect(res.status).toBe(200);
    const row = await retailersRepo.findById(testDb, retailer.id);
    expect(row?.payoutAccountNumber).toBe('9876543210');
  });

  it('rejects a payout account number that is not ten digits', async () => {
    const { headers } = await signedIn();
    const res = await app.request('/retailer/me/payout', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ payoutBankCode: '000015', payoutAccountNumber: '123' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a KYB submission without a valid BVN before it reaches Anchor', async () => {
    const { headers } = await signedIn();
    const res = await post('/retailer/me/kyb', headers, { bvn: '123' });
    expect(res.status).toBe(400);
  });
});

describe('retailer portal: storefront edits', () => {
  it('edits a price, in kobo, from a naira string', async () => {
    const { headers } = await signedIn();
    const item = await makeItem(headers);

    const res = await app.request(`/retailer/items/${item.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ priceNaira: '5000.00', name: 'Wash, set and trim' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { item: { priceKobo: string; name: string } }).toMatchObject({
      item: { priceKobo: '500000', name: 'Wash, set and trim' },
    });
  });

  it('lists only this retailer’s items', async () => {
    const a = await signedIn();
    await makeItem(a.headers, 'A one');
    const res = await app.request('/retailer/items', { headers: a.headers });
    const body = (await res.json()) as { items: Array<{ name: string }> };
    expect(body.items.map((i) => i.name)).toEqual(['A one']);
  });
});

describe('retailer portal: deals', () => {
  const window = () => ({
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });

  it('runs a percentage deal across every item, then pauses and ends it', async () => {
    const { headers } = await signedIn();
    const created = await post('/retailer/deals', headers, { discountBps: 1500, ...window() });
    expect(created.status).toBe(201);
    const { deal } = (await created.json()) as { deal: { id: string; status: string } };
    expect(deal.status).toBe('active');

    const paused = await app.request(`/retailer/deals/${deal.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(paused.status).toBe(200);

    const ended = await app.request(`/retailer/deals/${deal.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'ended' }),
    });
    expect(ended.status).toBe(200);

    // `ended` is terminal: a deal's window is part of what buyers were shown.
    const revived = await app.request(`/retailer/deals/${deal.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'active' }),
    });
    expect(revived.status).toBe(403);
  });

  it('runs a fixed-amount deal on one item and lists it', async () => {
    const { headers } = await signedIn();
    const item = await makeItem(headers);
    const created = await post('/retailer/deals', headers, {
      catalogItemId: item.id,
      discountNaira: '500.00',
      ...window(),
    });
    expect(created.status).toBe(201);

    const listed = await app.request('/retailer/deals', { headers });
    const body = (await listed.json()) as {
      deals: Array<{ discountKobo: string | null; catalogItemId: string | null }>;
    };
    expect(body.deals).toHaveLength(1);
    expect(body.deals[0]?.discountKobo).toBe('50000');
    expect(body.deals[0]?.catalogItemId).toBe(item.id);
  });
});

describe('retailer portal: orders and earnings with real redemptions', () => {
  /** A redeemed voucher against this retailer, with its payout already settled. */
  async function seedRedemption(
    retailerId: string,
    catalogItemId: string,
    opts: { paid: boolean; gross: bigint; discounted: bigint; commission: bigint },
  ) {
    const buyer = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      bvn: factories.bvn(),
      kycTier: '1',
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: buyer.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '0123456789',
      anchorBankCode: '058',
      anchorAccountId: `mw-${Math.random().toString(36).slice(2, 10)}`,
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'marketplace_purchase',
      amountKobo: kobo(opts.discounted),
      idempotencyKey: factories.idempotencyKey(),
    });
    const r = await redemptionsRepo.insert(testDb, {
      transactionId: txn.id,
      buyerUserId: buyer.id,
      masterWalletId: mw.master.id,
      retailerId,
      catalogItemId,
      grossKobo: kobo(opts.gross),
      discountedKobo: kobo(opts.discounted),
      commissionKobo: kobo(opts.commission),
      code: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      qrToken: `q-${Math.random().toString(36).slice(2, 12)}`,
      // Vouchers refund their buyer automatically once past TTL, so every row carries an expiry.
      expiresAt: new Date(Date.now() + 168 * 3600_000),
    });
    await redemptionsRepo.markRedeemed(testDb, r.id, new Date());
    await redemptionsRepo.setPayout(testDb, r.id, {
      payoutStatus: opts.paid ? 'paid' : 'pending',
    });
    return r;
  }

  it('sums earnings as discounted less commission, split by what has actually been paid', async () => {
    const { retailer, headers } = await signedIn();
    const item = await makeItem(headers);
    await seedRedemption(retailer.id, item.id, {
      paid: true,
      gross: 500_000n,
      discounted: 450_000n,
      commission: 50_000n,
    });
    await seedRedemption(retailer.id, item.id, {
      paid: false,
      gross: 200_000n,
      discounted: 200_000n,
      commission: 20_000n,
    });

    const res = await app.request('/retailer/earnings', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: Record<string, string | number>;
      history: Array<{ netKobo: string }>;
    };
    expect(body.summary).toMatchObject({
      redeemedCount: 2,
      grossKobo: '700000',
      commissionKobo: '70000',
      // (450000-50000) + (200000-20000)
      netKobo: '580000',
      paidKobo: '400000',
      pendingKobo: '180000',
    });
    expect(body.history).toHaveLength(2);
  });

  // Anything that is not the terminal `paid` — including a null — is money the retailer has not
  // received, and must not be reported as paid.
  it('counts a redemption with no payout row at all as pending', async () => {
    const { retailer, headers } = await signedIn();
    const item = await makeItem(headers);
    const r = await seedRedemption(retailer.id, item.id, {
      paid: false,
      gross: 100_000n,
      discounted: 100_000n,
      commission: 10_000n,
    });
    await redemptionsRepo.setPayout(testDb, r.id, { payoutStatus: null });

    const res = await app.request('/retailer/earnings', { headers });
    const body = (await res.json()) as { summary: { paidKobo: string; pendingKobo: string } };
    expect(body.summary.paidKobo).toBe('0');
    expect(body.summary.pendingKobo).toBe('90000');
  });

  it('lists orders newest first and never another retailer’s', async () => {
    const a = await signedIn();
    const b = await signedIn();
    const itemA = await makeItem(a.headers);
    const itemB = await makeItem(b.headers);
    await seedRedemption(a.retailer.id, itemA.id, {
      paid: true,
      gross: 100_000n,
      discounted: 100_000n,
      commission: 0n,
    });
    await seedRedemption(b.retailer.id, itemB.id, {
      paid: true,
      gross: 999_000n,
      discounted: 999_000n,
      commission: 0n,
    });

    const res = await app.request('/retailer/redemptions', { headers: a.headers });
    const body = (await res.json()) as { redemptions: Array<{ discountedKobo: string }> };
    expect(body.redemptions).toHaveLength(1);
    expect(body.redemptions[0]?.discountedKobo).toBe('100000');
  });

  it('pages the orders log', async () => {
    const { retailer, headers } = await signedIn();
    const item = await makeItem(headers);
    for (let i = 0; i < 3; i++) {
      await seedRedemption(retailer.id, item.id, {
        paid: true,
        gross: 1000n,
        discounted: 1000n,
        commission: 0n,
      });
    }
    const first = await app.request('/retailer/redemptions?limit=2&offset=0', { headers });
    expect(((await first.json()) as { redemptions: unknown[] }).redemptions).toHaveLength(2);
    const second = await app.request('/retailer/redemptions?limit=2&offset=2', { headers });
    expect(((await second.json()) as { redemptions: unknown[] }).redemptions).toHaveLength(1);
  });
});
