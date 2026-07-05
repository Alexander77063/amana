import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../src/integrations/anchor/adapter';
import type { AnchorBillResponse } from '../../src/integrations/anchor/types';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { vasPurchaseService } from '../../src/modules/vas/purchase.service';
import { vasPurchasesRepo } from '../../src/modules/vas/vas-purchases.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const SECRET = 'whsec_test';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

async function seedWithLimit(maxKobo: bigint) {
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
  await ruleSetService.publishNewVersion(testDb, {
    subWalletId: sw.sub.id,
    createdByUserId: principal.id,
    rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo } }],
  });
  return { principal, agent, mw, sw };
}

type Seeded = Awaited<ReturnType<typeof seedWithLimit>>;

/** Fake adapter whose payBill returns PENDING, leaving the reserve in_flight for the webhook. */
function pendingAdapter(): AnchorAdapter {
  return {
    payBill: vi.fn(
      async (): Promise<AnchorBillResponse> => ({
        id: 'bill_pending',
        status: 'PENDING',
        commissionKobo: 0n,
        token: null,
      }),
    ),
    validateCustomer: vi.fn(async (_p: string, account: string) => ({
      customerNumber: account,
      customerName: 'Test Customer',
    })),
  } as unknown as AnchorAdapter;
}

/** Reserve an in_flight vas_purchase (airtime to the agent's own phone) and return its idempotency key. */
async function reserveInFlight(s: Seeded, idempotencyKey: string) {
  const out = await vasPurchaseService.create(testDb, pendingAdapter(), {
    actorUserId: s.agent.id,
    masterWalletId: s.mw.master.id,
    subWalletId: s.sw.sub.id,
    category: 'airtime',
    provider: 'mtn',
    recipient: s.agent.phone,
    amountKobo: 5_000n,
    idempotencyKey,
    now: new Date('2026-07-04T00:00:00Z'),
  });
  expect(out.status).toBe('in_flight');
  return out;
}

describe('POST /webhooks/anchor — bills.*', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('bills.successful settles the vas txn and credits commission; replay is a no-op', async () => {
    const s = await seedWithLimit(100_000n);
    const key = factories.idempotencyKey();
    const out = await reserveInFlight(s, key);
    const app = createServer();

    const body = JSON.stringify({
      id: 'evt-bill-ok',
      type: 'bills.successful',
      createdAt: '2026-07-04T12:00:30Z',
      data: { billId: 'bill_pending', reference: key, commissionKobo: '100', token: 'TKN-1' },
    });
    const headers = { 'content-type': 'application/json', 'x-anchor-signature': sign(body) };

    const res = await app.request('/webhooks/anchor', { method: 'POST', body, headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', deduped: false });

    const settled = await transactionsRepo.findById(testDb, out.transactionId);
    expect(settled?.status).toBe('settled');
    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas?.status).toBe('successful');
    expect(vas?.token).toBe('TKN-1');
    // reserve (2 legs) + settle (3 legs) = 5; commission LA credited (credit-normal → negative).
    expect((await postingsRepo.listByTransaction(testDb, out.transactionId)).length).toBe(5);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(-100n);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);

    // Replay the SAME event → deduped, no double-settle.
    const res2 = await app.request('/webhooks/anchor', { method: 'POST', body, headers });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ status: 'ok', deduped: true });
    expect((await postingsRepo.listByTransaction(testDb, out.transactionId)).length).toBe(5);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(-100n);
  });

  it('bills.failed reverses the vas txn (refunds source) and marks the vas row failed', async () => {
    const s = await seedWithLimit(100_000n);
    const beforeSource = await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId);
    const key = factories.idempotencyKey();
    const out = await reserveInFlight(s, key);
    const app = createServer();

    const body = JSON.stringify({
      id: 'evt-bill-fail',
      type: 'bills.failed',
      createdAt: '2026-07-04T12:00:30Z',
      data: { billId: 'bill_pending', reference: key, failureReason: 'biller down' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);

    const failed = await transactionsRepo.findById(testDb, out.transactionId);
    expect(failed?.status).toBe('failed');
    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas?.status).toBe('failed');
    // Source refunded, suspense drained back to 0.
    expect(await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId)).toBe(beforeSource);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
  });

  it('bills.initiated is acknowledged with no ledger action', async () => {
    const s = await seedWithLimit(100_000n);
    const key = factories.idempotencyKey();
    const out = await reserveInFlight(s, key);
    const app = createServer();

    const body = JSON.stringify({
      id: 'evt-bill-init',
      type: 'bills.initiated',
      createdAt: '2026-07-04T12:00:30Z',
      data: { billId: 'bill_pending', reference: key },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);
    // No ledger action: still in_flight, still just the 2 reserve legs.
    const txn = await transactionsRepo.findById(testDb, out.transactionId);
    expect(txn?.status).toBe('in_flight');
    expect((await postingsRepo.listByTransaction(testDb, out.transactionId)).length).toBe(2);
  });
});
