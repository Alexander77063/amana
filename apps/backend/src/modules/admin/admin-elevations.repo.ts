import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminElevations } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type AdminElevationRow = typeof adminElevations.$inferSelect;

export type CreateElevationInput = {
  adminUserId: string;
  transactionId: string;
  reason: string;
  expiresAt: Date;
};

export const adminElevationsRepo = {
  async create(db: DbOrTx, input: CreateElevationInput): Promise<AdminElevationRow> {
    const [row] = await db.insert(adminElevations).values(input).returning();
    // `noUncheckedIndexedAccess` makes this `T | undefined`; an insert that returns nothing is a
    // bug, not an empty result.
    if (!row) throw new Error('admin_elevations insert returned no row');
    return row;
  },

  /**
   * The liveness lookup: unconsumed, unexpired, and belonging to BOTH this operator and this
   * transaction. All four predicates are load-bearing — dropping any one of them turns a scoped,
   * single-use authorisation into something broader.
   */
  async findLive(
    db: DbOrTx,
    adminUserId: string,
    transactionId: string,
    now: Date,
  ): Promise<AdminElevationRow | null> {
    const [row] = await db
      .select()
      .from(adminElevations)
      .where(
        and(
          eq(adminElevations.adminUserId, adminUserId),
          eq(adminElevations.transactionId, transactionId),
          isNull(adminElevations.consumedAt),
          gt(adminElevations.expiresAt, now),
        ),
      )
      .orderBy(desc(adminElevations.createdAt))
      .limit(1);
    return row ?? null;
  },

  /**
   * Consume it. The `consumed_at IS NULL` predicate is a concurrency guard: two resolves racing on
   * one authorisation must not both succeed, so the loser gets null and refuses.
   */
  async markConsumed(db: DbOrTx, id: string, now: Date): Promise<AdminElevationRow | null> {
    const [row] = await db
      .update(adminElevations)
      .set({ consumedAt: now })
      .where(and(eq(adminElevations.id, id), isNull(adminElevations.consumedAt)))
      .returning();
    return row ?? null;
  },
};
