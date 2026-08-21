import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transactions } from '../../../src/db/schema';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { ConflictError, ForbiddenError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { redeemService } from '../../../src/modules/marketplace/redeem.service';
import { redemptionsRepo } from '../../../src/modules/marketplace/redemptions.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { ensureRetailerAndItem, seedRetailerAndItem } from '../../helpers/marketplace-seed';
import { testDb, truncateAll } from '../../helpers/test-db';

// Assigned per-test by the seed helpers below — redemptions.retailer_id is a real uuid FK (SP4).
let RETAILER_ID: string;
let ITEM_ID: string;
const RETAILER_BANK = '058';
const RETAILER_ACCT = '0123456789';
const GROSS = 20_000n;
const DISCOUNTED = 12_345n;
// 12_345 * 500 / 10000 = 617.25 → floor 617
const COMMISSION = 617n;
const RETAILER_NET = DISCOUNTED - COMMISSION; // 11_728

/** Seed a household + master wallet + agent sub-wallet and reserve a voucher (status='reserved'). */
async function seedReserved() {
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
  const seeded = await ensureRetailerAndItem(testDb);
  RETAILER_ID = seeded.retailer.id;
  ITEM_ID = seeded.item.id;
  const { redemption } = await purchaseService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    retailerId: RETAILER_ID,
    catalogItemId: ITEM_ID,
    retailerBankCode: RETAILER_BANK,
    retailerAccount: RETAILER_ACCT,
    grossKobo: kobo(GROSS),
    discountedKobo: kobo(DISCOUNTED),
    idempotencyKey: factories.idempotencyKey(),
    now: new Date('2026-07-01T00:00:00Z'),
  });
  return { hh, mw, sw, redemption };
}

/** An adapter whose fetch returns a 200 with the given transfer JSON. */
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
  return { adapter, fetchSpy };
}

