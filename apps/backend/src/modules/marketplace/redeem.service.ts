import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { selectNarration } from '../../integrations/anchor/narration';
import type { AnchorTransferResponse } from '../../integrations/anchor/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { masterWalletsRepo } from '../wallet/master-wallets.repo';
import { transactionsRepo } from '../wallet/transactions.repo';
import { redemptionsRepo } from './redemptions.repo';

type DbOrTx = PostgresJsDatabase;

export type RedeemInput = {
  /** The retailer presenting the voucher; must match the voucher's `retailerId` (the only authz). */
  retailerId: string;
  /** The short voucher code the retailer scans/keys in. */
  code: string;
  /** Injectable clock for deterministic expiry checks in tests. */
  now: Date;
  /** Household ref used in the NIP narration (mirrors nip-out). */
  householdRef: string;
};

export type RedeemResult = {
  payoutTransactionId: string;
  /** 'PENDING' whenever the payout was accepted (settlement lands later via webhook); 'FAILED' on sync reject. */
  status: 'PENDING' | 'FAILED';
  /** Set only on a synchronous payout failure. Funds STAY in suspense — buyer is NOT refunded. */
  payoutFailed?: boolean;
};

/**
 * Redeem a reserved voucher in person: release the retailer payout WITHOUT moving any ledger legs.
 * The buyer's `discounted` hold stays in `suspense` until the payout settles (webhook →
 * `redemptionSettlementService.finalise`, which books suspense→external+commission) or the payout
 * fails.
 *
 * **CRITICAL failure semantics (not the spend path):** the service was already delivered at the
 * scan, so a synchronous payout failure NEVER refunds the buyer. On failure the voucher stays
 * `redeemed`, the funds stay in `suspense`, the payout is marked `failed_retryable` (ops/auto
 * requeue re-initiates), and we do NOT call `reversalService` nor write any suspense→source posting.
 */
