import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';
import { type Result, err, ok } from '../../lib/result';
import { transactionsRepo } from '../wallet/transactions.repo';
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
  async create(db: DbOrTx, input: CreateInput): Promise<CreateOutput> {
    const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const expiresAt = new Date(input.now.getTime() + ttl * 60_000);
    return db.transaction(async (tx) => {
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
  },

  async decide(db: DbOrTx, input: DecideInput): Promise<Result<DecideOutput, DecideError>> {
    return db.transaction(async (tx) => {
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
