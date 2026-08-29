import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminAuthRequests } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type AdminAuthRequestRow = typeof adminAuthRequests.$inferSelect;

export const adminAuthRequestsRepo = {
  async insert(
    db: DbOrTx,
    input: { stateHash: string; nonce: string; codeVerifier: string; expiresAt: Date },
  ): Promise<AdminAuthRequestRow> {
    const [row] = await db.insert(adminAuthRequests).values(input).returning();
    if (!row) throw new Error('adminAuthRequests.insert returned no row');
    return row;
  },

  /**
   * Claim a pending, unexpired request by its state digest — atomically.
   *
   * The consume IS the lookup (a conditional UPDATE ... RETURNING), not a read followed by a
   * write. Two callbacks arriving with the same `state` — a double-clicked redirect, or a replay
   * of a leaked callback URL — race on the same row, and Postgres lets exactly one of them see
   * `consumed_at IS NULL`. The loser gets no row and is denied, rather than both being handed the
   * same PKCE verifier.
   */
  async consume(db: DbOrTx, stateHash: string, now: Date): Promise<AdminAuthRequestRow | null> {
    const [row] = await db
      .update(adminAuthRequests)
      .set({ consumedAt: now })
      .where(
        and(
          eq(adminAuthRequests.stateHash, stateHash),
          isNull(adminAuthRequests.consumedAt),
          gt(adminAuthRequests.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  },
};
