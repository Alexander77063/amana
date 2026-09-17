import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { redemptionSettlementService } from '../marketplace/redemption-settlement.service';
import type { TransactionRow } from '../wallet/transactions.repo';
import { reversalService } from './reversal.service';
import { settlementService } from './settlement.service';

type DbOrTx = PostgresJsDatabase;

/**
 * What an Anchor transfer outcome means, given the kind of transaction it belongs to.
 *
 * Two callers need this answer and must never disagree: the `transfer.completed` / `transfer.failed`
 * webhooks, and the reconciliation sweep that exists precisely for when those webhooks do not
 * arrive. The routing lived inline in the webhook, and the sweep — which only ever looked at
 * `spend` — had no equivalent; duplicating the branch would have put the same decision in two
 * places, on the code path where disagreement costs money.
 *
 * A `redemption` is a retailer PAYOUT. Its failure is not a customer refund: the voucher stays
 * redeemed, the money stays in suspense, and the payout advances its own retry state machine.
 * Routing it to `reversalService` would refund the shopper for a purchase they still hold.
 */

export type TransferCompleted = {
  nibssSessionId: string | null;
  settledAt: Date;
};

export type TransferFailed = {
  reason: string | null;
  failedAt: Date;
};

/** Anchor confirmed the transfer. Settle it the way its kind requires. */
export async function applyTransferCompleted(
  db: DbOrTx,
  txn: TransactionRow,
  input: TransferCompleted,
): Promise<void> {
  if (txn.kind === 'redemption') {
    await redemptionSettlementService.finalise(db, {
      payoutTransactionId: txn.id,
      nibssSessionId: input.nibssSessionId,
      settledAt: input.settledAt,
    });
    return;
  }
  await settlementService.finalise(db, {
    transactionId: txn.id,
    nibssSessionId: input.nibssSessionId,
    settledAt: input.settledAt,
  });
}

/** Anchor rejected the transfer. Unwind it the way its kind requires. */
export async function applyTransferFailed(
  db: DbOrTx,
  txn: TransactionRow,
  input: TransferFailed,
): Promise<void> {
  if (txn.kind === 'redemption') {
    await redemptionSettlementService.handlePayoutFailed(db, {
      payoutTransactionId: txn.id,
      reason: input.reason,
      failedAt: input.failedAt,
    });
    return;
  }
  await reversalService.reverse(db, {
    transactionId: txn.id,
    reason: input.reason,
    failedAt: input.failedAt,
  });
}

/**
 * Kinds that reach `in_flight` awaiting an Anchor **transfer** outcome, and can therefore be both
 * swept and resolved by hand.
 *
 * Measured, not assumed: `topup` is an inbound credit that has already arrived,
 * `marketplace_purchase` is a hold released by redemption or expiry, and `refund`, `fee` and
 * `reversal` are written settled. `vas_purchase` DOES reach `in_flight`, but it is an Anchor
 * *bill* (`POST /bills`), not a transfer — `findTransferByReference` cannot speak to it and no bill
 * lookup exists on the adapter, so it is excluded until one is confirmed to exist.
 */
export const TRANSFER_BACKED_KINDS = ['spend', 'redemption'] as const;