describe('redeemService.redeem', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(1) happy: creates in_flight redemption payout, marks voucher redeemed/pending, no legs move at redeem', async () => {
    const { hh, mw, sw, redemption } = await seedReserved();

    // Balances after reserve, before redeem.
    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceBefore = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);

    const { adapter, fetchSpy } = okAdapter({
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

    expect(result.status).toBe('PENDING');
    expect(result.payoutTransactionId).toBeTruthy();

    // Payout txn: kind=redemption, in_flight, amount = retailerNet.
    const payout = await transactionsRepo.findById(testDb, result.payoutTransactionId);
    expect(payout?.kind).toBe('redemption');
    expect(payout?.status).toBe('in_flight');
    expect(payout?.amountKobo).toBe(RETAILER_NET);
    expect(payout?.idempotencyKey).toBe(`redeem:${redemption.id}`);
    expect(payout?.vendorAccount).toBe(RETAILER_ACCT);
    expect(payout?.vendorBankCode).toBe(RETAILER_BANK);

    // Voucher: redeemed + payout pending, linked.
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('redeemed');
    expect(row?.payoutStatus).toBe('pending');
    expect(row?.payoutTransactionId).toBe(result.payoutTransactionId);
    expect(row?.redeemedAt).toBeTruthy();

    // adapter.transfer called exactly once, with retailerNet.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
    expect(body.amountKobo).toBe(RETAILER_NET.toString());
    expect(body.toAccountNumber).toBe(RETAILER_ACCT);

    // CRITICAL: no ledger legs move at redeem — suspense and source unchanged from post-reserve.
    const suspenseAfter = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceAfter = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);
    expect(suspenseAfter).toBe(suspenseBefore);
    expect(sourceAfter).toBe(sourceBefore);
    // No postings exist for the payout txn.
    const payoutLegs = await postingsRepo.listByTransaction(testDb, result.payoutTransactionId);
    expect(payoutLegs.length).toBe(0);
  });

  it('(2) expired voucher → ConflictError, no payout txn, voucher still reserved', async () => {
    const { hh, redemption } = await seedReserved();
    const { adapter, fetchSpy } = okAdapter({ id: 'x', status: 'PENDING', reference: 'x' });

    await expect(
      redeemService.redeem(testDb, adapter, {
        retailerId: RETAILER_ID,
        code: redemption.code,
        // expiresAt = 2026-07-01 + 168h = 2026-07-08; use a time past that.
        now: new Date('2026-07-20T00:00:00Z'),
        householdRef: hh.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(fetchSpy).not.toHaveBeenCalled();
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('reserved');
    expect(row?.payoutStatus).toBeNull();
    expect(row?.payoutTransactionId).toBeNull();
  });

  it('(3) wrong retailer → ForbiddenError', async () => {
    const { hh, redemption } = await seedReserved();
    const { adapter, fetchSpy } = okAdapter({ id: 'x', status: 'PENDING', reference: 'x' });
    // A real second retailer, not a literal — retailer_id is a uuid FK, and a non-uuid
    // string would fail as a Postgres cast error rather than the authz denial under test.
    const other = await seedRetailerAndItem(testDb, { businessName: 'Someone Else Ltd' });

    await expect(
      redeemService.redeem(testDb, adapter, {
        retailerId: other.retailer.id,
        code: redemption.code,
        now: new Date('2026-07-02T00:00:00Z'),
        householdRef: hh.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(fetchSpy).not.toHaveBeenCalled();
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('reserved');
  });

  it('(4) double redeem: second call rejected, exactly one payout txn', async () => {
    const { hh, redemption } = await seedReserved();
    const { adapter } = okAdapter({
      id: 'tr-redeem-1',
      status: 'PENDING',
      reference: `redeem:${redemption.id}`,
    });

    await redeemService.redeem(testDb, adapter, {
      retailerId: RETAILER_ID,
      code: redemption.code,
      now: new Date('2026-07-02T00:00:00Z'),
      householdRef: hh.id,
    });

    const { adapter: adapter2 } = okAdapter({ id: 'y', status: 'PENDING', reference: 'y' });
    await expect(
      redeemService.redeem(testDb, adapter2, {
        retailerId: RETAILER_ID,
        code: redemption.code,
        now: new Date('2026-07-02T01:00:00Z'),
        householdRef: hh.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const allTxns = await testDb.select().from(transactions);
    const redemptionTxns = allTxns.filter((t) => t.kind === 'redemption');
    expect(redemptionTxns.length).toBe(1);
  });

  it('(5) CRITICAL: sync payout failure → buyer NOT refunded, voucher stays redeemed, payout failed_retryable', async () => {
    const { hh, mw, sw, redemption } = await seedReserved();
    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceBefore = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);

    // 200 OK but status=FAILED → synchronous payout failure.
    const { adapter } = okAdapter(
      {
        id: 'tr-fail',
        status: 'FAILED',
        reference: `redeem:${redemption.id}`,
        failureReason: 'bank down',
      },
      200,
    );

    const result = await redeemService.redeem(testDb, adapter, {
      retailerId: RETAILER_ID,
      code: redemption.code,
      now: new Date('2026-07-02T00:00:00Z'),
      householdRef: hh.id,
    });

    expect(result.status).toBe('FAILED');
    expect(result.payoutFailed).toBe(true);

    // Voucher STAYS redeemed; payout marked failed_retryable, attempts incremented to 1.
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('redeemed');
    expect(row?.payoutStatus).toBe('failed_retryable');
    expect(row?.payoutAttempts).toBe(1);

    // Payout txn marked failed.
    const payout = await transactionsRepo.findById(testDb, result.payoutTransactionId);
    expect(payout?.status).toBe('failed');

    // CRITICAL: buyer funds NOT touched — suspense + source unchanged, no reversal legs.
    const suspenseAfter = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceAfter = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);
    expect(suspenseAfter).toBe(suspenseBefore);
    expect(sourceAfter).toBe(sourceBefore);
    const payoutLegs = await postingsRepo.listByTransaction(testDb, result.payoutTransactionId);
    expect(payoutLegs.length).toBe(0);
  });

  it('(5b) sync payout failure via thrown adapter error → same no-refund semantics', async () => {
    const { hh, mw, sw, redemption } = await seedReserved();
    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceBefore = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);

    // 500 → AnchorHttpError after exhausted retries.
    const fetchSpy = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });

    const result = await redeemService.redeem(testDb, adapter, {
      retailerId: RETAILER_ID,
      code: redemption.code,
      now: new Date('2026-07-02T00:00:00Z'),
      householdRef: hh.id,
    });

    expect(result.status).toBe('FAILED');
    expect(result.payoutFailed).toBe(true);

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('redeemed');
    expect(row?.payoutStatus).toBe('failed_retryable');
    expect(row?.payoutAttempts).toBe(1);

    const suspenseAfter = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceAfter = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);
    expect(suspenseAfter).toBe(suspenseBefore);
    expect(sourceAfter).toBe(sourceBefore);
  });

  it('(6) unknown code → NotFoundError', async () => {
    const { hh } = await seedReserved();
    const { adapter } = okAdapter({ id: 'x', status: 'PENDING', reference: 'x' });
    await expect(
      redeemService.redeem(testDb, adapter, {
        retailerId: RETAILER_ID,
        code: 'AMN-NOPE',
        now: new Date('2026-07-02T00:00:00Z'),
        householdRef: hh.id,
      }),
    ).rejects.toThrow();
  });
});
