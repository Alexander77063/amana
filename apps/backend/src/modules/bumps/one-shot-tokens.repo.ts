import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { oneShotTokens } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type OneShotTokenRow = typeof oneShotTokens.$inferSelect;

export const oneShotTokensRepo = {
  async insert(
    db: DbOrTx,
    input: { token: string; bumpRequestId: string; expiresAt: Date },
  ): Promise<OneShotTokenRow> {
    const [row] = await db.insert(oneShotTokens).values(input).returning();
    if (!row) throw new Error('oneShotTokens.insert returned no row');
    return row;
  },

  async findUnconsumed(db: DbOrTx, token: string): Promise<OneShotTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(oneShotTokens)
      .where(and(eq(oneShotTokens.token, token), isNull(oneShotTokens.consumedAt)))
      .limit(1);
    return row;
  },

  /** Atomic consume: only succeeds (returns the row) if not yet consumed. */
  async tryConsume(db: DbOrTx, token: string, now: Date): Promise<OneShotTokenRow | undefined> {
    const [row] = await db
      .update(oneShotTokens)
      .set({ consumedAt: now })
      .where(and(eq(oneShotTokens.token, token), isNull(oneShotTokens.consumedAt)))
      .returning();
    return row;
  },
};
