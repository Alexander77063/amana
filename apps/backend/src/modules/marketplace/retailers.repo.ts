import { and, desc, eq, inArray } from 'drizzle-orm';
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

  /**
   * Unconditional status write. Only for transitions with no legal predecessor set
   * (`suspend`, which is reachable from anywhere). Guarded transitions must use
   * `transitionOnboardingStatus` so the guard and the write are one atomic statement.
   */
  async updateOnboardingStatus(
    db: DbOrTx,
    id: string,
    status: RetailerOnboardingStatus,
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .update(retailers)
      .set({ onboardingStatus: status })
      .where(eq(retailers.id, id))
      .returning();
    return row;
  },

  /**
   * Atomic compare-and-set: move `id` to `to` only if it is currently in `from`.
   * Returns undefined when the guard did not hold (wrong status, or row gone), so two
   * concurrent callers cannot both observe a legal predecessor and both write — the
   * read-then-write version of this guard is a genuine race on a KYB re-submit.
   * `patch` lets a transition write its companion columns in the same statement.
   */
  async transitionOnboardingStatus(
    db: DbOrTx,
    id: string,
    from: readonly RetailerOnboardingStatus[],
    to: RetailerOnboardingStatus,
    patch: { anchorBusinessCustomerId?: string } = {},
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .update(retailers)
      .set({ onboardingStatus: to, ...patch })
      .where(
        and(
          eq(retailers.id, id),
          inArray(retailers.onboardingStatus, from as RetailerOnboardingStatus[]),
        ),
      )
      .returning();
    return row;
  },

  async setAnchorBusinessCustomerId(
    db: DbOrTx,
    id: string,
    anchorBusinessCustomerId: string,
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .update(retailers)
      .set({ anchorBusinessCustomerId })
      .where(eq(retailers.id, id))
      .returning();
    return row;
  },

  async findByAnchorBusinessCustomerId(
    db: DbOrTx,
    anchorBusinessCustomerId: string,
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .select()
      .from(retailers)
      .where(eq(retailers.anchorBusinessCustomerId, anchorBusinessCustomerId))
      .limit(1);
    return row;
  },

  /** Ops review queue: every retailer in one onboarding status, newest first. */
  async listByOnboardingStatus(
    db: DbOrTx,
    status: RetailerOnboardingStatus,
  ): Promise<RetailerRow[]> {
    return db
      .select()
      .from(retailers)
      .where(eq(retailers.onboardingStatus, status))
      .orderBy(desc(retailers.createdAt));
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
