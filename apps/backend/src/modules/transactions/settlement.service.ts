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

export const NIP_FEE_KOBO = 2500n; // ₦25 per outbound NIP, Decision #10

export type FinaliseInput = {
  transactionId: string;
  nibssSessionId: string | null;
  settledAt: Date;
};

export const settlementService = {
  async finalise(db: DbOrTx, input: FinaliseInput): Promise<void> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const txn = await transactionsRepo.findById(txDb, input.transactionId);
      if (!txn) throw new Error(`transaction ${input.transactionId} not found`);
      if (txn.status === 'settled') return; // idempotent: webhook may fire twice
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
        amountKobo: kobo(NIP_FEE_KOBO),
        idempotencyKey: `${txn.id}-fee`,
      });
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        txn.masterWalletId,
        'master',
      );
      if (!masterLA) throw new Error('master LA missing');
      await ledgerService.writeDoubleEntry(txDb, feeTxn.id, [
        { ledgerAccountId: masterLA.id, debitKobo: kobo(0n), creditKobo: kobo(NIP_FEE_KOBO) },
        { ledgerAccountId: feeLA.id, debitKobo: kobo(NIP_FEE_KOBO), creditKobo: kobo(0n) },
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
          feeKobo: NIP_FEE_KOBO,
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
            payload: notifPayload,
          });
        }
        if (agentUserId && agentUserId !== principalUserId) {
          await notificationService.dispatch(txDb, {
            kind: 'txn_settled',
            recipientUserId: agentUserId,
            dedupeKey,
            amountKobo,
            payload: notifPayload,
          });
        }
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'txn_settled notification failed');
      }
    });
  },
};
