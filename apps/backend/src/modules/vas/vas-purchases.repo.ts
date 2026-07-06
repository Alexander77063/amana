import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vasPurchases } from '../../db/schema/vas';

type DbOrTx = PostgresJsDatabase;

export const vasPurchasesRepo = {
  async insert(db: DbOrTx, row: typeof vasPurchases.$inferInsert) {
    const [r] = await db.insert(vasPurchases).values(row).returning();
    if (!r) throw new Error('vas_purchases insert returned no row');
    return r;
  },
  async findById(db: DbOrTx, id: string) {
    const [r] = await db.select().from(vasPurchases).where(eq(vasPurchases.id, id)).limit(1);
    return r ?? null;
  },
  async findByTransactionId(db: DbOrTx, transactionId: string) {
    const [r] = await db
      .select()
      .from(vasPurchases)
      .where(eq(vasPurchases.transactionId, transactionId))
      .limit(1);
    return r ?? null;
  },
  async setResult(
    db: DbOrTx,
    id: string,
    patch: {
      status?: 'pending' | 'successful' | 'failed';
      anchorBillId?: string;
      token?: string | null;
      commissionKobo?: bigint;
      completedAt?: Date | null;
    },
  ) {
    await db.update(vasPurchases).set(patch).where(eq(vasPurchases.id, id));
  },
  async listByBuyer(db: DbOrTx, buyerUserId: string) {
    return db
      .select()
      .from(vasPurchases)
      .where(eq(vasPurchases.buyerUserId, buyerUserId))
      .orderBy(desc(vasPurchases.createdAt));
  },
};
