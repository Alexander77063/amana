import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { redeemService } from '../../../src/modules/marketplace/redeem.service';
import { redemptionSettlementService } from '../../../src/modules/marketplace/redemption-settlement.service';
import { redemptionsRepo } from '../../../src/modules/marketplace/redemptions.repo';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { ensureRetailerAndItem } from '../../helpers/marketplace-seed';
import { testDb, truncateAll } from '../../helpers/test-db';

vi.mock('expo-server-sdk', () => {
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  }));
  (ExpoMock as unknown as Record<string, unknown>).isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

// Assigned per-test by the seed helpers below — redemptions.retailer_id is a real uuid FK (SP4).
let RETAILER_ID: string;
let ITEM_ID: string;
const RETAILER_BANK = '058';
const RETAILER_ACCT = '0123456789';
const GROSS = 20_000n;
const DISCOUNTED = 12_345n;
const COMMISSION = 617n; // floor(12_345 * 500 / 10000)
const RETAILER_NET = DISCOUNTED - COMMISSION; // 11_728

async function seedAndRedeem() {
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

  const fetchSpy = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: `redeem:${redemption.id}` }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  const redeemed = await redeemService.redeem(testDb, adapter, {
    retailerId: RETAILER_ID,
    code: redemption.code,
    now: new Date('2026-07-02T00:00:00Z'),
    householdRef: hh.id,
  });
  return { mw, sw, redemption, payoutTransactionId: redeemed.payoutTransactionId };
}

describe('redemptionSettlementService.finalise', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(6) settles: debits suspense=discounted, credits external=retailerNet + commission=commission', async () => {
    const { mw, redemption, payoutTransactionId } = await seedAndRedeem();

    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const externalBefore = await (async () => {
      const la = await ledgerAccountsRepo.findByMasterAndKind(testDb, mw.master.id, 'external');
      return la ? postingsRepo.accountBalance(testDb, la.id) : 0n;
    })();
    const commissionBefore = await postingsRepo.accountBalance(
      testDb,
      mw.ledgerAccountIds.commission,
    );

    await redemptionSettlementService.finalise(testDb, {
      payoutTransactionId,
      nibssSessionId: 'nibss-1',
      settledAt: new Date('2026-07-02T00:05:00Z'),
    });

    const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
      testDb,
      mw.master.id,
      'external',
    );
    if (!externalLA) throw new Error('external LA should exist after settle');

    const suspenseAfter = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const externalAfter = await postingsRepo.accountBalance(testDb, externalLA.id);
    const commissionAfter = await postingsRepo.accountBalance(
      testDb,
      mw.ledgerAccountIds.commission,
    );

    // suspense debited (+discounted); external + commission credited (negative deltas).
    expect(suspenseAfter - suspenseBefore).toBe(DISCOUNTED);
    expect(externalAfter - externalBefore).toBe(-RETAILER_NET);
    expect(commissionAfter - commissionBefore).toBe(-COMMISSION);

    // Exactly one balanced entry on the payout txn (3 legs).
    const legs = await postingsRepo.listByTransaction(testDb, payoutTransactionId);
    expect(legs.length).toBe(3);

    const payout = await transactionsRepo.findById(testDb, payoutTransactionId);
    expect(payout?.status).toBe('settled');
    expect(payout?.nibssSessionId).toBe('nibss-1');

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('paid');
    expect(row?.status).toBe('redeemed');
  });

  it('(7) idempotent: calling finalise twice writes no double legs', async () => {
    const { payoutTransactionId } = await seedAndRedeem();

    await redemptionSettlementService.finalise(testDb, {
      payoutTransactionId,
      nibssSessionId: 'nibss-1',
      settledAt: new Date('2026-07-02T00:05:00Z'),
    });
    await redemptionSettlementService.finalise(testDb, {
      payoutTransactionId,
      nibssSessionId: 'nibss-1',
      settledAt: new Date('2026-07-02T00:06:00Z'),
    });

    const legs = await postingsRepo.listByTransaction(testDb, payoutTransactionId);
    expect(legs.length).toBe(3);
  });
});

