import { and, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { bumpRequests } from '../../db/schema';
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
};
