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
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

const SPENT_LAST_24H_SECONDS = 24 * 60 * 60;
const SPENT_LAST_30D_SECONDS = 30 * 24 * 60 * 60;

export type EvaluateInput = {
  transactionId: string;
  initiatingUserId: string;
  now: Date;
};

export type EvaluateOutput =
  | { kind: 'allow'; transaction: TransactionRow }
  | { kind: 'bump_pending'; transaction: TransactionRow; bumpRequestId: string };

export const lifecycleService = {
  async evaluate(db: DbOrTx, input: EvaluateInput): Promise<EvaluateOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    if (txn.status !== 'draft') {
      throw new Error(`transaction not in draft: status=${txn.status}`);
    }

    // Principal direct spend: no sub-wallet means no rule evaluation needed.
    if (txn.subWalletId === null) {
      await transactionsRepo.setStatus(db, txn.id, 'in_flight');
      const updated = await transactionsRepo.findById(db, txn.id);
      if (!updated) throw new Error('transaction disappeared after status update');
      return { kind: 'allow', transaction: updated };
    }

    // subWalletId is non-null: the null branch returned early above
    const subWalletId = txn.subWalletId;

    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;

      await transactionsRepo.setStatus(txDb, txn.id, 'rule_eval');

      const intent: TxnIntent = {
        amountKobo: kobo(txn.amountKobo as bigint),
        category: txn.category,
        vendorBankCode: txn.vendorBankCode,
        vendorAccountNumber: txn.vendorAccount,
        vendorResolvedName: txn.vendorResolvedName,
        confirmedAt: input.now,
      };

      const subLA = await ledgerAccountsRepo.findBySubWallet(txDb, subWalletId);
      if (!subLA) throw new Error('sub_wallet has no ledger account — should not happen');
      const subBalance = await postingsRepo.accountBalance(txDb, subLA.id);
      const spent24 = await postingsRepo.sumDebitsInWindow(
        txDb,
        subWalletId,
        SPENT_LAST_24H_SECONDS,
        input.now,
      );
      const spent30d = await postingsRepo.sumDebitsInWindow(
        txDb,
        subWalletId,
        SPENT_LAST_30D_SECONDS,
        input.now,
      );
      const history = await loadHistoryForSubWallet(txDb, subWalletId, input.now);
      const anomaly = anomalyService.score(intent, history);

      await transactionsRepo.setAnomalyScore(txDb, txn.id, anomaly.score);
      await auditRepo.append(
        txDb,
        auditEvents.anomalyScored({
          transactionId: txn.id,
          score: anomaly.score,
          features: anomaly.features,
        }),
      );

      const ruleSet = await fetchActiveRuleSet(txDb, subWalletId);
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
        txDb,
        auditEvents.txnRuleEval({
          transactionId: txn.id,
          actorUserId: input.initiatingUserId,
          ruleSetId: ruleSet?.id ?? '00000000-0000-0000-0000-000000000000',
          ruleSetVersion: ruleSet?.version ?? 0,
          decision,
        }),
      );

      if (decision.kind === 'allow') {
        await transactionsRepo.setStatus(txDb, txn.id, 'in_flight');
        const updated = await transactionsRepo.findById(txDb, txn.id);
        if (!updated) throw new Error('transaction disappeared after status update');
        return { kind: 'allow' as const, transaction: updated };
      }

      const bump = await bumpWorkflowService.create(txDb, {
        transactionId: txn.id,
        subWalletId,
        requestedByUserId: input.initiatingUserId,
        amountKobo: intent.amountKobo,
        vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
        now: input.now,
      });
      await auditRepo.append(
        txDb,
        auditEvents.bumpRequested({
          bumpRequestId: bump.bumpRequest.id,
          transactionId: txn.id,
          actorUserId: input.initiatingUserId,
          amountKobo: intent.amountKobo,
          vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
        }),
      );
      const updated = await transactionsRepo.findById(txDb, txn.id);
      if (!updated) throw new Error('transaction disappeared after status update');
      return {
        kind: 'bump_pending' as const,
        transaction: updated,
        bumpRequestId: bump.bumpRequest.id,
      };
    });

    // Soft anomaly alert — dispatched best-effort outside the transaction so it never blocks.
    if (result.kind === 'allow' || result.kind === 'bump_pending') {
      const score = result.transaction.anomalyScore as number | null;
      if (score !== null && score >= 0.85) {
        subWalletsRepo
          .findPrincipalAndAgent(db, subWalletId)
          .then(async (resolved) => {
            if (!resolved) return;
            await notificationService.dispatch(db, {
              kind: 'anomaly_alert',
              recipientUserId: resolved.principalUserId,
              dedupeKey: `anomaly:${txn.id}`,
              anomalyScore: score,
              subWalletId,
              payload: {
                transactionId: txn.id,
                subWalletId,
                amountKobo: txn.amountKobo as bigint,
                vendorResolvedName: txn.vendorResolvedName ?? 'Unknown',
                anomalyScore: score,
              },
            });
          })
          .catch((e: unknown) =>
            logger.error({ err: (e as Error).message }, 'anomaly_alert notification failed'),
          );
      }
    }

    return result;
  },

  async resumeAfterBump(db: DbOrTx, input: { token: string; now: Date }): Promise<EvaluateOutput> {
    const bump = await bumpWorkflowService.consumeToken(db, input.token, input.now);
    if (!bump) throw new Error('invalid or already-consumed token');
    if (bump.status !== 'approved_once' && bump.status !== 'raise_limit') {
      throw new Error(`bump not approved: status=${bump.status}`);
    }
    await transactionsRepo.setStatus(db, bump.transactionId, 'in_flight');
    const updated = await transactionsRepo.findById(db, bump.transactionId);
    if (!updated) throw new Error('transaction disappeared after status update');
    return { kind: 'allow', transaction: updated };
  },
};
