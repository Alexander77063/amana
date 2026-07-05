import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnchorBillResponse,
  AnchorCustomerValidation,
} from '../../src/integrations/anchor/types';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

// The route pulls the Anchor adapter from the module singleton, so we override it at the barrel
// (the e2e-spend pattern). `...actual` preserves the other exports the mounted webhooks route needs.
const { payBillSpy, validateCustomerSpy, listBillersSpy, listProductsSpy } = vi.hoisted(() => ({
  payBillSpy: vi.fn(),
  validateCustomerSpy: vi.fn(),
  listBillersSpy: vi.fn(),
  listProductsSpy: vi.fn(),
}));

vi.mock('../../src/integrations/anchor', async () => {
  const actual = await vi.importActual<typeof import('../../src/integrations/anchor')>(
    '../../src/integrations/anchor',
  );
  return {
    ...actual,
    anchorAdapterSingleton: {
      payBill: payBillSpy,
      validateCustomer: validateCustomerSpy,
      listBillers: listBillersSpy,
      listProducts: listProductsSpy,
    },
  };
});

async function seed(opts: { maxKobo?: bigint } = {}) {
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
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
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
  if (opts.maxKobo !== undefined) {
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [
        { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: opts.maxKobo } },
      ],
    });
  }
  return { principal, agent, mw, sw };
}

describe('VAS routes', () => {
  beforeEach(async () => {
    await truncateAll();
    payBillSpy.mockReset();
    validateCustomerSpy.mockReset();
    listBillersSpy.mockReset();
    listProductsSpy.mockReset();
    payBillSpy.mockResolvedValue({
      id: 'bill_pending',
      status: 'PENDING',
      commissionKobo: 0n,
      token: null,
    } satisfies AnchorBillResponse);
    validateCustomerSpy.mockResolvedValue({
      customerNumber: 'x',
      customerName: 'Test Customer',
    } satisfies AnchorCustomerValidation);
    listBillersSpy.mockResolvedValue([{ id: 'b1', name: 'MTN', slug: 'mtn' }]);
    listProductsSpy.mockResolvedValue([]);
  });

  it('POST /vas/purchase — under limit, own phone, Anchor PENDING → 201 { purchase.status: pending }', async () => {
    const { agent, sw } = await seed();
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        category: 'airtime',
        provider: 'mtn',
        recipient: agent.phone,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { purchase: Record<string, unknown> };
    expect(json.purchase.status).toBe('pending');
    expect(json.purchase.category).toBe('airtime');
    expect(json.purchase.amountKobo).toBe('5000');
    expect(payBillSpy).toHaveBeenCalledOnce();
  });

  it('POST /vas/purchase — over the daily limit → 409 limit_exceeded', async () => {
    const { agent, sw } = await seed({ maxKobo: 10_000n });
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        category: 'airtime',
        provider: 'mtn',
        recipient: agent.phone,
        amountKobo: '20000',
        idempotencyKey: factories.idempotencyKey(),
      }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('limit_exceeded');
    expect(payBillSpy).not.toHaveBeenCalled();
  });

  it('POST /vas/purchase — un-approved recipient → 403 forbidden', async () => {
    const { agent, sw } = await seed();
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        category: 'airtime',
        provider: 'mtn',
        recipient: '+2348099999999', // not own, not a beneficiary
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
      }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');
    expect(payBillSpy).not.toHaveBeenCalled();
  });

  it('POST /vas/purchase — stranger agent against a sub-wallet they do not own → 403', async () => {
    const { sw } = await seed();
    const stranger = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(stranger),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        category: 'airtime',
        provider: 'mtn',
        recipient: stranger.phone,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /vas/purchase — malformed body (missing category) → 400', async () => {
    const { agent, sw } = await seed();
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        provider: 'mtn',
        recipient: agent.phone,
        amountKobo: '5000',
        idempotencyKey: 'k',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /vas/purchase — bad uuid subWalletId → 400', async () => {
    const { agent } = await seed();
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: 'not-a-uuid',
        category: 'airtime',
        provider: 'mtn',
        recipient: agent.phone,
        amountKobo: '5000',
        idempotencyKey: 'k',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /vas/purchase — zero amount → 400 (never reaches a 0/0 posting)', async () => {
    const { agent, sw } = await seed();
    const app = createServer();
    const res = await app.request('/vas/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        category: 'airtime',
        provider: 'mtn',
        recipient: agent.phone,
        amountKobo: '0',
        idempotencyKey: 'k',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /vas/billers?category=airtime → 200 list', async () => {
    const { agent } = await seed();
    const app = createServer();
    const res = await app.request('/vas/billers?category=airtime', {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { billers: Array<{ slug: string }> };
    expect(json.billers[0]?.slug).toBe('mtn');
    expect(listBillersSpy).toHaveBeenCalledWith('airtime');
  });

  it('GET /vas/billers — invalid category → 400', async () => {
    const { agent } = await seed();
    const app = createServer();
    const res = await app.request('/vas/billers?category=bogus', {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(400);
  });

  it('GET /vas/purchases → the buyer’s list', async () => {
    const { agent, sw } = await seed();
    const app = createServer();
    const headers = await bearerHeaders(agent);
    await app.request('/vas/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subWalletId: sw.sub.id,
        category: 'airtime',
        provider: 'mtn',
        recipient: agent.phone,
        amountKobo: '5000',
        idempotencyKey: factories.idempotencyKey(),
      }),
    });
    const res = await app.request('/vas/purchases', { headers });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { purchases: Array<Record<string, unknown>> };
    expect(json.purchases.length).toBe(1);
    expect(json.purchases[0]?.status).toBe('pending');
    expect(json.purchases[0]?.amountKobo).toBe('5000');
  });

  it('POST /vas/purchase — no bearer → 401', async () => {
    const res = await createServer().request('/vas/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'airtime',
        provider: 'mtn',
        recipient: 'x',
        amountKobo: '1',
      }),
    });
    expect(res.status).toBe(401);
  });
});
