import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { notificationService } from '../notifications/notification.service';
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
      if (input.reason) {
        await transactionsRepo.setErrorMessage(txDb, txn.id, input.reason);
      }

      await auditRepo.append(
        txDb,
        auditEvents.txnFailedReversed({
          transactionId: txn.id,
          reversalTransactionId: reversalTxn.id,
          reason: input.reason,
          failedAt: input.failedAt,
        }),
      );

      // Dispatch txn_failed notifications — best-effort; never fails the reversal.
      try {
        // Always resolve principal from master_wallet → household.
        const principalRows = await txDb.execute<{ principal_user_id: string }>(sql`
          SELECT h.principal_user_id
          FROM master_wallets mw
          INNER JOIN households h ON h.id = mw.household_id
          WHERE mw.id = ${txn.masterWalletId}
          LIMIT 1
        `);
        const principalUserId = principalRows[0]?.principal_user_id ?? null;

        // Resolve agent from sub_wallet if agent-initiated.
        let agentUserId: string | null = null;
        if (txn.subWalletId) {
          const agentRows = await txDb.execute<{ agent_user_id: string }>(sql`
            SELECT agent_user_id FROM sub_wallets WHERE id = ${txn.subWalletId} LIMIT 1
          `);
          agentUserId = agentRows[0]?.agent_user_id ?? null;
        }

        const notifPayload = {
          transactionId: txn.id,
          subWalletId: txn.subWalletId ?? null,
          amountKobo: kobo(txn.amountKobo as bigint),
          vendorResolvedName: txn.vendorResolvedName ?? 'Unknown',
          reason: input.reason,
        };
        const dedupeKey = `txn-failed:${txn.id}`;
        const amountKobo = kobo(txn.amountKobo as bigint);

        if (principalUserId) {
          await notificationService.dispatch(txDb, {
            kind: 'txn_failed',
            recipientUserId: principalUserId,
            dedupeKey,
            amountKobo,
            subWalletId: txn.subWalletId ?? undefined,
            payload: notifPayload,
          });
        }
        if (agentUserId && agentUserId !== principalUserId) {
          await notificationService.dispatch(txDb, {
            kind: 'txn_failed',
            recipientUserId: agentUserId,
            dedupeKey,
            amountKobo,
            subWalletId: txn.subWalletId ?? undefined,
            payload: notifPayload,
          });
        }
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'txn_failed notification failed');
      }
    });
  },
};
