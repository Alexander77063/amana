import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type ReverseInput = {
  transactionId: string;
  /** Optional human-readable reason from Anchor; surfaced in the audit log. */
  reason: string | null;
  failedAt: Date;
};

export const reversalService = {
  async reverse(db: DbOrTx, input: ReverseInput): Promise<void> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const txn = await transactionsRepo.findById(txDb, input.transactionId);
      if (!txn) throw new Error(`transaction ${input.transactionId} not found`);
      if (txn.status === 'failed') return; // idempotent
      if (txn.status !== 'in_flight') {
        throw new Error(`cannot reverse txn in status ${txn.status}`);
      }

      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        txn.masterWalletId,
        'suspense',
      );
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        txn.masterWalletId,
        'master',
      );
      if (!suspenseLA || !masterLA) {
        throw new Error('master wallet missing suspense/master LAs');
      }
      const sourceLA = txn.subWalletId
        ? await ledgerAccountsRepo.findBySubWallet(txDb, txn.subWalletId)
        : masterLA;
      if (!sourceLA) throw new Error('source ledger account missing');

      // Mirror the reservation: debit suspense, credit source — restoring the source balance.
      const amount = kobo(txn.amountKobo as bigint);

      // Use a SEPARATE reversal transaction to keep the original txn's postings immutable + paired.
      const reversalTxn = await transactionsRepo.insert(txDb, {
        masterWalletId: txn.masterWalletId,
        subWalletId: txn.subWalletId,
        kind: 'reversal',
        amountKobo: amount,
        idempotencyKey: `${txn.id}-reverse`,
      });
      await ledgerService.writeDoubleEntry(txDb, reversalTxn.id, [
        { ledgerAccountId: suspenseLA.id, debitKobo: amount, creditKobo: kobo(0n) },
        { ledgerAccountId: sourceLA.id, debitKobo: kobo(0n), creditKobo: amount },
      ]);
      await transactionsRepo.setStatus(txDb, reversalTxn.id, 'settled', input.failedAt);

      // Mark original txn failed. IMPORTANT: setStatus only touches `status` (and optionally `settled_at`)
      // — it does NOT touch `nibss_session_id`. The session ID written by nip-out.service before
      // a 200-FAILED reversal must survive untouched for dispute reconstruction.
      await transactionsRepo.setStatus(txDb, txn.id, 'failed', input.failedAt);

      await auditRepo.append(
        txDb,
        auditEvents.txnFailedReversed({
          transactionId: txn.id,
          reversalTransactionId: reversalTxn.id,
          reason: input.reason,
          failedAt: input.failedAt,
        }),
      );
    });
  },
};
