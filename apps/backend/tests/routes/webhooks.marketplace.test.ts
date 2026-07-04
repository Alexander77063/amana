import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../src/integrations/anchor/client';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { purchaseService } from '../../src/modules/marketplace/purchase.service';
import { redeemService } from '../../src/modules/marketplace/redeem.service';
import { redemptionsRepo } from '../../src/modules/marketplace/redemptions.repo';
import { txnIntentService } from '../../src/modules/transactions/txn-intent.service';
import { ledgerAccountsRepo } from '../../src/modules/wallet/ledger-accounts.repo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const SECRET = 'whsec_test';
const RETAILER_ID = 'retailer-1';
const RETAILER_BANK = '058';
const RETAILER_ACCT = '0123456789';
const GROSS = 20_000n;
const DISCOUNTED = 12_345n;
const COMMISSION = 617n; // floor(12_345 * 500 / 10000)
const RETAILER_NET = DISCOUNTED - COMMISSION; // 11_728

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function okAdapter(json: Record<string, unknown>, status = 202) {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  return { adapter };
}

/** Reserve → redeem a voucher, leaving the payout txn `in_flight` and linked (payoutStatus=pending). */
async function seedRedeemedInFlight() {
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
  const { redemption } = await purchaseService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    retailerId: RETAILER_ID,
    catalogItemId: 'item-1',
    retailerBankCode: RETAILER_BANK,
    retailerAccount: RETAILER_ACCT,
    grossKobo: kobo(GROSS),
    discountedKobo: kobo(DISCOUNTED),
    idempotencyKey: factories.idempotencyKey(),
    now: new Date('2026-07-01T00:00:00Z'),
  });
  const { adapter } = okAdapter({
    id: 'tr-redeem-1',
    status: 'PENDING',
    reference: `redeem:${redemption.id}`,
  });
  const result = await redeemService.redeem(testDb, adapter, {
    retailerId: RETAILER_ID,
    code: redemption.code,
    now: new Date('2026-07-02T00:00:00Z'),
    householdRef: hh.id,
  });
  return { mw, sw, redemption, payoutTransactionId: result.payoutTransactionId };
}

/** A normal in-flight spend, so its `transfer.completed` must still route to settlementService. */
async function seedSpendInFlight() {
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
    anchorVirtualAccount: 'VA-spend',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-spend',
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
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    kind: 'topup',
    amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(100_000n),
    },
  ]);
  const txn = await txnIntentService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n),
    idempotencyKey: 'k-spend-mkt',
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(5_000n),
    },
  ]);
  return { txnId: txn.id };
}

describe('POST /webhooks/anchor — marketplace dispatch', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('transfer.completed for a redemption payout → settles via redemptionSettlement (paid + commission credited)', async () => {
    const { mw, redemption, payoutTransactionId } = await seedRedeemedInFlight();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-mkt-tc-1',
      type: 'transfer.completed',
      createdAt: '2026-07-03T12:00:30Z',
      data: {
        transferId: 'tr-redeem-1',
        reference: `redeem:${redemption.id}`,
        status: 'COMPLETED',
        nibssSessionId: 'sess-mkt-1',
      },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);

    // Voucher payout now paid.
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('paid');

    // Payout txn settled.
    const payout = await transactionsRepo.findById(testDb, payoutTransactionId);
    expect(payout?.status).toBe('settled');

    // The single balanced entry: suspense drained (→0), commission + external credited.
    // accountBalance is (debit - credit); credit-normal LAs read negative.
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.commission)).toBe(
      -COMMISSION,
    );
    const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
      testDb,
      mw.master.id,
      'external',
    );
    expect(externalLA).toBeDefined();
    expect(await postingsRepo.accountBalance(testDb, externalLA?.id ?? '')).toBe(-RETAILER_NET);
  });

  it('transfer.completed for a normal spend still settles via settlementService (regression)', async () => {
    const { txnId } = await seedSpendInFlight();
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-mkt-spend-1',
      type: 'transfer.completed',
      createdAt: '2026-07-03T12:00:30Z',
      data: {
        transferId: 'tr-spend-1',
        reference: 'k-spend-mkt',
        status: 'COMPLETED',
        nibssSessionId: 'sess-spend-1',
      },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
  });

  it('transfer.failed for a redemption payout → handlePayoutFailed (no buyer refund, funds stay in suspense)', async () => {
    const { mw, redemption, payoutTransactionId } = await seedRedeemedInFlight();
    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const app = createServer();
    const body = JSON.stringify({
      id: 'evt-mkt-tf-1',
      type: 'transfer.failed',
      createdAt: '2026-07-03T12:00:30Z',
      data: {
        transferId: 'tr-redeem-1',
        reference: `redeem:${redemption.id}`,
        status: 'FAILED',
        failureReason: 'bank down',
      },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(body) },
    });
    expect(res.status).toBe(200);

    // Voucher stays redeemed; payout advanced to failed_retryable; funds NOT refunded.
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('redeemed');
    expect(row?.payoutStatus).toBe('failed_retryable');
    const payout = await transactionsRepo.findById(testDb, payoutTransactionId);
    expect(payout?.status).toBe('failed');
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(
      suspenseBefore,
    );
  });
});
