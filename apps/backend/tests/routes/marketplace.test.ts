import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const RETAILER_ID = 'retailer-1';
const RETAILER_BANK = '058';
const RETAILER_ACCT = '0123456789';

/** Seed a household + master wallet + agent sub-wallet; return the actors + ids for the route tests. */
async function seedHouseholdWithAgent() {
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
  return { principal, agent, hh, mw, sw };
}

function purchaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subWalletId: null,
    retailerId: RETAILER_ID,
    catalogItemId: 'item-1',
    retailerBankCode: RETAILER_BANK,
    retailerAccount: RETAILER_ACCT,
    grossKobo: '20000',
    discountedKobo: '12345',
    idempotencyKey: factories.idempotencyKey(),
    ...overrides,
  };
}

describe('POST /marketplace/purchase', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('201 — agent reserves a voucher against their sub-wallet, returns a code', async () => {
    const { agent, sw } = await seedHouseholdWithAgent();
    const app = createServer();
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify(purchaseBody({ subWalletId: sw.sub.id })),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      voucher: {
        id: string;
        code: string;
        qrToken: string;
        expiresAt: string;
        discountedKobo: string;
        status: string;
      };
    };
    expect(body.voucher.code).toMatch(/^AMN-/);
    expect(body.voucher.qrToken).toBeTruthy();
    expect(body.voucher.status).toBe('reserved');
    expect(body.voucher.discountedKobo).toBe('12345');
    expect(body.voucher.expiresAt).toBeTruthy();
  });

  it('201 — principal reserves a direct voucher (subWalletId omitted → household master)', async () => {
    const { principal } = await seedHouseholdWithAgent();
    const app = createServer();
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: await bearerHeaders(principal),
      body: JSON.stringify(purchaseBody()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { voucher: { code: string; status: string } };
    expect(body.voucher.code).toMatch(/^AMN-/);
    expect(body.voucher.status).toBe('reserved');
  });

  it('400 — malformed body (missing required fields) rejected by parseBody', async () => {
    const { agent } = await seedHouseholdWithAgent();
    const app = createServer();
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ retailerId: RETAILER_ID }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('validation_error');
  });

  it('400 — non-JSON body returns 400, not 500', async () => {
    const { agent } = await seedHouseholdWithAgent();
    const app = createServer();
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: 'not-json-at-all',
    });
    expect(res.status).toBe(400);
  });

  it('403 — purchasing against a sub-wallet the actor does not own', async () => {
    // Household #2 owns the sub-wallet; agent #1 (a different household) tries to spend it.
    const { sw: otherSub } = await seedHouseholdWithAgent();
    const { agent: outsider } = await seedHouseholdWithAgent();
    const app = createServer();
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: await bearerHeaders(outsider),
      body: JSON.stringify(purchaseBody({ subWalletId: otherSub.sub.id })),
    });
    expect(res.status).toBe(403);
  });

  it('401 — no bearer', async () => {
    const app = createServer();
    const res = await app.request('/marketplace/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(purchaseBody()),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /marketplace/vouchers', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 — returns the buyer’s own vouchers', async () => {
    const { agent, sw } = await seedHouseholdWithAgent();
    const app = createServer();
    const headers = await bearerHeaders(agent);

    await app.request('/marketplace/purchase', {
      method: 'POST',
      headers,
      body: JSON.stringify(purchaseBody({ subWalletId: sw.sub.id })),
    });

    const res = await app.request('/marketplace/vouchers', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vouchers: Array<{ code: string; status: string; buyerUserId: string }>;
    };
    expect(body.vouchers.length).toBe(1);
    expect(body.vouchers[0]?.buyerUserId).toBe(agent.id);
    expect(body.vouchers[0]?.code).toMatch(/^AMN-/);
  });

  it('200 — a buyer with no vouchers gets an empty list', async () => {
    const { principal } = await seedHouseholdWithAgent();
    const app = createServer();
    const res = await app.request('/marketplace/vouchers', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { vouchers: unknown[] }).vouchers).toEqual([]);
  });
});
