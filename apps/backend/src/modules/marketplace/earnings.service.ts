import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { redemptions } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type EarningsSummary = {
  /** Vouchers actually redeemed — the only ones that earn anything. */
  redeemedCount: number;
  /** What buyers paid, before Amana's commission. */
  grossKobo: bigint;
  /** Commission retained by the platform. */
  commissionKobo: bigint;
  /** Owed to the retailer: discounted price less commission. */
  netKobo: bigint;
  /**
   * Of the net, what has actually reached the retailer's bank vs. is still in flight.
   *
   * `paid` is the terminal success state of `redemption_payout_status` — set by
   * redemption-settlement when the NIP-out confirms. Everything else (`pending`,
   * `failed_retryable`, `stuck`, and a null for a redemption whose payout row was never written)
   * counts as pending, because from the retailer's side the money has not arrived.
   */
  paidKobo: bigint;
  pendingKobo: bigint;
};

export type EarningRow = {
  redemptionId: string;
  code: string;
  catalogItemId: string;
  grossKobo: bigint;
  discountedKobo: bigint;
  commissionKobo: bigint;
  netKobo: bigint;
  payoutStatus: string | null;
  redeemedAt: Date | null;
  createdAt: Date;
};

/**
 * What a retailer has earned.
 *
 * Spec §7 is explicit that this is **settlement history, not a held balance**, and the money
 * model makes that more than a presentational choice: Amana never holds retailer funds. A
 * redemption creates a NIP-out to the retailer's own bank account, so there is no account here
 * whose balance could be shown. Reporting one would invent a liability that does not exist.
 *
 * Everything derives from `redemptions`, which is the record the payout transaction was created
 * from. Net is `discounted - commission`, the same arithmetic `redeem.service` uses to size the
 * payout — computed in one place would be better still, but this at least states the dependency
 * so the two cannot drift silently.
 */
export const earningsService = {
  async summary(db: DbOrTx, retailerId: string): Promise<EarningsSummary> {
    const [row] = await db
      .select({
        redeemedCount: sql<string>`count(*)::text`,
        grossKobo: sql<string>`coalesce(sum(${redemptions.grossKobo}), 0)::text`,
        commissionKobo: sql<string>`coalesce(sum(${redemptions.commissionKobo}), 0)::text`,
        netKobo: sql<string>`coalesce(sum(${redemptions.discountedKobo} - ${redemptions.commissionKobo}), 0)::text`,
        paidKobo: sql<string>`coalesce(sum(${redemptions.discountedKobo} - ${redemptions.commissionKobo}) filter (where ${redemptions.payoutStatus} = 'paid'), 0)::text`,
        pendingKobo: sql<string>`coalesce(sum(${redemptions.discountedKobo} - ${redemptions.commissionKobo}) filter (where ${redemptions.payoutStatus} is distinct from 'paid'), 0)::text`,
      })
      .from(redemptions)
      .where(and(eq(redemptions.retailerId, retailerId), eq(redemptions.status, 'redeemed')));

    // Summed in Postgres and returned as text, then parsed to bigint: kobo totals can exceed
    // Number.MAX_SAFE_INTEGER, and this is money.
    return {
      redeemedCount: Number(row?.redeemedCount ?? '0'),
      grossKobo: BigInt(row?.grossKobo ?? '0'),
      commissionKobo: BigInt(row?.commissionKobo ?? '0'),
      netKobo: BigInt(row?.netKobo ?? '0'),
      paidKobo: BigInt(row?.paidKobo ?? '0'),
      pendingKobo: BigInt(row?.pendingKobo ?? '0'),
    };
  },

  async history(
    db: DbOrTx,
    retailerId: string,
    opts: { limit: number; offset: number },
  ): Promise<EarningRow[]> {
    const rows = await db
      .select()
      .from(redemptions)
      .where(and(eq(redemptions.retailerId, retailerId), eq(redemptions.status, 'redeemed')))
      .orderBy(sql`${redemptions.redeemedAt} desc nulls last`)
      .limit(opts.limit)
      .offset(opts.offset);

    return rows.map((r) => ({
      redemptionId: r.id,
      code: r.code,
      catalogItemId: r.catalogItemId,
      grossKobo: r.grossKobo as bigint,
      discountedKobo: r.discountedKobo as bigint,
      commissionKobo: r.commissionKobo as bigint,
      netKobo: (r.discountedKobo as bigint) - (r.commissionKobo as bigint),
      payoutStatus: r.payoutStatus,
      redeemedAt: r.redeemedAt,
      createdAt: r.createdAt,
    }));
  },
};
