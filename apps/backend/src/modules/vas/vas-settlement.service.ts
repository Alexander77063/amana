import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { notificationService } from '../notifications/notification.service';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { vasPurchasesRepo } from './vas-purchases.repo';

type DbOrTx = PostgresJsDatabase;

export type VasFinaliseInput = {
  transactionId: string;
  commissionKobo: bigint;
  token: string | null;
  settledAt: Date;
};

type SettledInfo = {
  buyerUserId: string;
  subWalletId: string | null;
  amount: bigint;
};

export const vasSettlementService = {
  /**
   * Settle a completed VAS bill payment (inline `COMPLETED` from `payBill`, or the async
   * `bills.successful` webhook). Books the ONE balanced entry that finally moves the buyer's held
   * funds out of suspense: `debit suspense = amount`, `credit external = amount − commission`,
   * `credit commission = commission`. Commission is Amana's ONLY VAS revenue — there is NO ₦100
   * spend fee (decision #4). Mirrors `redemptionSettlementService.finalise`'s carve; idempotent on
   * `status === 'settled'`.
   */
  async finalise(db: DbOrTx, input: VasFinaliseInput): Promise<void> {
    const notify = await db.transaction<SettledInfo | null>(async (txx) => {
      const tx = txx as DbOrTx;
      const txn = await transactionsRepo.findById(tx, input.transactionId);
      if (!txn) throw new Error(`vas txn ${input.transactionId} not found`);
      if (txn.status === 'settled') return null; // idempotent: webhook may fire twice
      if (txn.status !== 'in_flight') {
        throw new Error(`cannot settle vas txn in status ${txn.status}`);
      }

      const vas = await vasPurchasesRepo.findByTransactionId(tx, txn.id);
      if (!vas) throw new Error(`no vas_purchase for txn ${txn.id} — inconsistent state`);

      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(
        tx,
        txn.masterWalletId,
        'suspense',
      );
      if (!suspenseLA) throw new Error('master wallet missing suspense ledger account');

      // external + commission LAs may be absent for wallets provisioned before the commission LA
      // existed — lazy-create on first use exactly as redemption settlement does (both credit-normal).
      let externalLA = await ledgerAccountsRepo.findByMasterAndKind(
        tx,
        txn.masterWalletId,
        'external',
      );
      if (!externalLA) {
        externalLA = await ledgerAccountsRepo.insert(tx, {
          masterWalletId: txn.masterWalletId,
          kind: 'external',
          normalSide: 'credit',
        });
      }
      let commissionLA = await ledgerAccountsRepo.findByMasterAndKind(
        tx,
        txn.masterWalletId,
        'commission',
      );
      if (!commissionLA) {
        commissionLA = await ledgerAccountsRepo.insert(tx, {
          masterWalletId: txn.masterWalletId,
          kind: 'commission',
          normalSide: 'credit',
        });
      }

      const amount = txn.amountKobo as bigint;
      // Clamp commission to [0, amount] — a hostile/garbled Anchor value can never invert the carve.
      let commission = input.commissionKobo;
      if (commission < 0n) commission = 0n;
      if (commission > amount) commission = amount;
      const external = amount - commission;
      // Guard the carve invariant explicitly (don't lean solely on writeDoubleEntry's balance check).
      if (amount !== external + commission) {
        throw new Error(
          `vas carve invalid: amount=${amount} external=${external} commission=${commission}`,
        );
      }

      // Drain the full hold from suspense; credit the biller payout (net) and Amana's commission.
      // Omit a leg whose amount is zero — the `postings` CHECK requires exactly one side non-zero.
      // `amount > 0` (a reserve never books 0) guarantees at least one credit leg remains, so the
      // entry keeps ≥2 legs and stays balanced.
      const legs = [
        { ledgerAccountId: suspenseLA.id, debitKobo: kobo(amount), creditKobo: kobo(0n) },
      ];
      if (external > 0n) {
        legs.push({
          ledgerAccountId: externalLA.id,
          debitKobo: kobo(0n),
          creditKobo: kobo(external),
        });
      }
      if (commission > 0n) {
        legs.push({
          ledgerAccountId: commissionLA.id,
          debitKobo: kobo(0n),
          creditKobo: kobo(commission),
        });
      }
      await ledgerService.writeDoubleEntry(tx, txn.id, legs);

      await transactionsRepo.setStatus(tx, txn.id, 'settled', input.settledAt);
      await vasPurchasesRepo.setResult(tx, vas.id, {
        status: 'successful',
        commissionKobo: commission,
        token: input.token,
        completedAt: input.settledAt,
      });

      await auditRepo.append(
        tx,
        auditEvents.vasPurchaseSettled({
          vasPurchaseId: vas.id,
          transactionId: txn.id,
          category: vas.category,
          commissionKobo: commission,
          settledAt: input.settledAt,
        }),
      );

      return { buyerUserId: vas.buyerUserId, subWalletId: txn.subWalletId, amount };
    });

    if (!notify) return; // idempotent no-op — nothing to notify.

    // Best-effort buyer notification — reuses the existing `txn_settled` kind; never fails the settle.
    try {
      await notificationService.dispatch(db, {
        kind: 'txn_settled',
        recipientUserId: notify.buyerUserId,
        dedupeKey: `vas-settled:${input.transactionId}`,
        amountKobo: kobo(notify.amount),
        subWalletId: notify.subWalletId ?? undefined,
        payload: {
          transactionId: input.transactionId,
          subWalletId: notify.subWalletId ?? null,
          amountKobo: kobo(notify.amount),
          vendorResolvedName: 'VAS',
          nibssSessionId: null,
        },
      });
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'vas_settled notification failed (non-fatal)');
    }
  },
};
