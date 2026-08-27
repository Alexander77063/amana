import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { runInBackground } from '../../lib/background';
import { ConflictError } from '../../lib/errors';
import { type Kobo, kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { anomalyService } from '../anomaly/anomaly.service';
import { loadHistoryForSubWallet } from '../anomaly/history.loader';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { bumpWorkflowService } from '../bumps/bump-workflow.service';
import { householdsRepo } from '../identity/households.repo';
import { notificationService } from '../notifications/notification.service';
import { evaluate } from '../rules/engine';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import type { Decision, RuleEvaluationContext, TxnIntent } from '../rules/types';
import { vendorCategoryResolver } from '../vendors/vendor-category-resolver.service';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { postingsRepo } from '../wallet/postings.repo';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';

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
  | {
      kind: 'bump_pending';
      transaction: TransactionRow;
      bumpRequestId: string;
      /** When the request lapses. The agent's wait screen counts down to this. */
      bumpExpiresAt: Date;
    };

export const lifecycleService = {
  async evaluate(db: DbOrTx, input: EvaluateInput): Promise<EvaluateOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    await assertWalletAccess(db, input.initiatingUserId, {
      masterWalletId: txn.masterWalletId,
      subWalletId: txn.subWalletId,
    });
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

    // --- Vendor registry: resolve, then decide whether it may drive the outcome. ---
    //
    // Both reads run on the pool handle, BEFORE the transaction below opens — never inside it.
    // vendorCategoryResolver.resolve already swallows its own errors, but that swallow only
    // works on its own connection: a caught Postgres error still poisons a surrounding
    // transaction (SQLSTATE 25P02), which would fail every later statement in it even though
    // this call itself returned cleanly. The realistic trigger is a stale test/dev DB missing
    // migration 0035 ("relation vendors does not exist").
    const registry = await vendorCategoryResolver.resolve(
      db,
      txn.vendorBankCode,
      txn.vendorAccount,
    );
    // Same hazard applies here — there is no registry-style built-in swallow, so match it.
    const household = await householdsRepo
      .findByMasterWalletId(db, txn.masterWalletId)
      .catch(() => undefined);
    // Three-state: an explicit household setting wins in BOTH directions; NULL inherits the
    // global default. `?? env...` and not `||` — `false` is a real answer, not a missing one.
    const householdEnforces =
      household?.vendorCategoryEnforced ?? env.VENDOR_CATEGORY_ENFORCE_DEFAULT;
    // An observed category is never enforced however strong its consensus (spec D-V7).
    const enforced = householdEnforces && registry !== null && registry.enforceable;
    const liveCategory = enforced ? (registry?.category ?? txn.category) : txn.category;

    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;

      await transactionsRepo.setStatus(txDb, txn.id, 'rule_eval');

      if (registry) {
        await transactionsRepo.setRegistryAttribution(
          txDb,
          txn.id,
          registry.vendorId,
          registry.category,
        );
      }

      const intent: TxnIntent = {
        amountKobo: kobo(txn.amountKobo as bigint),
        category: liveCategory,
        vendorBankCode: txn.vendorBankCode,
        vendorAccountNumber: txn.vendorAccount,
        vendorResolvedName: txn.vendorResolvedName,
        // A bank transfer has no retailer. A merchant rule therefore denies it — which is why a
        // merchant rule is only ever evaluated on the marketplace path, never here.
        retailerId: null,
        vendorId: registry?.vendorId ?? null,
        resolvedCategory: registry?.category ?? null,
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
      const evalCtx: RuleEvaluationContext = {
        ledger: {
          subWalletAvailableKobo: subBalance,
          spentLast24hKobo: spent24,
          spentLast30dKobo: spent30d,
        },
        anomalyScore: anomaly.score,
      };
      const decision: Decision = ruleSet ? evaluate(intent, ruleSet, evalCtx) : { kind: 'allow' };

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

      // The counterfactual. `evaluate` is a pure function over an already-loaded rule set and an
      // already-computed context, so running it a second time costs one in-memory pass and no
      // database work at all — which is what makes shadow mode affordable on the spend path.
      //
      // The branch flips with `enforced` so the same instrument keeps working after enforcement is
      // switched on: before, it reports what enforcement WOULD change; after, what it IS changing.
      //
      // `ruleSet` is in the guard because a sub-wallet with no active rule set never calls
      // `evaluate` at all — there is nothing for a category to change.
      if (
        ruleSet &&
        registry !== null &&
        registry.category !== null &&
        registry.category !== txn.category
      ) {
        const shadowIntent: TxnIntent = {
          ...intent,
          category: enforced ? txn.category : registry.category,
        };
        const shadowDecision = evaluate(shadowIntent, ruleSet, evalCtx);
        if (shadowDecision.kind !== decision.kind) {
          await auditRepo.append(
            txDb,
            auditEvents.vendorCategoryShadow({
              transactionId: txn.id,
              vendorId: registry.vendorId,
              appCategory: txn.category,
              registryCategory: registry.category,
              categorySource: registry.categorySource,
              liveDecision: decision.kind,
              shadowDecision: shadowDecision.kind,
              enforced,
            }),
          );
        }
      }

      if (decision.kind === 'allow') {
        await transactionsRepo.setStatus(txDb, txn.id, 'in_flight');
        const updated = await transactionsRepo.findById(txDb, txn.id);
        if (!updated) throw new Error('transaction disappeared after status update');
        return { kind: 'allow' as const, transaction: updated };
      }

      const bump = await bumpWorkflowService.create(
        txDb,
        {
          transactionId: txn.id,
          subWalletId,
          requestedByUserId: input.initiatingUserId,
          amountKobo: intent.amountKobo,
          vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
          now: input.now,
        },
        db, // outer pool — txDb expires on commit, so notifications need the pool
      );
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
        bumpExpiresAt: bump.bumpRequest.expiresAt,
      };
    });

    // Soft anomaly alert — dispatched best-effort outside the transaction so it never blocks.
    if (result.kind === 'allow' || result.kind === 'bump_pending') {
      const score = result.transaction.anomalyScore as number | null;
      if (score !== null && score >= 0.85) {
        runInBackground(
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
            ),
        );
      }
    }

    return result;
  },

  async resumeAfterBump(
    db: DbOrTx,
    input: { token: string; now: Date; expectedTransactionId?: string },
  ): Promise<EvaluateOutput> {
    const bump = await bumpWorkflowService.consumeToken(db, input.token, input.now);
    // One-shot by design: an expired token, or a second tap on "resume", lands here. That is a
    // client-visible conflict, not a server fault — a bare Error would surface as a 500 and page
    // us via Sentry for what is ordinary user behaviour.
    if (!bump) throw new ConflictError('invalid or already-consumed bump token');
    if (bump.status !== 'approved_once' && bump.status !== 'raise_limit') {
      throw new ConflictError(`bump not approved: status=${bump.status}`);
    }
    // The token is the capability, so the path id is not what authorizes this. Assert they agree
    // anyway: a mismatch means the caller is confused about which spend it is resuming, and
    // silently resuming a *different* transaction is the worst possible resolution.
    if (input.expectedTransactionId && input.expectedTransactionId !== bump.transactionId) {
      throw new ConflictError('bump token does not belong to this transaction');
    }
    await transactionsRepo.setStatus(db, bump.transactionId, 'in_flight');
    const updated = await transactionsRepo.findById(db, bump.transactionId);
    if (!updated) throw new Error('transaction disappeared after status update');
    return { kind: 'allow', transaction: updated };
  },
};
