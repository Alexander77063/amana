import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendors } from '../../db/schema';
import { normalizeCrockford } from '../../lib/crockford';

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
   * Look a vendor up by its printed public code.
   *
   * The guard is load-bearing, not defensive noise. `public_code` is nullable AND unique, so
   * Postgres happily holds any number of NULL rows — every observed, unclaimed vendor is one. A
   * lookup that reached the database carrying NULL would match nothing and return `undefined`,
   * which looks exactly like a correct miss; the bug would only surface the day the comparison
   * semantics changed under it. Refuse before the query instead, so a blank code is a caller
   * error and not a silent no-op.
   *
   * A suspended vendor is still FOUND here on purpose — refusing it is the resolution layer's
   * job, because only a caller can decide whether "real but dead" and "never existed" deserve
   * the same answer.
   *
   * Normalization lives HERE, at the single lookup boundary, rather than in each route: the
   * in-app scan, the public landing page and any ops surface all reach a vendor through this
   * method, and a fold applied in only some of them is worse than none at all. See
   * `normalizeCrockford` for why accepting I/L/O is the other half of excluding them.
   */
  async findByPublicCode(db: DbOrTx, publicCode: string): Promise<VendorRow | undefined> {
    if (!publicCode || publicCode.trim().length === 0) return undefined;
    const normalized = normalizeCrockford(publicCode);
    const [row] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.publicCode, normalized))
      .limit(1);
    return row;
  },

  async findById(db: DbOrTx, vendorId: string): Promise<VendorRow | undefined> {
    const [row] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
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

  /**
   * Move a vendor from `observed` to `claimed`, in one atomic write.
   *
   * The `status = 'observed'` predicate is the compare-and-set that makes a claim single-use: a
   * second claim — a replay, or a race between two people who both control the phone — matches
   * nothing and returns null. Category and source move together with the status because a claimed
   * category that is still marked `observed` would silently fail to enforce.
   */
  async claim(
    db: DbOrTx,
    input: {
      vendorId: string;
      phone: string;
      category: string | null;
      publicCode: string;
      now: Date;
    },
  ): Promise<VendorRow | null> {
    const [row] = await db
      .update(vendors)
      .set({
        status: 'claimed',
        category: input.category,
        categorySource: 'claimed',
        categoryHouseholdCount: null,
        publicCode: input.publicCode,
        claimedByPhone: input.phone,
        claimedAt: input.now,
      })
      .where(and(eq(vendors.id, input.vendorId), eq(vendors.status, 'observed')))
      .returning();
    return row ?? null;
  },

  /** Ops override. Outranks a claimed category — an operator is correcting a business's own answer. */
  async setOpsCategory(db: DbOrTx, vendorId: string, category: string | null): Promise<boolean> {
    const changed = await db
      .update(vendors)
      .set({ category, categorySource: 'ops', categoryHouseholdCount: null })
      .where(eq(vendors.id, vendorId))
      .returning({ id: vendors.id });
    return changed.length > 0;
  },

  async setStatus(db: DbOrTx, vendorId: string, status: VendorRow['status']): Promise<boolean> {
    const changed = await db
      .update(vendors)
      .set({ status })
      .where(eq(vendors.id, vendorId))
      .returning({ id: vendors.id });
    return changed.length > 0;
  },
};
