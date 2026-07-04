import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { catalogItemsRepo } from '../../src/modules/marketplace/catalog-items.repo';
import { dealsService } from '../../src/modules/marketplace/deals.service';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer();
const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;

async function seedHousehold() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '0123456789',
    anchorBankCode: '058',
    anchorAccountId: 'a-1',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principal, hh, mw, agent, sw };
}

async function seedRetailerItem(priceKobo: bigint, opts: { deal?: number } = {}) {
  const retailer = await retailersRepo.insert(testDb, {
    businessName: 'Mama Put',
    payoutBankCode: '011',
    payoutAccountNumber: '9988776655',
    onboardingStatus: 'approved',
  });
  const item = await catalogItemsRepo.insert(testDb, {
    retailerId: retailer.id,
    name: 'Jollof',
    priceKobo: kobo(priceKobo),
    section: 'Food',
  });
  if (opts.deal) {
    await dealsService.createDeal(testDb, {
      retailerId: retailer.id,
      catalogItemId: item.id,
      discountBps: opts.deal,
      startsAt: new Date(NOW.getTime() - DAY),
      endsAt: new Date(NOW.getTime() + DAY),
    });
  }
  return { retailer, item };
}

describe('POST /marketplace/purchase', () => {
  beforeEach(truncateAll);

  it('agent purchase of an item with an active deal → 201, voucher priced at the discount', async () => {
    const { agent, mw, sw } = await seedHousehold();
    const { item } = await seedRetailerItem(20_000n, { deal: 2500 }); // 25% off → 15_000
    const headers = await bearerHeaders(agent);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        catalogItemId: item.id,
        idempotencyKey: factories.idempotencyKey(),
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { voucher: Record<string, unknown> };
    expect(json.voucher.grossKobo).toBe('20000');
    expect(json.voucher.discountedKobo).toBe('15000');
    expect(json.voucher.status).toBe('reserved');
    expect(json.voucher.code).toMatch(/^AMN-/);
    expect(json.voucher.qrToken).toBeTruthy();
    expect(typeof json.voucher.expiresAt).toBe('string');
    // masterWalletId resolved from the sub-wallet.
    void mw;
  });

  it('principal-direct purchase (subWalletId omitted) → 201, resolves the household master wallet', async () => {
    const { principal } = await seedHousehold();
    const { item } = await seedRetailerItem(20_000n);
    const headers = await bearerHeaders(principal);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        catalogItemId: item.id,
        idempotencyKey: factories.idempotencyKey(),
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { voucher: Record<string, unknown> };
    expect(json.voucher.discountedKobo).toBe('20000');
    expect(json.voucher.status).toBe('reserved');
  });

  it('agent purchase over the daily limit → 409', async () => {
    const { principal, agent, mw, sw } = await seedHousehold();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 10_000n } }],
    });
    const { item } = await seedRetailerItem(20_000n); // no deal → 20_000 > 10_000
    const headers = await bearerHeaders(agent);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        catalogItemId: item.id,
        idempotencyKey: factories.idempotencyKey(),
      }),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('limit_exceeded');
    void mw;
  });

  it('a stranger agent buying against a sub-wallet they do not own → 403', async () => {
    const { sw } = await seedHousehold();
    const { item } = await seedRetailerItem(20_000n);
    const stranger = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const headers = await bearerHeaders(stranger);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        catalogItemId: item.id,
        idempotencyKey: factories.idempotencyKey(),
      }),
    });

    expect(res.status).toBe(403);
  });

  it('unknown catalog item → 404', async () => {
    const { agent, sw } = await seedHousehold();
    const headers = await bearerHeaders(agent);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        catalogItemId: '00000000-0000-0000-0000-000000000000',
        idempotencyKey: factories.idempotencyKey(),
      }),
    });

    expect(res.status).toBe(404);
  });

  it('malformed body (missing catalogItemId) → 400', async () => {
    const { agent, sw } = await seedHousehold();
    const headers = await bearerHeaders(agent);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({ subWalletId: sw.sub.id, idempotencyKey: 'k' }),
    });

    expect(res.status).toBe(400);
  });

  it('non-JSON body → 400', async () => {
    const { agent } = await seedHousehold();
    const headers = await bearerHeaders(agent);

    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  it('no bearer → 401', async () => {
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        catalogItemId: '00000000-0000-0000-0000-000000000000',
        idempotencyKey: 'k',
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /marketplace/vouchers', () => {
  beforeEach(truncateAll);

  it("lists the buyer's vouchers", async () => {
    const { agent, sw } = await seedHousehold();
    const { item } = await seedRetailerItem(20_000n, { deal: 2500 });
    const headers = await bearerHeaders(agent);

    await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        catalogItemId: item.id,
        idempotencyKey: factories.idempotencyKey(),
      }),
    });

    const res = await app.request('/marketplace/vouchers', { method: 'GET', headers });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { vouchers: Array<Record<string, unknown>> };
    expect(json.vouchers.length).toBe(1);
    expect(json.vouchers[0]?.discountedKobo).toBe('15000');
    expect(json.vouchers[0]?.status).toBe('reserved');
  });

  it('no bearer → 401', async () => {
    const res = await app.request('/marketplace/vouchers', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
