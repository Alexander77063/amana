import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Kobo, kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { anomalyService } from '../anomaly/anomaly.service';
import { loadHistoryForSubWallet } from '../anomaly/history.loader';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { bumpWorkflowService } from '../bumps/bump-workflow.service';
import { notificationService } from '../notifications/notification.service';
import { evaluate } from '../rules/engine';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import type { Decision, TxnIntent } from '../rules/types';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { postingsRepo } from '../wallet/postings.repo';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

export type EvaluateInput = {
  transactionId: string;
  initiatingUserId: string;
  now: Date;
};

export type EvaluateOutput =
  | { kind: 'allow'; transaction: TransactionRow }
  | { kind: 'bump_pending'; transaction: TransactionRow; bumpRequestId: string };

const SPENT_LAST_24H_SECONDS = 24 * 60 * 60;
const SPENT_LAST_30D_SECONDS = 30 * 24 * 60 * 60;

async function spentInWindow(
  db: DbOrTx,
  subWalletId: string,
  windowSeconds: number,
  now: Date,
): Promise<Kobo> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const cutoffIso = cutoff.toISOString();
  const result = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(p.debit_kobo), 0)::text AS s
    FROM postings p
    INNER JOIN ledger_accounts la ON la.id = p.ledger_account_id
    INNER JOIN transactions t ON t.id = p.transaction_id
    WHERE la.sub_wallet_id = ${subWalletId}
      AND la.kind = 'sub'
      AND t.status = 'settled'
      AND t.kind = 'spend'
      AND t.settled_at >= ${cutoffIso}::timestamptz
  `);
  return kobo(BigInt(result[0]?.s ?? '0'));
}

export const lifecycleService = {
  async evaluate(db: DbOrTx, input: EvaluateInput): Promise<EvaluateOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    if (txn.status !== 'draft') {
      throw new Error(`transaction not in draft: status=${txn.status}`);
    }
    if (txn.subWalletId === null) {
      // Principal direct spend (Decision #17): skip rule_eval.
      await transactionsRepo.setStatus(db, txn.id, 'in_flight');
      const updated = (await transactionsRepo.findById(db, txn.id))!;
      return { kind: 'allow', transaction: updated };
    }

    await transactionsRepo.setStatus(db, txn.id, 'rule_eval');

    const intent: TxnIntent = {
      amountKobo: kobo(txn.amountKobo as bigint),
      category: txn.category,
      vendorBankCode: txn.vendorBankCode,
      vendorAccountNumber: txn.vendorAccount,
      vendorResolvedName: txn.vendorResolvedName,
      confirmedAt: input.now,
    };

    const subLA = await ledgerAccountsRepo.findBySubWallet(db, txn.subWalletId);
    if (!subLA) throw new Error('sub_wallet has no ledger account — should not happen');
    const subBalance = await postingsRepo.accountBalance(db, subLA.id);
    const spent24 = await spentInWindow(db, txn.subWalletId, SPENT_LAST_24H_SECONDS, input.now);
    const spent30d = await spentInWindow(db, txn.subWalletId, SPENT_LAST_30D_SECONDS, input.now);
    const history = await loadHistoryForSubWallet(db, txn.subWalletId, input.now);
    const anomaly = anomalyService.score(intent, history);

    await db.execute(
      sql`UPDATE transactions SET anomaly_score = ${anomaly.score} WHERE id = ${txn.id}`,
    );
    await auditRepo.append(
      db,
      auditEvents.anomalyScored({
        transactionId: txn.id,
        score: anomaly.score,
        features: anomaly.features,
      }),
    );

    // Soft anomaly alert — dispatched best-effort, never blocks the txn.
    if (anomaly.score >= 0.85) {
      try {
        let principalUserId: string | null = null;
        if (txn.subWalletId) {
          const owner = await db.execute<{ principal_user_id: string }>(sql`
            SELECT h.principal_user_id
            FROM sub_wallets sw
            INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
            INNER JOIN households h ON h.id = mw.household_id
            WHERE sw.id = ${txn.subWalletId}
            LIMIT 1
          `);
          if (owner[0]) principalUserId = owner[0].principal_user_id;
        }
        if (principalUserId) {
          await notificationService.dispatch(db, {
            kind: 'anomaly_alert',
            recipientUserId: principalUserId,
            dedupeKey: `anomaly:${txn.id}`,
            anomalyScore: anomaly.score,
            subWalletId: txn.subWalletId ?? undefined,
            payload: {
              transactionId: txn.id,
              amountKobo: kobo(txn.amountKobo as bigint),
              vendorResolvedName: txn.vendorResolvedName ?? 'Unknown',
              anomalyScore: anomaly.score,
            },
          });
        }
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'anomaly_alert notification failed');
      }
    }

    const ruleSet = await fetchActiveRuleSet(db, txn.subWalletId);
    const decision: Decision = ruleSet
      ? evaluate(intent, ruleSet, {
          ledger: {
            subWalletAvailableKobo: subBalance,
            spentLast24hKobo: spent24,
            spentLast30dKobo: spent30d,
          },
          anomalyScore: anomaly.score,
        })
      : { kind: 'allow' };

    await auditRepo.append(
      db,
      auditEvents.txnRuleEval({
        transactionId: txn.id,
        actorUserId: input.initiatingUserId,
        ruleSetId: ruleSet?.id ?? '00000000-0000-0000-0000-000000000000',
        ruleSetVersion: ruleSet?.version ?? 0,
        decision,
      }),
    );

    if (decision.kind === 'allow') {
      await transactionsRepo.setStatus(db, txn.id, 'in_flight');
      const updated = (await transactionsRepo.findById(db, txn.id))!;
      return { kind: 'allow', transaction: updated };
    }

    const bump = await bumpWorkflowService.create(db, {
      transactionId: txn.id,
      subWalletId: txn.subWalletId,
      requestedByUserId: input.initiatingUserId,
      amountKobo: intent.amountKobo,
      vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
      now: input.now,
    });
    await auditRepo.append(
      db,
      auditEvents.bumpRequested({
        bumpRequestId: bump.bumpRequest.id,
        transactionId: txn.id,
        actorUserId: input.initiatingUserId,
        amountKobo: intent.amountKobo,
        vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
      }),
    );
    const updated = (await transactionsRepo.findById(db, txn.id))!;
    return { kind: 'bump_pending', transaction: updated, bumpRequestId: bump.bumpRequest.id };
  },

  async resumeAfterBump(db: DbOrTx, input: { token: string; now: Date }): Promise<EvaluateOutput> {
    const bump = await bumpWorkflowService.consumeToken(db, input.token, input.now);
    if (!bump) throw new Error('invalid or already-consumed token');
    if (bump.status !== 'approved_once' && bump.status !== 'raise_limit') {
      throw new Error(`bump not approved: status=${bump.status}`);
    }
    await transactionsRepo.setStatus(db, bump.transactionId, 'in_flight');
    const updated = (await transactionsRepo.findById(db, bump.transactionId))!;
    return { kind: 'allow', transaction: updated };
  },
};
