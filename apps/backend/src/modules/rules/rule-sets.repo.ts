import { and, desc, eq, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ruleSets } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type RuleSetRow = typeof ruleSets.$inferSelect;

export const ruleSetsRepo = {
  async findActive(db: DbOrTx, subWalletId: string): Promise<RuleSetRow | undefined> {
    const [row] = await db
      .select()
      .from(ruleSets)
      .where(and(eq(ruleSets.subWalletId, subWalletId), eq(ruleSets.status, 'active')))
      .orderBy(desc(ruleSets.version))
      .limit(1);
    return row;
  },

  async findByVersion(
    db: DbOrTx,
    subWalletId: string,
    version: number,
  ): Promise<RuleSetRow | undefined> {
    const [row] = await db
      .select()
      .from(ruleSets)
      .where(and(eq(ruleSets.subWalletId, subWalletId), eq(ruleSets.version, version)))
      .limit(1);
    return row;
  },

  async maxVersion(db: DbOrTx, subWalletId: string): Promise<number> {
    const [row] = await db
      .select({ v: max(ruleSets.version) })
      .from(ruleSets)
      .where(eq(ruleSets.subWalletId, subWalletId));
    return row?.v ?? 0;
  },

  async insert(
    db: DbOrTx,
    input: { subWalletId: string; version: number; createdByUserId: string },
  ): Promise<RuleSetRow> {
    const [row] = await db.insert(ruleSets).values(input).returning();
    if (!row) throw new Error('ruleSets.insert returned no row');
    return row;
  },

  async markSuperseded(db: DbOrTx, id: string): Promise<void> {
    await db.update(ruleSets).set({ status: 'superseded' }).where(eq(ruleSets.id, id));
  },
};