describe('redemptionSettlementService.handlePayoutFailed', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(8) marks failed_retryable + attempts, no refund, voucher stays redeemed; 3rd → stuck', async () => {
    const { mw, sw, redemption, payoutTransactionId } = await seedAndRedeem();

    const suspenseBefore = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    const sourceBefore = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);

    // Cycle 1: fail → failed_retryable, attempts 1.
    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'NIP timeout',
      failedAt: new Date('2026-07-02T00:05:00Z'),
    });
    let row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('failed_retryable');
    expect(row?.payoutAttempts).toBe(1);
    expect(row?.status).toBe('redeemed');

    // CRITICAL: no buyer refund — suspense + source unchanged.
    expect(await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense)).toBe(
      suspenseBefore,
    );
    expect(await postingsRepo.accountBalance(testDb, sw.ledgerAccountId)).toBe(sourceBefore);

    // Model a requeue: the ops/auto retry re-initiates the transfer (pending → in_flight)
    // before the next failure — the state machine's failed_retryable → (requeue) edge.
    await transactionsRepo.setStatus(testDb, payoutTransactionId, 'in_flight');
    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'NIP timeout 2',
      failedAt: new Date('2026-07-02T00:10:00Z'),
    });
    row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('failed_retryable');
    expect(row?.payoutAttempts).toBe(2);

    // Cycle 3: attempts reaches 3 → stuck (terminal).
    await transactionsRepo.setStatus(testDb, payoutTransactionId, 'in_flight');
    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'NIP timeout 3',
      failedAt: new Date('2026-07-02T00:15:00Z'),
    });
    row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('stuck');
    expect(row?.payoutAttempts).toBe(3);
    expect(row?.status).toBe('redeemed');

    const payout = await transactionsRepo.findById(testDb, payoutTransactionId);
    expect(payout?.status).toBe('failed');
    expect(payout?.errorMessage).toBe('NIP timeout 3');
  });

  it('(8b) idempotent: repeated call on already-failed payout txn is a no-op', async () => {
    const { redemption, payoutTransactionId } = await seedAndRedeem();

    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'once',
      failedAt: new Date('2026-07-02T00:05:00Z'),
    });
    // No requeue between calls → guard short-circuits, attempts stay at 1.
    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'twice',
      failedAt: new Date('2026-07-02T00:06:00Z'),
    });

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('failed_retryable');
    expect(row?.payoutAttempts).toBe(1);
  });

  it('(8c) writes an audit entry for ops', async () => {
    const { redemption, payoutTransactionId } = await seedAndRedeem();
    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'boom',
      failedAt: new Date('2026-07-02T00:05:00Z'),
    });
    const entries = await auditRepo.listBySubject(testDb, redemption.id);
    expect(entries.some((e) => e.action === 'marketplace.redemption_payout_failed')).toBe(true);
  });

  it('(8d) a spurious transfer.failed AFTER settlement is a no-op — closes the double-payout window', async () => {
    const { redemption, payoutTransactionId } = await seedAndRedeem();
    // transfer.completed settles the payout (paid, ledger drained suspense→external+commission).
    await redemptionSettlementService.finalise(testDb, {
      payoutTransactionId,
      nibssSessionId: 'test-session-8d',
      settledAt: new Date('2026-07-02T00:05:00Z'),
    });
    const legsBefore = await postingsRepo.listByTransaction(testDb, payoutTransactionId);

    // A reordered/spurious transfer.failed (a different Anchor event id, so webhook dedupe lets it
    // through) must NOT flip the settled payout back to failed_retryable — else a requeue re-pays
    // the retailer. Guard is `status !== 'in_flight' → return`.
    await redemptionSettlementService.handlePayoutFailed(testDb, {
      payoutTransactionId,
      reason: 'late failure after settle',
      failedAt: new Date('2026-07-02T00:06:00Z'),
    });

    const payout = await transactionsRepo.findById(testDb, payoutTransactionId);
    expect(payout?.status).toBe('settled');
    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.payoutStatus).toBe('paid');
    expect(row?.payoutAttempts).toBe(0);
    const legsAfter = await postingsRepo.listByTransaction(testDb, payoutTransactionId);
    expect(legsAfter.length).toBe(legsBefore.length);
  });
});
