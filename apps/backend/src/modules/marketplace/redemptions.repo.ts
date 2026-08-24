import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { redemptions } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type RedemptionStatus = 'reserved' | 'redeemed' | 'expired' | 'refunded';

export type RedemptionPayoutStatus = 'pending' | 'paid' | 'failed_retryable' | 'stuck';

export type RedemptionRow = typeof redemptions.$inferSelect;

export type NewRedemption = {
  /**
   * Optional explicit primary key. The purchase service pre-generates the uuid so it can bind the
   * QR token to the row id (`mintQrToken(id)`) in a single insert — the DB `gen_random_uuid()`
   * default still applies when omitted.
   */
  id?: string;
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
        ...(input.id !== undefined && { id: input.id }),
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

  /** The redemption reserved by a given purchase (reserve) transaction — the idempotency-replay lookup. */
  async findByTransactionId(db: DbOrTx, transactionId: string): Promise<RedemptionRow | undefined> {
    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.transactionId, transactionId))
      .limit(1);
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

  /** The retailer's orders log, newest first. Paginated: this grows without bound. */
  async listByRetailer(
    db: DbOrTx,
    retailerId: string,
    opts: { limit: number; offset: number },
  ): Promise<RedemptionRow[]> {
    return db
      .select()
      .from(redemptions)
      .where(eq(redemptions.retailerId, retailerId))
      .orderBy(desc(redemptions.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
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

  /**
   * Set the payout linkage / state for a redemption. Used by the redeem flow (link the payout txn,
   * set `pending`) and the webhook handlers (`paid` / `failed_retryable` / `stuck`, bumping the
   * attempt counter on failure).
   */
  async setPayout(
    db: DbOrTx,
    id: string,
    input: {
      payoutTransactionId?: string | null;
      payoutStatus?: RedemptionPayoutStatus;
      incrementAttempts?: boolean;
    },
  ): Promise<void> {
    await db
      .update(redemptions)
      .set({
        ...(input.payoutTransactionId !== undefined && {
          payoutTransactionId: input.payoutTransactionId,
        }),
        ...(input.payoutStatus !== undefined && { payoutStatus: input.payoutStatus }),
        ...(input.incrementAttempts && {
          payoutAttempts: sql`${redemptions.payoutAttempts} + 1`,
        }),
      })
      .where(eq(redemptions.id, id));
  },

  /** Look up a redemption by its payout (NIP-out) transaction id — the webhook dispatch entry point. */
  async findByPayoutTxnId(db: DbOrTx, txnId: string): Promise<RedemptionRow | undefined> {
    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.payoutTransactionId, txnId))
      .limit(1);
    return row;
  },

  /** Reserved vouchers whose hold has expired (`expires_at < now`) — the expiry-sweep candidates. */
  async findExpiredReserved(db: DbOrTx, now: Date): Promise<RedemptionRow[]> {
    return db
      .select()
      .from(redemptions)
      .where(and(eq(redemptions.status, 'reserved'), lt(redemptions.expiresAt, now)));
  },
};
