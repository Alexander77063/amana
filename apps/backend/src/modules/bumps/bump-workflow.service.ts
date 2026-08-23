import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { runInBackground } from '../../lib/background';
import type { Kobo } from '../../lib/kobo';
import { ForbiddenError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { type Result, err, ok } from '../../lib/result';
import { notificationService } from '../notifications/notification.service';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { transactionsRepo } from '../wallet/transactions.repo';
import { householdPrincipalForSubWallet } from '../wallet/wallet-access.service';
import { type BumpRequestRow, bumpRequestsRepo } from './bump-requests.repo';
import { type OneShotTokenRow, oneShotTokensRepo } from './one-shot-tokens.repo';
import { type BumpEvent, transition } from './state-machine';

type DbOrTx = PostgresJsDatabase;

const DEFAULT_TTL_MINUTES = 30;

export type CreateInput = {
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: Kobo;
  vendorResolvedName: string;
  agentNote?: string | null;
  now: Date;
  ttlMinutes?: number;
};

export type CreateOutput = {
  bumpRequest: BumpRequestRow;
};

export type DecideInput = {
  bumpRequestId: string;
  decidedByUserId: string;
  decision: 'approve_once' | 'approve_raise_limit' | 'deny';
  now: Date;
};

export type DecideError =
  | { code: 'BUMP_NOT_FOUND' }
  | { code: 'BUMP_EXPIRED' }
  | { code: 'INVALID_TRANSITION' };

export type DecideOutput = {
  bumpRequest: BumpRequestRow;
  oneShotToken: OneShotTokenRow | null;
};

export const bumpWorkflowService = {
  // notifDb: pass the outer connection pool when create() is called from inside a
  // transaction (txDb expires on commit). Falls back to db when called directly.
  async create(db: DbOrTx, input: CreateInput, notifDb?: DbOrTx): Promise<CreateOutput> {
    const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const expiresAt = new Date(input.now.getTime() + ttl * 60_000);
    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const bumpRequest = await bumpRequestsRepo.insert(txDb, {
        transactionId: input.transactionId,
        subWalletId: input.subWalletId,
        requestedByUserId: input.requestedByUserId,
        amountKobo: input.amountKobo,
        vendorResolvedName: input.vendorResolvedName,
        agentNote: input.agentNote ?? null,
        expiresAt,
      });
      await transactionsRepo.setStatus(txDb, input.transactionId, 'bump_pending');
      await txDb
        .update(transactions)
        .set({ bumpRequestId: bumpRequest.id })
        .where(eq(transactions.id, input.transactionId));
      return { bumpRequest };
    });

    // Dispatch notification best-effort — never blocks bump creation.
    const dispatchDb = notifDb ?? db;
    runInBackground(
      subWalletsRepo
        .findPrincipalAndAgent(dispatchDb, input.subWalletId)
        .then(async (resolved) => {
          if (!resolved) return;
          await notificationService.dispatch(dispatchDb, {
            kind: 'bump_requested',
            recipientUserId: resolved.principalUserId,
            dedupeKey: `bump:${result.bumpRequest.id}`,
            amountKobo: input.amountKobo,
            subWalletId: input.subWalletId,
            payload: {
              bumpRequestId: result.bumpRequest.id,
              transactionId: input.transactionId,
              amountKobo: input.amountKobo,
              vendorResolvedName: input.vendorResolvedName,
              agentDisplayName: resolved.agentDisplayName,
            },
          });
        })
        .catch((e: unknown) =>
          logger.error({ err: (e as Error).message }, 'bump_requested notification failed'),
        ),
    );

    return result;
  },

  async decide(db: DbOrTx, input: DecideInput): Promise<Result<DecideOutput, DecideError>> {
    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const current = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!current) return err({ code: 'BUMP_NOT_FOUND' as const });
      // Only the principal of the bump's own household may decide it. Treat a
      // foreign bump as not-found to avoid leaking its existence.
      const principalUserId = await householdPrincipalForSubWallet(txDb, current.subWalletId);
      if (principalUserId !== input.decidedByUserId) {
        return err({ code: 'BUMP_NOT_FOUND' as const });
      }
      if (current.expiresAt < input.now) return err({ code: 'BUMP_EXPIRED' as const });
      const event: BumpEvent = { kind: input.decision };
      const next = transition(current.status as 'pending', event);
      if (next.kind === 'err') return err({ code: 'INVALID_TRANSITION' as const });
      await bumpRequestsRepo.setDecision(
        txDb,
        input.bumpRequestId,
        next.value,
        input.decidedByUserId,
        input.now,
      );
      const updated = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!updated) throw new Error('bump disappeared after decision');

      let oneShotToken: OneShotTokenRow | null = null;
      if (next.value === 'approved_once' || next.value === 'raise_limit') {
        const token = randomBytes(24).toString('hex');
        oneShotToken = await oneShotTokensRepo.insert(txDb, {
          token,
          bumpRequestId: input.bumpRequestId,
          expiresAt: new Date(input.now.getTime() + 10 * 60_000),
        });
      }
      return ok({ bumpRequest: updated, oneShotToken });
    });

    if (result.kind === 'ok') {
      runInBackground(
        notificationService
          .dispatch(db, {
            kind: 'bump_decided',
            recipientUserId: result.value.bumpRequest.requestedByUserId,
            dedupeKey: `bump-decided:${result.value.bumpRequest.id}`,
            amountKobo: result.value.bumpRequest.amountKobo,
            subWalletId: result.value.bumpRequest.subWalletId,
            payload: {
              bumpRequestId: result.value.bumpRequest.id,
              transactionId: result.value.bumpRequest.transactionId,
              amountKobo: result.value.bumpRequest.amountKobo,
              vendorResolvedName: result.value.bumpRequest.vendorResolvedName,
              decision: input.decision,
            },
          })
          .catch((e: unknown) =>
            logger.error({ err: (e as Error).message }, 'bump_decided notification failed'),
          ),
      );
    }

    return result;
  },

  async sweepExpired(db: DbOrTx, now: Date): Promise<{ expiredCount: number }> {
    const expired = await bumpRequestsRepo.listExpired(db, now);
    if (expired.length === 0) return { expiredCount: 0 };
    await bumpRequestsRepo.bulkExpire(
      db,
      expired.map((r) => r.id),
      now,
    );
    return { expiredCount: expired.length };
  },

  async cancelByAgent(db: DbOrTx, transactionId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await bumpRequestsRepo.cancelByTransactionId(txDb, transactionId);
      await transactionsRepo.setStatus(txDb, transactionId, 'failed');
      await txDb
        .update(transactions)
        .set({ errorMessage: 'CANCELLED_BY_AGENT' })
        .where(eq(transactions.id, transactionId));
    });
  },

  /**
   * What happened to the bump on this transaction, for the agent waiting on it — and, once
   * the principal has approved, the one-shot token that lets them continue.
   *
   * This exists because the token had no route to the device that needs it. It is minted
   * inside `decide()` and returned only in the *principal's* HTTP response, and the
   * `bump_decided` push deliberately omits it — a capability in a push payload would sit in
   * third-party infrastructure and on a lock screen. So the agent pulls it over their own
   * authenticated connection instead.
   *
   * Deliberately agent-only. The principal already receives the token from `decide()`; the
   * device that resumes the payment is the one that should be able to fetch it here.
   */
  async statusForAgent(
    db: DbOrTx,
    input: { transactionId: string; agentUserId: string },
  ): Promise<{
    status: BumpRequestRow['status'];
    expiresAt: string;
    resumeToken: string | null;
  } | null> {
    const bump = await bumpRequestsRepo.findLatestByTransactionId(db, input.transactionId);
    if (!bump) return null;

    // Authorization is by ownership, never by the JWT role claim: the caller must be the
    // agent this sub-wallet belongs to. `assertSubWalletAccess` would also admit the
    // household principal, which is not who this endpoint is for.
    const sw = await subWalletsRepo.findById(db, bump.subWalletId);
    if (!sw || sw.agentUserId !== input.agentUserId) throw new ForbiddenError();

    const approved = bump.status === 'approved_once' || bump.status === 'raise_limit';
    const token = approved ? await oneShotTokensRepo.findUnconsumedForBump(db, bump.id) : undefined;

    return {
      status: bump.status,
      expiresAt: bump.expiresAt.toISOString(),
      resumeToken: token?.token ?? null,
    };
  },

  async consumeToken(db: DbOrTx, token: string, now: Date): Promise<BumpRequestRow | null> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const consumed = await oneShotTokensRepo.tryConsume(txDb, token, now);
      if (!consumed) return null;
      if (consumed.expiresAt < now) return null;
      return (await bumpRequestsRepo.findById(txDb, consumed.bumpRequestId)) ?? null;
    });
  },
};
