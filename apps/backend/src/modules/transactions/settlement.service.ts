import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
// The connection POOL, not the caller's handle. `finalise` is called with an open transaction by
// routes/webhooks.ts:102, and a task that outlives the commit cannot use that transaction.
import { db as pool } from '../../db/client';
import { runInBackground } from '../../lib/background';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { notificationService } from '../notifications/notification.service';
import { vendorObservationService } from '../vendors/vendor-observation.service';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * What the committed settlement wants the registry to record. Null when the settle was a no-op
 * replay, or when the spend had no vendor account to observe.
 */
type ObservationIntent = {
  masterWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  category: string | null;
};

// ₦100 platform fee per spend — PRICING.md (confirmed 2026-06-30): ₦50 covers Anchor's NIP cost,
// ₦50 is Amana's margin. Supersedes the ₦25 MVP placeholder ("Decision #10", 2026-05-03).
export const SPEND_FEE_KOBO = 10000n;

export type FinaliseInput = {
  transactionId: string;
  nibssSessionId: string | null;
  settledAt: Date;
};

export const settlementService = {
  async finalise(db: DbOrTx, input: FinaliseInput): Promise<void> {
    const observation = await db.transaction(async (tx): Promise<ObservationIntent | null> => {
      const txDb = tx as DbOrTx;
      const txn = await transactionsRepo.findById(txDb, input.transactionId);
      if (!txn) throw new Error(`transaction ${input.transactionId} not found`);
      if (txn.status === 'settled') return null; // idempotent: webhook may fire twice
      if (txn.status !== 'in_flight') {
        throw new Error(`cannot settle txn in status ${txn.status}`);
      }

      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        txn.masterWalletId,
        'suspense',
      );
      const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        txn.masterWalletId,
        'external',
      );
      const feeLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, txn.masterWalletId, 'fee');
      if (!suspenseLA || !feeLA) {
        throw new Error('master wallet missing suspense or fee ledger account');
      }
      // External LA may not exist for masters provisioned before T19 of Sub-plan 2;
      // create on the fly if missing.
      let extLA = externalLA;
      if (!extLA) {
        extLA = await ledgerAccountsRepo.insert(txDb, {
          masterWalletId: txn.masterWalletId,
          kind: 'external',
          normalSide: 'credit',
        });
      }

      // Settle: clear the suspense (debit it), credit external (money left the building).
      const amount = kobo(txn.amountKobo as bigint);
      await ledgerService.writeDoubleEntry(txDb, txn.id, [
        { ledgerAccountId: suspenseLA.id, debitKobo: amount, creditKobo: kobo(0n) },
        { ledgerAccountId: extLA.id, debitKobo: kobo(0n), creditKobo: amount },
      ]);

      // Book the fee as a SEPARATE transaction (kind=fee, idempotency `${txn.id}-fee`).
      const feeTxn = await transactionsRepo.insert(txDb, {
        masterWalletId: txn.masterWalletId,
        subWalletId: txn.subWalletId,
        kind: 'fee',
        amountKobo: kobo(SPEND_FEE_KOBO),
        idempotencyKey: `${txn.id}-fee`,
      });
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        txn.masterWalletId,
        'master',
      );
      if (!masterLA) throw new Error('master LA missing');
      await ledgerService.writeDoubleEntry(txDb, feeTxn.id, [
        { ledgerAccountId: masterLA.id, debitKobo: kobo(0n), creditKobo: kobo(SPEND_FEE_KOBO) },
        { ledgerAccountId: feeLA.id, debitKobo: kobo(SPEND_FEE_KOBO), creditKobo: kobo(0n) },
      ]);
      await transactionsRepo.setStatus(txDb, feeTxn.id, 'settled', input.settledAt);

      // Mark the spend txn settled.
      if (input.nibssSessionId) {
        await transactionsRepo.setNibssSessionId(txDb, txn.id, input.nibssSessionId);
      }
      await transactionsRepo.setStatus(txDb, txn.id, 'settled', input.settledAt);

      await auditRepo.append(
        txDb,
        auditEvents.txnSettled({
          transactionId: txn.id,
          nibssSessionId: input.nibssSessionId,
          feeKobo: SPEND_FEE_KOBO,
          settledAt: input.settledAt,
        }),
      );

      // Dispatch txn_settled notifications — best-effort; never fails the settle.
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

        // Resolve agent from sub_wallet if this is an agent-initiated spend.
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
          nibssSessionId: input.nibssSessionId,
        };
        const dedupeKey = `txn-settled:${txn.id}`;
        const amountKobo = kobo(txn.amountKobo as bigint);

        if (principalUserId) {
          await notificationService.dispatch(txDb, {
            kind: 'txn_settled',
            recipientUserId: principalUserId,
            dedupeKey,
            amountKobo,
            subWalletId: txn.subWalletId ?? undefined,
            payload: notifPayload,
          });
        }
        if (agentUserId && agentUserId !== principalUserId) {
          await notificationService.dispatch(txDb, {
            kind: 'txn_settled',
            recipientUserId: agentUserId,
            dedupeKey,
            amountKobo,
            subWalletId: txn.subWalletId ?? undefined,
            payload: notifPayload,
          });
        }
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'txn_settled notification failed');
      }

      // The registry write itself happens AFTER this transaction commits (see below).
      return txn.vendorBankCode && txn.vendorAccount
        ? {
            masterWalletId: txn.masterWalletId,
            bankCode: txn.vendorBankCode,
            accountNumber: txn.vendorAccount,
            accountName: txn.vendorResolvedName ?? 'Unknown',
            category: txn.category,
          }
        : null;
    });

    // Deliberately AFTER the commit and detached. The registry is a best-effort observer of money
    // that has already moved: a fault here must not be able to roll back a settled payment. Note
    // that a try/catch INSIDE the transaction would not be safe — a Postgres error aborts the
    // whole transaction even when the JS error is caught, turning the COMMIT into a ROLLBACK.
    //
    // `pool`, NOT the `db` parameter: this write is detached from the caller's transaction and
    // must run on its own connection. When `finalise` is called with an already-open transaction
    // (webhooks.ts calls finalise(tx, …)), drizzle's postgres-js driver implements that nested
    // `db.transaction()` as a SAVEPOINT, so the "commit" above is a RELEASE SAVEPOINT — the outer
    // webhook transaction is still open when this background task fires, and per webhooks.ts it
    // can still roll back and be redelivered. That is accepted: an observation recorded for a
    // payment that ends up not settling is harmless (nothing reads `settled_count`, and it cannot
    // change the distinct-household promotion count), and Anchor's redelivery on rollback just
    // re-increments a counter nothing reads. This is the one call in the file that must not join
    // the caller's transaction — which is exactly why it does not take the injected handle.
    if (observation) {
      runInBackground(
        vendorObservationService
          .recordSettlement(pool, { ...observation, now: input.settledAt })
          .catch((e: unknown) => {
            logger.warn(
              { err: e instanceof Error ? e.message : String(e) },
              'vendor observation task failed',
            );
          }),
      );
    }
  },
};
