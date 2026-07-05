import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vasBeneficiaries } from '../../db/schema/vas';

type DbOrTx = PostgresJsDatabase;

export const beneficiariesRepo = {
  async insert(db: DbOrTx, row: typeof vasBeneficiaries.$inferInsert) {
    const [r] = await db.insert(vasBeneficiaries).values(row).returning();
    return r;
  },
  async listActive(db: DbOrTx, subWalletId: string) {
    return db
      .select()
      .from(vasBeneficiaries)
      .where(and(eq(vasBeneficiaries.subWalletId, subWalletId), eq(vasBeneficiaries.active, true)));
  },
  async findActive(db: DbOrTx, subWalletId: string, kind: string, value: string) {
    const [r] = await db
      .select()
      .from(vasBeneficiaries)
      .where(
        and(
          eq(vasBeneficiaries.subWalletId, subWalletId),
          eq(vasBeneficiaries.kind, kind as never),
          eq(vasBeneficiaries.value, value),
          eq(vasBeneficiaries.active, true),
        ),
      )
      .limit(1);
    return r ?? null;
  },
  async findById(db: DbOrTx, id: string) {
    const [r] = await db
      .select()
      .from(vasBeneficiaries)
      .where(eq(vasBeneficiaries.id, id))
      .limit(1);
    return r ?? null;
  },
  async deactivate(db: DbOrTx, id: string) {
    await db.update(vasBeneficiaries).set({ active: false }).where(eq(vasBeneficiaries.id, id));
  },
};
