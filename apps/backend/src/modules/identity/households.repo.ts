import { eq, sql } from 'drizzle-orm';
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

  async findMembers(
    db: DbOrTx,
    householdId: string,
  ): Promise<
    Array<{
      userId: string;
      phone: string;
      role: 'principal' | 'agent';
      kycTier: '1' | '2' | '3';
      status: 'active' | 'suspended';
      joinedAt: Date;
    }>
  > {
    const rows = await db.execute<{
      user_id: string;
      phone: string;
      role: 'principal' | 'agent';
      kyc_tier: '1' | '2' | '3';
      status: 'active' | 'suspended';
      joined_at: Date;
    }>(sql`
      SELECT u.id AS user_id, u.phone, u.role, u.kyc_tier, hm.status, hm.joined_at
      FROM household_members hm
      INNER JOIN users u ON u.id = hm.user_id
      WHERE hm.household_id = ${householdId}
      ORDER BY hm.joined_at ASC
    `);
    return rows.map((r) => ({
      userId: r.user_id,
      phone: r.phone,
      role: r.role,
      kycTier: r.kyc_tier,
      status: r.status,
      joinedAt: r.joined_at,
    }));
  },
};
