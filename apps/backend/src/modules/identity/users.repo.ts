import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users } from '../../db/schema';

export type DbOrTx = PostgresJsDatabase;

export type NewUser = {
  role: 'principal' | 'agent';
  phone: string;
  bvn?: string | null;
  nin: string;
  kycTier: '1' | '2' | '3';
};

export type UserRow = typeof users.$inferSelect;

export const usersRepo = {
  async insert(db: DbOrTx, input: NewUser): Promise<UserRow> {
    const [row] = await db
      .insert(users)
      .values({
        role: input.role,
        phone: input.phone,
        bvn: input.bvn ?? null,
        nin: input.nin,
        kycTier: input.kycTier,
      })
      .returning();
    if (!row) throw new Error('users.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  },

  async findByPhone(db: DbOrTx, phone: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    return row;
  },

  async setStatus(db: DbOrTx, id: string, status: 'active' | 'suspended'): Promise<void> {
    await db.update(users).set({ status }).where(eq(users.id, id));
  },

  async setKycTier(db: DbOrTx, id: string, kycTier: '1' | '2' | '3'): Promise<void> {
    await db.update(users).set({ kycTier }).where(eq(users.id, id));
  },

  async setAnchorCustomerId(db: DbOrTx, id: string, anchorCustomerId: string): Promise<void> {
    await db.update(users).set({ anchorCustomerId }).where(eq(users.id, id));
  },

  async findByAnchorCustomerId(db: DbOrTx, anchorCustomerId: string): Promise<UserRow | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.anchorCustomerId, anchorCustomerId))
      .limit(1);
    return row ?? null;
  },
};
