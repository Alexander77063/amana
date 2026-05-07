import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { type Result, err, ok } from '../../lib/result';
import { notificationService } from '../notifications/notification.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { type BumpRequestRow, bumpRequestsRepo } from './bump-requests.repo';
import { type OneShotTokenRow, oneShotTokensRepo } from './one-shot-tokens.repo';
import { type BumpEvent, transition } from './state-machine';

type DbOrTx = PostgresJsDatabase;

const DEFAULT_TTL_MINUTES = 30;

/** Resolve the principal user_id and agent display name from a sub-wallet id. */
async function resolvePrincipalAndAgent(
  db: DbOrTx,
  subWalletId: string,
): Promise<{ principalUserId: string; agentDisplayName: string } | null> {
  const rows = await db.execute<{
    principal_user_id: string;
    agent_display_name: string;
  }>(sql`
    SELECT h.principal_user_id, sw.name AS agent_display_name
    FROM sub_wallets sw
    INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
    INNER JOIN households h ON h.id = mw.household_id
    WHERE sw.id = ${subWalletId}
    LIMIT 1
  `);
  if (!rows[0]) return null;
  return {
    principalUserId: rows[0].principal_user_id,
    agentDisplayName: rows[0].agent_display_name,
  };
}

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
  async create(db: DbOrTx, input: CreateInput): Promise<CreateOutput> {
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

    // Dispatch bump_requested notification to the principal — best-effort (never fails bump creation).
    try {
      const resolved = await resolvePrincipalAndAgent(db, input.subWalletId);
      if (resolved) {
        await notificationService.dispatch(db, {
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
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'bump_requested notification failed');
    }

    return result;
  },

  async decide(db: DbOrTx, input: DecideInput): Promise<Result<DecideOutput, DecideError>> {
    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const current = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!current) return err({ code: 'BUMP_NOT_FOUND' as const });
      if (current.expiresAt < input.now) {
        return err({ code: 'BUMP_EXPIRED' as const });
      }
      const event: BumpEvent = { kind: input.decision };
      const next = transition(current.status as 'pending', event);
      if (next.kind === 'err') {
        return err({ code: 'INVALID_TRANSITION' as const });
      }
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
      try {
        await notificationService.dispatch(db, {
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
        });
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'bump_decided notification failed');
      }
    }

    return result;
  },

  async sweepExpired(db: DbOrTx, now: Date): Promise<{ expiredCount: number }> {
    const expired = await bumpRequestsRepo.listExpired(db, now);
    if (expired.length === 0) return { expiredCount: 0 };
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      for (const row of expired) {
        const next = transition(row.status as 'pending', { kind: 'expire' });
        if (next.kind === 'ok') {
          // Schema requires decidedByUserId to be a real user; reuse requestedByUserId
          // (semantically: "auto-decided on agent's behalf by the system")
          await bumpRequestsRepo.setDecision(txDb, row.id, next.value, row.requestedByUserId, now);
        }
      }
      return { expiredCount: expired.length };
    });
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
