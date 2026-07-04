import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { retailers } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type RetailerOnboardingStatus = 'applied' | 'kyb_pending' | 'approved' | 'suspended';

export type RetailerRow = typeof retailers.$inferSelect;

export type NewRetailer = {
  businessName: string;
  payoutBankCode: string;
  payoutAccountNumber: string;
  anchorBusinessCustomerId?: string | null;
  onboardingStatus?: RetailerOnboardingStatus;
};

export const retailersRepo = {
  async insert(db: DbOrTx, input: NewRetailer): Promise<RetailerRow> {
    const [row] = await db
      .insert(retailers)
      .values({
        businessName: input.businessName,
        payoutBankCode: input.payoutBankCode,
        payoutAccountNumber: input.payoutAccountNumber,
        anchorBusinessCustomerId: input.anchorBusinessCustomerId ?? null,
        ...(input.onboardingStatus !== undefined && { onboardingStatus: input.onboardingStatus }),
      })
      .returning();
    if (!row) throw new Error('retailers.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<RetailerRow | undefined> {
    const [row] = await db.select().from(retailers).where(eq(retailers.id, id)).limit(1);
    return row;
  },

  /** All live-approved retailers, newest first — the buyer-facing retailer directory (SP5). */
  async listApproved(db: DbOrTx): Promise<RetailerRow[]> {
    return db
      .select()
      .from(retailers)
      .where(eq(retailers.onboardingStatus, 'approved'))
      .orderBy(desc(retailers.createdAt));
  },
};
