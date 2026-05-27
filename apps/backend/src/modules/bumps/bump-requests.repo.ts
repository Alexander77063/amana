import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { bumpRequests, households, masterWallets, subWallets } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type BumpStatus = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired';

export type BumpRequestRow = typeof bumpRequests.$inferSelect;

export type NewBumpRequest = {
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: Kobo;
  vendorResolvedName: string;
  agentNote?: string | null;
  expiresAt: Date;
};

export const bumpRequestsRepo = {
  async insert(db: DbOrTx, input: NewBumpRequest): Promise<BumpRequestRow> {
    const [row] = await db
      .insert(bumpRequests)
      .values({
        transactionId: input.transactionId,
        subWalletId: input.subWalletId,
        requestedByUserId: input.requestedByUserId,
        amountKobo: input.amountKobo,
        vendorResolvedName: input.vendorResolvedName,
        agentNote: input.agentNote ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error('bumpRequests.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<BumpRequestRow | undefined> {
    const [row] = await db.select().from(bumpRequests).where(eq(bumpRequests.id, id)).limit(1);
    return row;
  },

  async setDecision(
    db: DbOrTx,
    id: string,
    status: BumpStatus,
    decidedByUserId: string,
    decidedAt: Date,
  ): Promise<void> {
    await db
      .update(bumpRequests)
      .set({ status, decidedByUserId, decidedAt })
      .where(eq(bumpRequests.id, id));
  },

  async listExpired(db: DbOrTx, now: Date): Promise<BumpRequestRow[]> {
    return db
      .select()
      .from(bumpRequests)
      .where(and(eq(bumpRequests.status, 'pending'), lt(bumpRequests.expiresAt, now)));
  },

  /**
   * Returns the bumps the given principal can act on.
   * `pending`: status === 'pending' AND expiresAt > now
   * `history`: status in (approved_once|raise_limit|denied|expired)
   *            AND (decidedAt OR createdAt for expired-without-decision) within the last 30 days
   * Bumps are scoped to households where the user is the principal.
   */
  async findForPrincipal(
    db: DbOrTx,
    input: { userId: string; now: Date },
  ): Promise<{ pending: BumpRequestRow[]; history: BumpRequestRow[] }> {
    const cutoff = new Date(input.now.getTime() - 30 * 24 * 60 * 60_000);
    const rows = await db
      .select({ b: bumpRequests })
      .from(bumpRequests)
      .innerJoin(subWallets, eq(subWallets.id, bumpRequests.subWalletId))
      .innerJoin(masterWallets, eq(masterWallets.id, subWallets.masterWalletId))
      .innerJoin(households, eq(households.id, masterWallets.householdId))
      .where(eq(households.principalUserId, input.userId))
      .orderBy(desc(bumpRequests.createdAt));

    const pending: BumpRequestRow[] = [];
    const history: BumpRequestRow[] = [];
    for (const { b } of rows) {
      if (b.status === 'pending' && b.expiresAt > input.now) {
        pending.push(b);
        continue;
      }
      // History only contains terminal statuses. A pending bump past its expiry
      // but not yet swept by the cron is intentionally invisible to both buckets
      // until the sweep transitions it to 'expired'.
      if (b.status === 'pending') continue;
      const ts = b.decidedAt ?? b.createdAt;
      if (ts >= cutoff) history.push(b);
    }
    return { pending, history };
  },

  async bulkExpire(db: DbOrTx, ids: string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await db.execute(sql`
      UPDATE bump_requests
      SET status = 'expired',
          decided_at = ${now.toISOString()}::timestamptz,
          decided_by_user_id = requested_by_user_id
      WHERE id = ANY(${ids}::uuid[])
        AND status = 'pending'
    `);
  },
};
