import { and, desc, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { redemptions } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type RedemptionStatus = 'reserved' | 'redeemed' | 'expired' | 'refunded';

export type RedemptionRow = typeof redemptions.$inferSelect;

export type NewRedemption = {
  transactionId: string;
  buyerUserId: string;
  masterWalletId: string;
  subWalletId?: string | null;
  retailerId: string;
  catalogItemId: string;
  dealId?: string | null;
  grossKobo: Kobo;
  discountedKobo: Kobo;
  commissionKobo: Kobo;
  code: string;
  qrToken: string;
  expiresAt: Date;
  status?: RedemptionStatus;
};

export const redemptionsRepo = {
  async insert(db: DbOrTx, input: NewRedemption): Promise<RedemptionRow> {
    const [row] = await db
      .insert(redemptions)
      .values({
        transactionId: input.transactionId,
        buyerUserId: input.buyerUserId,
        masterWalletId: input.masterWalletId,
        subWalletId: input.subWalletId ?? null,
        retailerId: input.retailerId,
        catalogItemId: input.catalogItemId,
        dealId: input.dealId ?? null,
        grossKobo: input.grossKobo,
        discountedKobo: input.discountedKobo,
        commissionKobo: input.commissionKobo,
        code: input.code,
        qrToken: input.qrToken,
        expiresAt: input.expiresAt,
        status: input.status ?? 'reserved',
      })
      .returning();
    if (!row) throw new Error('redemptions.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<RedemptionRow | undefined> {
    const [row] = await db.select().from(redemptions).where(eq(redemptions.id, id)).limit(1);
    return row;
  },

  /**
   * Fetch a redemption by its short code, taking a row-level `FOR UPDATE` lock so a concurrent
   * redeem transaction blocks until this one commits — the single-use / no-double-redeem guard.
   * Must be called inside a transaction to hold the lock for the duration of the redeem.
   */
  async findByCodeForUpdate(db: DbOrTx, code: string): Promise<RedemptionRow | undefined> {
    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.code, code))
      .limit(1)
      .for('update');
    return row;
  },

  /** A buyer's vouchers, newest first (the "My Vouchers" list). */
  async findByBuyer(db: DbOrTx, buyerUserId: string): Promise<RedemptionRow[]> {
    return db
      .select()
      .from(redemptions)
      .where(eq(redemptions.buyerUserId, buyerUserId))
      .orderBy(desc(redemptions.createdAt));
  },

  async markRedeemed(db: DbOrTx, id: string, at: Date): Promise<void> {
    await db
      .update(redemptions)
      .set({ status: 'redeemed', redeemedAt: at })
      .where(eq(redemptions.id, id));
  },

  async markStatus(db: DbOrTx, id: string, status: RedemptionStatus): Promise<void> {
    await db.update(redemptions).set({ status }).where(eq(redemptions.id, id));
  },

  /** Reserved vouchers whose hold has expired (`expires_at < now`) — the expiry-sweep candidates. */
  async findExpiredReserved(db: DbOrTx, now: Date): Promise<RedemptionRow[]> {
    return db
      .select()
      .from(redemptions)
      .where(and(eq(redemptions.status, 'reserved'), lt(redemptions.expiresAt, now)));
  },
};
