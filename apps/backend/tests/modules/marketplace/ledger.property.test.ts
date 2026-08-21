import { sql } from 'drizzle-orm';
import * as fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { MARKETPLACE_COMMISSION_BPS } from '../../../src/modules/marketplace/config';
import { expiryService } from '../../../src/modules/marketplace/expiry.service';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { redeemService } from '../../../src/modules/marketplace/redeem.service';
import { redemptionSettlementService } from '../../../src/modules/marketplace/redemption-settlement.service';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { ensureRetailerAndItem } from '../../helpers/marketplace-seed';
import { testDb, truncateAll } from '../../helpers/test-db';

// Settlement dispatches a best-effort buyer notification (Expo push) — stub the SDK so it never
// reaches the network, exactly as the settlement service test does.
vi.mock('expo-server-sdk', () => {
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  }));
  (ExpoMock as unknown as Record<string, unknown>).isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

// Assigned by `seed()` per property run — redemptions.retailer_id is a real uuid FK (SP4).
let RETAILER_ID: string;
let ITEM_ID: string;
const RETAILER_BANK = '058';
const RETAILER_ACCT = '0123456789';

/** Seed a household + master wallet + agent sub-wallet; return the ids the property needs. */
async function seed() {
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
  return { hh, mw, sw, agentId: agent.id };
}

/** An Anchor adapter whose transfer always resolves PENDING (payout accepted; settles via webhook). */
function pendingAdapter() {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr-x', status: 'PENDING', reference: 'r' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }),
  );
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
}

/** Assert every transaction's postings balance: Σ debit == Σ credit within each txn. */
async function assertEveryTxnBalances() {
  const rows = await testDb.execute<{ transaction_id: string; d: string; c: string }>(sql`
    SELECT transaction_id,
           COALESCE(SUM(debit_kobo), 0)::text AS d,
           COALESCE(SUM(credit_kobo), 0)::text AS c
    FROM postings
    GROUP BY transaction_id
  `);
  for (const r of rows) {
    expect(BigInt(r.d), `txn ${r.transaction_id} debits==credits`).toBe(BigInt(r.c));
  }
}

const PURCHASE_AT = new Date('2026-07-01T00:00:00Z');

describe('marketplace ledger invariants (property-based)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('reserve → redeem → settle conserves money: suspense released, external+commission credited exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Full domain 0 < discounted <= gross — including sub-20-kobo purchases where commission
        // floors to 0. finalise omits a zero-amount leg, so the entry stays valid (this exercises
        // that path). gross >= discounted.
        fc
          .bigInt({ min: 1n, max: 5_000_000n })
          .chain((discounted) =>
            fc
              .bigInt({ min: discounted, max: 10_000_000n })
              .map((gross) => ({ discounted, gross })),
          ),
        async ({ discounted, gross }) => {
          await truncateAll();
          const { hh, mw, sw } = await seed();

          const commission = (discounted * BigInt(MARKETPLACE_COMMISSION_BPS)) / 10000n;
          const retailerNet = discounted - commission;
          // commission may be 0 for a sub-20-kobo purchase (5% floor); finalise omits the zero leg
          // and assertion (4) below then expects a 0 delta on the commission LA.

          const suspenseBefore = await postingsRepo.accountBalance(
            testDb,
            mw.ledgerAccountIds.suspense,
          );
          const commissionBefore = await postingsRepo.accountBalance(
            testDb,
            mw.ledgerAccountIds.commission,
          );

          const { redemption } = await purchaseService.create(testDb, {
            actorUserId: sw.sub.agentUserId,
            masterWalletId: mw.master.id,
            subWalletId: sw.sub.id,
            retailerId: RETAILER_ID,
            catalogItemId: ITEM_ID,
            retailerBankCode: RETAILER_BANK,
            retailerAccount: RETAILER_ACCT,
            grossKobo: kobo(gross),
            discountedKobo: kobo(discounted),
            idempotencyKey: factories.idempotencyKey(),
            now: PURCHASE_AT,
          });
          expect(redemption.commissionKobo).toBe(commission);

          const redeemed = await redeemService.redeem(testDb, pendingAdapter(), {
            retailerId: RETAILER_ID,
            code: redemption.code,
            now: new Date('2026-07-02T00:00:00Z'),
            householdRef: hh.id,
          });
          expect(redeemed.status).toBe('PENDING');

          await redemptionSettlementService.finalise(testDb, {
            payoutTransactionId: redeemed.payoutTransactionId,
            nibssSessionId: factories.nibssSessionId(),
            settledAt: new Date('2026-07-02T00:05:00Z'),
          });

          // (1) Every transaction's postings balance.
          await assertEveryTxnBalances();

          // (2) The hold is fully released: suspense nets back to its pre-purchase balance.
          const suspenseAfter = await postingsRepo.accountBalance(
            testDb,
            mw.ledgerAccountIds.suspense,
          );
          expect(suspenseAfter).toBe(suspenseBefore);

          // (3) external credited exactly retailerNet (credit lowers debit-minus-credit balance).
          const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
            testDb,
            mw.master.id,
            'external',
          );
          if (!externalLA) throw new Error('external LA should exist after settle');
          const externalBalance = await postingsRepo.accountBalance(testDb, externalLA.id);
          expect(externalBalance).toBe(kobo(-retailerNet));

          // (4) commission LA credited exactly commissionKobo.
          const commissionAfter = await postingsRepo.accountBalance(
            testDb,
            mw.ledgerAccountIds.commission,
          );
          expect(commissionAfter - commissionBefore).toBe(-commission);
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);

  it('reserve → expiry restores the source balance exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        // The expiry branch has no commission leg, so it can span the full spec domain 0 < discounted <= gross.
        fc
          .bigInt({ min: 1n, max: 5_000_000n })
          .chain((discounted) =>
            fc
              .bigInt({ min: discounted, max: 10_000_000n })
              .map((gross) => ({ discounted, gross })),
          ),
        async ({ discounted, gross }) => {
          await truncateAll();
          const { mw, sw } = await seed();

          const sourceBefore = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);

          await purchaseService.create(testDb, {
            actorUserId: sw.sub.agentUserId,
            masterWalletId: mw.master.id,
            subWalletId: sw.sub.id,
            retailerId: RETAILER_ID,
            catalogItemId: ITEM_ID,
            retailerBankCode: RETAILER_BANK,
            retailerAccount: RETAILER_ACCT,
            grossKobo: kobo(gross),
            discountedKobo: kobo(discounted),
            idempotencyKey: factories.idempotencyKey(),
            now: PURCHASE_AT,
          });

          // Sweep well past the 168h TTL so the reserved voucher is refunded.
          const swept = await expiryService.sweepExpired(testDb, new Date('2026-08-01T00:00:00Z'));
          expect(swept).toBe(1);

          await assertEveryTxnBalances();

          const sourceAfter = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);
          expect(sourceAfter).toBe(sourceBefore);
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
