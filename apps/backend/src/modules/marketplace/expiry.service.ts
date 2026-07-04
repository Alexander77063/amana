import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';
import { type RedemptionRow, redemptionsRepo } from './redemptions.repo';

type DbOrTx = PostgresJsDatabase;

export type CancelInput = {
  redemptionId: string;
  /** The buyer requesting the cancel; authorized against the source wallet by identity vs. ownership. */
  actorUserId: string;
  now: Date;
};

/**
 * Book the buyer refund for a NEVER-redeemed voucher: `debit suspense = discounted`,
 * `credit source = discounted` (mirrors `reversalService.reverse` — restoring the source balance).
 * The refund is a SEPARATE `reversal` txn so the reserve txn's postings stay immutable + paired.
 * Runs inside the caller's transaction; the redemption row must already be locked + rechecked.
 */
async function bookRefund(
  tx: DbOrTx,
  redemption: RedemptionRow,
  now: Date,
  idempotencyKey: string,
): Promise<void> {
  const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(
    tx,
    redemption.masterWalletId,
    'suspense',
  );
  const masterLA = await ledgerAccountsRepo.findByMasterAndKind(
    tx,
    redemption.masterWalletId,
    'master',
  );
  if (!suspenseLA || !masterLA) {
    throw new Error('master wallet missing suspense/master LAs');
  }
  const sourceLA = redemption.subWalletId
    ? await ledgerAccountsRepo.findBySubWallet(tx, redemption.subWalletId)
    : masterLA;
  if (!sourceLA) throw new Error('source ledger account missing');

  const amount = kobo(redemption.discountedKobo as bigint);

  const refundTxn = await transactionsRepo.insert(tx, {
    masterWalletId: redemption.masterWalletId,
    subWalletId: redemption.subWalletId,
    kind: 'reversal',
    amountKobo: amount,
    idempotencyKey,
  });
  // Refund legs: debit suspense, credit source — the mirror of the reserve hold.
  await ledgerService.writeDoubleEntry(tx, refundTxn.id, [
    { ledgerAccountId: suspenseLA.id, debitKobo: amount, creditKobo: kobo(0n) },
    { ledgerAccountId: sourceLA.id, debitKobo: kobo(0n), creditKobo: amount },
  ]);
  await transactionsRepo.setStatus(tx, refundTxn.id, 'settled', now);
}

export const expiryService = {
  /**
   * Auto-refund every reserved voucher whose hold has expired. Each voucher is refunded in its OWN
   * transaction (row-locked + status-rechecked, so it is idempotent and race-safe against a
   * concurrent redeem/cancel). This is the ONLY buyer-refund path besides `cancel`. Returns the
   * number of vouchers actually swept.
   */
  async sweepExpired(db: DbOrTx, now: Date): Promise<number> {
    const candidates = await redemptionsRepo.findExpiredReserved(db, now);
    let swept = 0;

    for (const candidate of candidates) {
      try {
        const didRefund = await db.transaction(async (txx) => {
          const tx = txx as DbOrTx;
          // Re-fetch under a row lock and re-check status: a concurrent redeem/cancel or a prior
          // sweep may have already moved this voucher out of `reserved` — skip if so (idempotent).
          const redemption = await redemptionsRepo.findByCodeForUpdate(tx, candidate.code);
          if (!redemption || redemption.status !== 'reserved') return false;

          await bookRefund(tx, redemption, now, `redeem-expire:${redemption.id}`);
          await redemptionsRepo.markStatus(tx, redemption.id, 'expired');

          await auditRepo.append(
            tx,
            auditEvents.marketplaceVoucherRefunded({
              redemptionId: redemption.id,
              refundedKobo: redemption.discountedKobo as bigint,
              reason: 'expired',
              refundedAt: now,
            }),
          );
          return true;
        });
        if (didRefund) swept += 1;
      } catch (e) {
        // Isolate per-voucher failures so one bad row can't abort the batch; next sweep retries.
        logger.error(
          { err: (e as Error).message, redemptionId: candidate.id },
          'voucher expiry refund failed — will retry next sweep',
        );
      }
    }

    return swept;
  },

  /**
   * Buyer-initiated cancel of a NOT-yet-redeemed voucher: refund the hold and mark it `refunded`.
   * Authorized by identity vs. ownership (`assertWalletAccess`) — never the JWT role. Row-locks the
   * voucher and rechecks `status==='reserved'` under the lock so it can never double-refund against
   * a racing expiry sweep (the two paths use different idempotency keys, so the lock is the guard).
   */
  async cancel(db: DbOrTx, input: CancelInput): Promise<void> {
    await db.transaction(async (txx) => {
      const tx = txx as DbOrTx;

      // findById only resolves the code (the lockable key); take the lock via findByCodeForUpdate.
      const initial = await redemptionsRepo.findById(tx, input.redemptionId);
      if (!initial) throw new NotFoundError(`voucher not found: ${input.redemptionId}`);
      const redemption = await redemptionsRepo.findByCodeForUpdate(tx, initial.code);
      if (!redemption) throw new NotFoundError(`voucher not found: ${input.redemptionId}`);

      // Buyer owns: sub-wallet purchase → owning agent; principal-direct → household principal.
      await assertWalletAccess(tx, input.actorUserId, {
        masterWalletId: redemption.masterWalletId,
        subWalletId: redemption.subWalletId,
      });

      if (redemption.status !== 'reserved') {
        throw new ConflictError(`cannot cancel voucher in status ${redemption.status}`);
      }

      await bookRefund(tx, redemption, input.now, `redeem-cancel:${redemption.id}`);
      await redemptionsRepo.markStatus(tx, redemption.id, 'refunded');

      await auditRepo.append(
        tx,
        auditEvents.marketplaceVoucherRefunded({
          redemptionId: redemption.id,
          refundedKobo: redemption.discountedKobo as bigint,
          reason: 'cancelled',
          refundedAt: input.now,
        }),
      );
    });
  },
};