export const redeemService = {
  async redeem(db: DbOrTx, adapter: AnchorAdapter, input: RedeemInput): Promise<RedeemResult> {
    // Phase 1 — one transaction: lock the voucher, validate, create the payout txn (no legs),
    // and flip the voucher to redeemed/pending. Funds remain untouched in suspense.
    const ctx = await db.transaction(async (txx) => {
      const tx = txx as DbOrTx;

      const redemption = await redemptionsRepo.findByCodeForUpdate(tx, input.code);
      if (!redemption) throw new NotFoundError(`voucher not found: ${input.code}`);
      if (redemption.status !== 'reserved') {
        throw new ConflictError(`already redeemed: ${redemption.status}`);
      }
      if (!(redemption.expiresAt > input.now)) {
        throw new ConflictError('voucher expired');
      }
      if (redemption.retailerId !== input.retailerId) {
        throw new ForbiddenError('retailer does not own this voucher');
      }

      // The reserve (purchase) txn carries the retailer's payout destination.
      const reserveTxn = await transactionsRepo.findById(tx, redemption.transactionId);
      if (!reserveTxn) {
        throw new Error(`reserve txn ${redemption.transactionId} missing — inconsistent state`);
      }
      if (!reserveTxn.vendorBankCode || !reserveTxn.vendorAccount) {
        throw new Error(`reserve txn ${reserveTxn.id} missing vendor bank/account`);
      }

      const retailerNet = kobo(
        (redemption.discountedKobo as bigint) - (redemption.commissionKobo as bigint),
      );

      const payoutTxn = await transactionsRepo.insert(tx, {
        masterWalletId: redemption.masterWalletId,
        subWalletId: redemption.subWalletId,
        kind: 'redemption',
        amountKobo: retailerNet,
        idempotencyKey: `redeem:${redemption.id}`,
        vendorAccount: reserveTxn.vendorAccount,
        vendorBankCode: reserveTxn.vendorBankCode,
      });
      await transactionsRepo.setStatus(tx, payoutTxn.id, 'in_flight');

      await redemptionsRepo.markRedeemed(tx, redemption.id, input.now);
      await redemptionsRepo.setPayout(tx, redemption.id, {
        payoutTransactionId: payoutTxn.id,
        payoutStatus: 'pending',
      });

      return {
        redemptionId: redemption.id,
        payoutTxnId: payoutTxn.id,
        idempotencyKey: payoutTxn.idempotencyKey,
        masterWalletId: redemption.masterWalletId,
        retailerId: redemption.retailerId,
        vendorBankCode: reserveTxn.vendorBankCode,
        vendorAccount: reserveTxn.vendorAccount,
        retailerNet,
      };
    });

    // Phase 2 — OUTSIDE the tx (mirror nip-out): initiate the Anchor transfer of `retailerNet`.
    const master = await masterWalletsRepo.findById(db, ctx.masterWalletId);
    if (!master) throw new Error(`master_wallet ${ctx.masterWalletId} disappeared`);

    const narration = selectNarration({ householdRef: input.householdRef, agentUserId: null });

    let response: AnchorTransferResponse;
    try {
      response = await adapter.transfer(
        {
          amountKobo: ctx.retailerNet,
          fromAccountId: master.anchorAccountId,
          toBankCode: ctx.vendorBankCode,
          toAccountNumber: ctx.vendorAccount,
          narration,
          reference: ctx.idempotencyKey,
        },
        ctx.idempotencyKey,
      );
    } catch (e) {
      const reason =
        e instanceof AnchorHttpError
          ? `Anchor HTTP ${e.status}`
          : `Anchor error: ${(e as Error).message}`;
      return this.markPayoutSyncFailed(db, ctx, reason);
    }

    // 200 OK with status='FAILED' is also a synchronous failure — same no-refund handling.
    if (response.status === 'FAILED') {
      return this.markPayoutSyncFailed(
        db,
        ctx,
        response.failureReason ?? 'Anchor returned status=FAILED',
      );
    }

    await auditRepo.append(
      db,
      auditEvents.marketplaceRedeemed({
        redemptionId: ctx.redemptionId,
        payoutTransactionId: ctx.payoutTxnId,
        retailerId: ctx.retailerId,
        retailerNetKobo: ctx.retailerNet as bigint,
        status: 'PENDING',
        reason: null,
      }),
    );

    // Success: PENDING or COMPLETED both defer to the webhook settlement (finalise).
    return { payoutTransactionId: ctx.payoutTxnId, status: 'PENDING' };
  },

  /**
   * Record a synchronous payout failure WITHOUT refunding the buyer. Funds stay in suspense, the
   * voucher stays `redeemed`; only the payout state + txn move. Ops/auto requeue re-initiates.
   */
  async markPayoutSyncFailed(
    db: DbOrTx,
    ctx: {
      redemptionId: string;
      payoutTxnId: string;
      retailerId: string;
      retailerNet: ReturnType<typeof kobo>;
    },
    reason: string,
  ): Promise<RedeemResult> {
    await redemptionsRepo.setPayout(db, ctx.redemptionId, {
      payoutStatus: 'failed_retryable',
      incrementAttempts: true,
    });
    await transactionsRepo.setStatus(db, ctx.payoutTxnId, 'failed');
    await transactionsRepo.setErrorMessage(db, ctx.payoutTxnId, reason);

    await auditRepo.append(
      db,
      auditEvents.marketplaceRedeemed({
        redemptionId: ctx.redemptionId,
        payoutTransactionId: ctx.payoutTxnId,
        retailerId: ctx.retailerId,
        retailerNetKobo: ctx.retailerNet as bigint,
        status: 'FAILED',
        reason,
      }),
    );
    logger.warn(
      { redemptionId: ctx.redemptionId, payoutTxnId: ctx.payoutTxnId, reason },
      'marketplace redemption payout failed synchronously — funds held in suspense, no buyer refund',
    );

    return { payoutTransactionId: ctx.payoutTxnId, status: 'FAILED', payoutFailed: true };
  },
};
