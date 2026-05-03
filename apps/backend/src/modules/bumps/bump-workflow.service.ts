import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { transactionsRepo } from '../wallet/transactions.repo';
import { bumpRequestsRepo, type BumpRequestRow } from './bump-requests.repo';
import { oneShotTokensRepo, type OneShotTokenRow } from './one-shot-tokens.repo';
import { transition, type BumpEvent } from './state-machine';
import { err, ok, type Result } from '../../lib/result';
import type { Kobo } from '../../lib/kobo';

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
};
