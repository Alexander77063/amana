import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { households } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type NewHousehold = {
  principalUserId: string;
  name: string;
};

export type HouseholdRow = typeof households.$inferSelect;

export const householdsRepo = {
  async insert(db: DbOrTx, input: NewHousehold): Promise<HouseholdRow> {
    const [row] = await db.insert(households).values(input).returning();
    if (!row) throw new Error('households.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<HouseholdRow | undefined> {
    const [row] = await db.select().from(households).where(eq(households.id, id)).limit(1);
    return row;
  },

  async findByPrincipal(db: DbOrTx, principalUserId: string): Promise<HouseholdRow | undefined> {
    const [row] = await db
      .select()
      .from(households)
      .where(eq(households.principalUserId, principalUserId))
      .limit(1);
    return row;
  },
};
