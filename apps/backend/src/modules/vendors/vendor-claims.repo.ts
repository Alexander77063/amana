import { and, eq, gt, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorClaimAttempts } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ClaimAttemptRow = typeof vendorClaimAttempts.$inferSelect;

export const vendorClaimsRepo = {
  /**
   * Open a claim attempt, or return null if one is already pending for this vendor.
   *
   * The null comes from the partial unique index, not from a prior SELECT: two claim requests
   * arriving together must not both open an attempt, and only the index can promise that.
   */
  async openAttempt(
    db: DbOrTx,
    input: { vendorId: string; phone: string; expiresAt: Date },
  ): Promise<ClaimAttemptRow | null> {
    const [row] = await db
      .insert(vendorClaimAttempts)
      .values({ vendorId: input.vendorId, phone: input.phone, expiresAt: input.expiresAt })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  },

  async findPendingByPhone(
    db: DbOrTx,
    phone: string,
    now: Date,
  ): Promise<ClaimAttemptRow | undefined> {
    const [row] = await db
      .select()
      .from(vendorClaimAttempts)
      .where(
        and(
          eq(vendorClaimAttempts.phone, phone),
          eq(vendorClaimAttempts.status, 'pending'),
          gt(vendorClaimAttempts.expiresAt, now),
        ),
      )
      .limit(1);
    return row;
  },

  /** Compare-and-set from `pending`, so a replayed verify cannot re-verify an attempt. */
  async markVerified(db: DbOrTx, attemptId: string, proof: string, now: Date): Promise<boolean> {
    const changed = await db
      .update(vendorClaimAttempts)
      .set({ status: 'verified', ownershipProof: proof, verifiedAt: now })
      .where(and(eq(vendorClaimAttempts.id, attemptId), eq(vendorClaimAttempts.status, 'pending')))
      .returning({ id: vendorClaimAttempts.id });
    return changed.length > 0;
  },

  /**
   * Release the partial-unique slot held by attempts nobody completed, so the vendor can be
   * claimed again later. Called from the registry sweep.
   */
  async expireOverdue(db: DbOrTx, now: Date): Promise<number> {
    const changed = await db
      .update(vendorClaimAttempts)
      .set({ status: 'expired' })
      .where(
        and(eq(vendorClaimAttempts.status, 'pending'), lte(vendorClaimAttempts.expiresAt, now)),
      )
      .returning({ id: vendorClaimAttempts.id });
    return changed.length;
  },
};
