import { and, desc, eq, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { type Kobo, kobo } from '../../lib/kobo';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { notificationService } from '../notifications/notification.service';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type MatchInput = {
  masterWalletId: string;
  amountKobo: Kobo;
  senderBankCode: string;
  senderAccountNumber: string;
};

export type HandleRefundInput = MatchInput & {
  nibssSessionId: string;
  receivedAt: Date;
};

export type HandleRefundResult =
  | { kind: 'matched_and_refunded'; refundTransactionId: string; originalTransactionId: string }
  | { kind: 'no_match' };

const MATCH_WINDOW_DAYS = 14;

export const refundService = {
  async findOriginatingSpend(db: DbOrTx, input: MatchInput): Promise<string | null> {
    const cutoff = new Date(Date.now() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.masterWalletId, input.masterWalletId),
          eq(transactions.kind, 'spend'),
          eq(transactions.status, 'settled'),
          eq(transactions.vendorBankCode, input.senderBankCode),
          eq(transactions.vendorAccount, input.senderAccountNumber),
          eq(transactions.amountKobo, input.amountKobo),
          gte(transactions.createdAt, cutoff),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(1);
    return row?.id ?? null;
  },

  async handleRefund(db: DbOrTx, input: HandleRefundInput): Promise<HandleRefundResult> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const originalId = await refundService.findOriginatingSpend(txDb, input);
      if (!originalId) return { kind: 'no_match' as const };

      const original = await transactionsRepo.findById(txDb, originalId);
      if (!original) return { kind: 'no_match' as const };

      const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        input.masterWalletId,
        'external',
      );
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(
        txDb,
        input.masterWalletId,
        'master',
      );
      if (!externalLA || !masterLA) throw new Error('refund: missing external/master LA');
      const sourceLA = original.subWalletId
        ? await ledgerAccountsRepo.findBySubWallet(txDb, original.subWalletId)
        : masterLA;
      if (!sourceLA) throw new Error('refund: source LA not found');

      const refundTxn = await transactionsRepo.insert(txDb, {
        masterWalletId: input.masterWalletId,
        subWalletId: original.subWalletId,
        kind: 'refund',
        amountKobo: input.amountKobo,
        idempotencyKey: `refund:${input.nibssSessionId}`,
      });
      await ledgerService.writeDoubleEntry(txDb, refundTxn.id, [
        { ledgerAccountId: externalLA.id, debitKobo: input.amountKobo, creditKobo: kobo(0n) },
        { ledgerAccountId: sourceLA.id, debitKobo: kobo(0n), creditKobo: input.amountKobo },
      ]);
      await transactionsRepo.setNibssSessionId(txDb, refundTxn.id, input.nibssSessionId);
      await transactionsRepo.setStatus(txDb, refundTxn.id, 'settled', input.receivedAt);

      await auditRepo.append(
        txDb,
        auditEvents.txnSettled({
          transactionId: refundTxn.id,
          nibssSessionId: input.nibssSessionId,
          feeKobo: 0n,
          settledAt: input.receivedAt,
        }),
      );

      try {
        let principalUserId: string | null = null;
        let agentUserId: string | null = null;
        if (original.subWalletId) {
          const rows = await txDb.execute<{ principal_user_id: string; agent_user_id: string }>(sql`
            SELECT h.principal_user_id, sw.agent_user_id
            FROM sub_wallets sw
            INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
            INNER JOIN households h ON h.id = mw.household_id
            WHERE sw.id = ${original.subWalletId}
            LIMIT 1
          `);
          const owner = rows[0];
          if (owner) {
            principalUserId = owner.principal_user_id;
            agentUserId = owner.agent_user_id;
          }
        } else {
          const rows = await txDb.execute<{ principal_user_id: string }>(sql`
            SELECT h.principal_user_id
            FROM master_wallets mw
            INNER JOIN households h ON h.id = mw.household_id
            WHERE mw.id = ${input.masterWalletId}
            LIMIT 1
          `);
          const owner = rows[0];
          if (owner) principalUserId = owner.principal_user_id;
        }

        const intentBase = {
          kind: 'refund_received' as const,
          dedupeKey: `refund:${refundTxn.id}`,
          amountKobo: input.amountKobo as bigint,
          subWalletId: original.subWalletId ?? undefined,
          payload: {
            refundTransactionId: refundTxn.id,
            originalTransactionId: originalId,
            amountKobo: input.amountKobo as bigint,
            vendorResolvedName: original.vendorResolvedName ?? 'Unknown',
          },
        };
        if (principalUserId) {
          await notificationService.dispatch(txDb, {
            ...intentBase,
            recipientUserId: principalUserId,
          });
        }
        if (agentUserId && agentUserId !== principalUserId) {
          await notificationService.dispatch(txDb, { ...intentBase, recipientUserId: agentUserId });
        }
      } catch {
        // best-effort: notification failure must not abort the refund txn
      }

      return {
        kind: 'matched_and_refunded' as const,
        refundTransactionId: refundTxn.id,
        originalTransactionId: originalId,
      };
    });
  },
};
