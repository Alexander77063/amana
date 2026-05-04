import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { householdMembers } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type HouseholdMemberRow = typeof householdMembers.$inferSelect;

export const householdMembersRepo = {
  async add(db: DbOrTx, householdId: string, userId: string): Promise<HouseholdMemberRow> {
    const [row] = await db.insert(householdMembers).values({ householdId, userId }).returning();
    if (!row) throw new Error('householdMembers.add returned no row');
    return row;
  },

  async upsertActive(db: DbOrTx, input: { householdId: string; userId: string }): Promise<void> {
    await db
      .insert(householdMembers)
      .values({
        householdId: input.householdId,
        userId: input.userId,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [householdMembers.householdId, householdMembers.userId],
        set: { status: 'active' },
      });
  },

  async listByHousehold(db: DbOrTx, householdId: string): Promise<HouseholdMemberRow[]> {
    return db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
  },

  async setStatus(
    db: DbOrTx,
    householdId: string,
    userId: string,
    status: 'active' | 'suspended',
  ): Promise<void> {
    await db
      .update(householdMembers)
      .set({ status })
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      );
  },
};
