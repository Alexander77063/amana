// apps/backend/src/modules/auth/pairing.service.ts
import { randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { householdMembersRepo } from '../identity/household-members.repo';
import { pairingTokensRepo } from './pairing-tokens.repo';
import type { PairingTokenRow } from './types';

type DbOrTx = PostgresJsDatabase;

export type IssuePairingInput = {
  principalUserId: string;
  householdId: string;
  now?: Date;
};

export type ConsumePairingInput = {
  code: string;
  agentUserId: string;
  now?: Date;
};

export type ConsumePairingResult =
  | { kind: 'consumed'; pairingTokenId: string; householdId: string }
  | { kind: 'not_found' };

function generatePairingCode(): string {
  return randomBytes(16).toString('base64url');
}

export const pairingService = {
  async issue(db: DbOrTx, input: IssuePairingInput): Promise<PairingTokenRow> {
    const now = input.now ?? new Date();
    const code = generatePairingCode();
    const expiresAt = new Date(now.getTime() + env.PAIRING_TOKEN_TTL_SECONDS * 1000);
    return pairingTokensRepo.insert(db, {
      principalUserId: input.principalUserId,
      householdId: input.householdId,
      code,
      expiresAt,
    });
  },

  async consume(db: DbOrTx, input: ConsumePairingInput): Promise<ConsumePairingResult> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const token = await pairingTokensRepo.findActiveByCode(txDb, input.code, now);
      if (!token) return { kind: 'not_found' as const };
      await pairingTokensRepo.markConsumed(txDb, token.id, input.agentUserId, now);
      await householdMembersRepo.upsertActive(txDb, {
        householdId: token.householdId,
        userId: input.agentUserId,
      });
      return {
        kind: 'consumed' as const,
        pairingTokenId: token.id,
        householdId: token.householdId,
      };
    });
  },
};
