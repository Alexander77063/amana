import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { notificationService } from '../notifications/notification.service';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { redemptionsRepo } from './redemptions.repo';

type DbOrTx = PostgresJsDatabase;

export type FinaliseInput = {
  payoutTransactionId: string;
  nibssSessionId: string | null;
  settledAt: Date;
};

export type HandlePayoutFailedInput = {
  payoutTransactionId: string;
  reason: string | null;
  failedAt: Date;
};

/** Payout attempts at or above this count are terminal (`stuck`, manual ops). */
const MAX_PAYOUT_ATTEMPTS = 3;

type SettledInfo = {
  redemptionId: string;
  retailerNet: bigint;
  commission: bigint;
  masterWalletId: string;
  subWalletId: string | null;
  buyerUserId: string;
};

export const redemptionSettlementService = {
  /**
   * Settle a completed redemption payout (webhook `transfer.completed`, kind=redemption). Books the
   * ONE balanced entry that finally moves the buyer's held funds: `debit suspense = discounted`,
   * `credit external = retailerNet`, `credit commission = commission`. The commission is Amana's
   * revenue, recognised by crediting a dedicated credit-normal `commission` LA (lazy-created like
   * `external`) — it must NOT share the spend `fee` account.
   */
  async finalise(db: DbOrTx, input: FinaliseInput): Promise<void> {
    const s = await db.transaction<SettledInfo | null>(async (txx) => {
      const tx = txx as DbOrTx;
      const payoutTxn = await transactionsRepo.findById(tx, input.payoutTransactionId);
      if (!payoutTxn) throw new Error(`payout txn ${input.payoutTransactionId} not found`);
      if (payoutTxn.status === 'settled') return null; // idempotent: webhook may fire twice
      if (payoutTxn.status !== 'in_flight') {
        throw new Error(`cannot settle redemption payout in status ${payoutTxn.status}`);
      }

      const redemption = await redemptionsRepo.findByPayoutTxnId(tx, payoutTxn.id);
      if (!redemption) {
        throw new Error(`no redemption for payout txn ${payoutTxn.id} — inconsistent state`);
      }

      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(
        tx,
        payoutTxn.masterWalletId,
        'suspense',
      );
      if (!suspenseLA) throw new Error('master wallet missing suspense ledger account');

      // external + commission LAs may not exist for wallets provisioned before migration 0027 —
      // lazy-create on first use exactly as settlement.service creates `external` (both credit-normal).
      let externalLA = await ledgerAccountsRepo.findByMasterAndKind(
        tx,
        payoutTxn.masterWalletId,
        'external',
      );
      if (!externalLA) {
        externalLA = await ledgerAccountsRepo.insert(tx, {
          masterWalletId: payoutTxn.masterWalletId,
          kind: 'external',
          normalSide: 'credit',
        });
      }
      let commissionLA = await ledgerAccountsRepo.findByMasterAndKind(
        tx,
        payoutTxn.masterWalletId,
        'commission',
      );
      if (!commissionLA) {
        commissionLA = await ledgerAccountsRepo.insert(tx, {
          masterWalletId: payoutTxn.masterWalletId,
          kind: 'commission',
          normalSide: 'credit',
        });
      }

      const discounted = redemption.discountedKobo as bigint;
      const commission = redemption.commissionKobo as bigint;
      const retailerNet = discounted - commission;
      // Guard the carve invariant explicitly (don't lean solely on writeDoubleEntry's balance check).
      if (discounted !== retailerNet + commission) {
        throw new Error(
          `redemption carve invalid: discounted=${discounted} net=${retailerNet} commission=${commission}`,
        );
      }

      // Drain the full hold from suspense; credit the retailer's net and Amana's commission.
      // Omit a leg whose amount is zero: the `postings` CHECK requires exactly one side non-zero,
      // so a 0-kobo leg is invalid. commission rounds to 0 for a sub-20-kobo purchase (5% floor);
      // retailerNet is 0 only in the degenerate 100%-commission case. `discounted > 0` guarantees
      // at least one of the two credit legs remains, so the entry keeps ≥2 legs and stays balanced.
      const legs = [
        { ledgerAccountId: suspenseLA.id, debitKobo: kobo(discounted), creditKobo: kobo(0n) },
      ];
      if (retailerNet > 0n) {
        legs.push({
          ledgerAccountId: externalLA.id,
          debitKobo: kobo(0n),
          creditKobo: kobo(retailerNet),
        });
      }
      if (commission > 0n) {
        legs.push({
          ledgerAccountId: commissionLA.id,
          debitKobo: kobo(0n),
          creditKobo: kobo(commission),
        });
      }
      await ledgerService.writeDoubleEntry(tx, payoutTxn.id, legs);

      await transactionsRepo.setStatus(tx, payoutTxn.id, 'settled', input.settledAt);
      if (input.nibssSessionId) {
        await transactionsRepo.setNibssSessionId(tx, payoutTxn.id, input.nibssSessionId);
      }
      await redemptionsRepo.setPayout(tx, redemption.id, { payoutStatus: 'paid' });

      await auditRepo.append(
        tx,
        auditEvents.marketplaceRedemptionSettled({
          redemptionId: redemption.id,
          payoutTransactionId: payoutTxn.id,
          retailerNetKobo: retailerNet,
          commissionKobo: commission,
          nibssSessionId: input.nibssSessionId,
          settledAt: input.settledAt,
        }),
      );

      return {
        redemptionId: redemption.id,
        retailerNet,
        commission,
        masterWalletId: payoutTxn.masterWalletId,
        subWalletId: payoutTxn.subWalletId,
        buyerUserId: redemption.buyerUserId,
      };
    });

    if (!s) return; // idempotent no-op — nothing to notify.

    // Best-effort buyer notification — reuses the `txn_settled` kind; never fails the settle.
    try {
      const dedupeKey = `redemption-settled:${s.redemptionId}`;
      await notificationService.dispatch(db, {
        kind: 'txn_settled',
        recipientUserId: s.buyerUserId,
        dedupeKey,
        amountKobo: kobo(s.retailerNet),
        subWalletId: s.subWalletId ?? undefined,
        payload: {
          transactionId: input.payoutTransactionId,
          subWalletId: s.subWalletId ?? null,
          amountKobo: kobo(s.retailerNet),
          vendorResolvedName: 'Retailer',
          nibssSessionId: input.nibssSessionId,
        },
      });
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        'redemption_settled notification failed (non-fatal)',
      );
    }
  },

  /**
   * Handle a failed redemption payout (webhook `transfer.failed`, kind=redemption).
   *
   * **CRITICAL:** the service was already delivered, so this NEVER refunds the buyer. Funds stay in
   * `suspense`, the voucher stays `redeemed`. We only advance the payout state machine: bump the
   * attempt counter and set `failed_retryable` (ops/auto requeue re-initiates) until attempts reach
   * the terminal `stuck`. No suspense→source posting, no `reversalService`.
   */
  async handlePayoutFailed(db: DbOrTx, input: HandlePayoutFailedInput): Promise<void> {
    await db.transaction(async (txx) => {
      const tx = txx as DbOrTx;
      const payoutTxn = await transactionsRepo.findById(tx, input.payoutTransactionId);
      if (!payoutTxn) throw new Error(`payout txn ${input.payoutTransactionId} not found`);
      if (payoutTxn.status === 'failed') return; // idempotent: one failure per requeue cycle

      const redemption = await redemptionsRepo.findByPayoutTxnId(tx, payoutTxn.id);
      if (!redemption) {
        throw new Error(`no redemption for payout txn ${payoutTxn.id} — inconsistent state`);
      }

      // Compute the next attempt count from the current value; ≥ MAX → terminal `stuck`.
      const nextAttempts = redemption.payoutAttempts + 1;
      const payoutStatus = nextAttempts >= MAX_PAYOUT_ATTEMPTS ? 'stuck' : 'failed_retryable';

      await redemptionsRepo.setPayout(tx, redemption.id, {
        payoutStatus,
        incrementAttempts: true,
      });
      await transactionsRepo.setStatus(tx, payoutTxn.id, 'failed', input.failedAt);
      if (input.reason) {
        await transactionsRepo.setErrorMessage(tx, payoutTxn.id, input.reason);
      }

      await auditRepo.append(
        tx,
        auditEvents.marketplaceRedemptionPayoutFailed({
          redemptionId: redemption.id,
          payoutTransactionId: payoutTxn.id,
          payoutStatus,
          payoutAttempts: nextAttempts,
          reason: input.reason,
          failedAt: input.failedAt,
        }),
      );
      logger.warn(
        {
          redemptionId: redemption.id,
          payoutTxnId: payoutTxn.id,
          payoutStatus,
          payoutAttempts: nextAttempts,
          reason: input.reason,
        },
        'marketplace redemption payout failed — funds held in suspense, no buyer refund',
      );
    });
  },
};
