import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendors } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type VendorRow = typeof vendors.$inferSelect;
export type VendorCategorySource = VendorRow['categorySource'];

export type PromoteInput = {
  bankCode: string;
  accountNumber: string;
  displayName: string;
  promotedHouseholdCount: number;
  now: Date;
};

export const vendorsRepo = {
  async findByAccount(
    db: DbOrTx,
    bankCode: string,
    accountNumber: string,
  ): Promise<VendorRow | undefined> {
    const [row] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.bankCode, bankCode), eq(vendors.accountNumber, accountNumber)))
      .limit(1);
    return row;
  },

  /**
   * Promote an account into the registry, or do nothing if it is already there.
   *
   * `onConflictDoNothing` against the (bank_code, account_number) unique makes the whole promotion
   * sweep idempotent and safe to run concurrently — re-running it promotes nothing new, and the
   * ORIGINAL promotion's household count is preserved rather than being rewritten every hour.
   * Returns null when the row already existed, so the caller can count real promotions.
   */
  async promoteIfAbsent(db: DbOrTx, input: PromoteInput): Promise<VendorRow | null> {
    const [row] = await db
      .insert(vendors)
      .values({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        displayName: input.displayName,
        promotedHouseholdCount: input.promotedHouseholdCount,
        promotedAt: input.now,
      })
      .onConflictDoNothing({ target: [vendors.bankCode, vendors.accountNumber] })
      .returning();
    return row ?? null;
  },

  async listByCategorySource(db: DbOrTx, source: VendorCategorySource): Promise<VendorRow[]> {
    return db.select().from(vendors).where(eq(vendors.categorySource, source));
  },

  /**
   * Write a consensus-derived category.
   *
   * The `category_source = 'observed'` predicate is a compare-and-set, not a courtesy: a claim
   * landing between the consensus computation and this write must win, and it does because the
   * UPDATE simply matches nothing. Returns whether a row was actually changed.
   */
  async setObservedCategory(
    db: DbOrTx,
    vendorId: string,
    category: string | null,
    householdCount: number | null,
  ): Promise<boolean> {
    const changed = await db
      .update(vendors)
      .set({ category, categoryHouseholdCount: householdCount })
      .where(and(eq(vendors.id, vendorId), eq(vendors.categorySource, 'observed')))
      .returning({ id: vendors.id });
    return changed.length > 0;
  },
};
