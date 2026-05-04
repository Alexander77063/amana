import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pairingTokens } from '../../db/schema';
import type { PairingTokenRow } from './types';

type DbOrTx = PostgresJsDatabase;

export type InsertPairingInput = {
  principalUserId: string;
  householdId: string;
  code: string;
  expiresAt: Date;
};

export const pairingTokensRepo = {
  async insert(db: DbOrTx, input: InsertPairingInput): Promise<PairingTokenRow> {
    const [row] = await db.insert(pairingTokens).values(input).returning();
    if (!row) throw new Error('pairingTokens.insert returned no row');
    return row;
  },

  async findActiveByCode(
    db: DbOrTx,
    code: string,
    now: Date,
  ): Promise<PairingTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(pairingTokens)
      .where(
        and(
          eq(pairingTokens.code, code),
          isNull(pairingTokens.consumedAt),
          gt(pairingTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return row;
  },

  async markConsumed(db: DbOrTx, id: string, consumedByUserId: string, now: Date): Promise<void> {
    await db
      .update(pairingTokens)
      .set({ consumedByUserId, consumedAt: now })
      .where(eq(pairingTokens.id, id));
  },
};
