import { and, desc, eq, gt, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorClaimAttempts } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ClaimAttemptRow = typeof vendorClaimAttempts.$inferSelect;

export const vendorClaimsRepo = {
  /**
   * Open a claim attempt for this vendor — or, when one is already pending, RE-OPEN it if it
   * belongs to the same phone. Returns null only when the pending attempt belongs to someone else.
   *
   * The conflict comes from the partial unique index, not from a prior SELECT: two claim requests
   * arriving together must not both open an attempt, and only the index can promise that.
   *
   * The same-phone recovery is not a convenience. Without it a claimant is LOCKED OUT by the
   * runbook's own expected outcome: a `409 ownership_unproved` consumes the OTP but deliberately
   * leaves the attempt `pending` for the ops queue, so the claimant's next `/request` conflicts,
   * gets null, and — because the caller cannot be told anything (uniform 202) — silently receives
   * no second code. Worse, the index predicate is `status = 'pending'` alone and ignores
   * `expiresAt`, while the sweep that expires rows runs hourly, so that lockout outlived
   * `VENDOR_CLAIM_TTL_SECONDS` by up to a further ~59 minutes. Matching on `phone` (and NOT on
   * `expiresAt`, so a stale-but-unswept row is recovered too) fixes both.
   *
   * A DIFFERENT phone still gets null. That is the land-grab guard: proof of phone control only
   * happens at verify, so whoever opened the pending attempt has proved nothing yet, and letting a
   * second caller take the slot from them would be the attack this index exists to stop.
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
    if (row) return row;

    // One UPDATE, not a SELECT-then-UPDATE: the phone match IS the predicate, so a concurrent
    // request from another phone matches nothing rather than racing a read.
    const [reopened] = await db
      .update(vendorClaimAttempts)
      .set({ expiresAt: input.expiresAt })
      .where(
        and(
          eq(vendorClaimAttempts.vendorId, input.vendorId),
          eq(vendorClaimAttempts.phone, input.phone),
          eq(vendorClaimAttempts.status, 'pending'),
        ),
      )
      .returning();
    return reopened ?? null;
  },

  /**
   * `ORDER BY createdAt DESC` is deliberate, not decorative: a phone can end up with more than one
   * pending row (see `vendorClaimService.request`'s cross-vendor check, which closes most but not
   * all of that window), and without an explicit order Postgres is free to return either one, so a
   * `verify` could nondeterministically resolve a different attempt than the one the caller most
   * recently opened. Newest-first matches what the caller actually did last.
   */
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
      .orderBy(desc(vendorClaimAttempts.createdAt))
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

  /** Pending attempts an operator may need to approve by hand. Newest first. */
  async listPendingForOps(db: DbOrTx, now: Date): Promise<ClaimAttemptRow[]> {
    return db
      .select()
      .from(vendorClaimAttempts)
      .where(and(eq(vendorClaimAttempts.status, 'pending'), gt(vendorClaimAttempts.expiresAt, now)))
      .orderBy(desc(vendorClaimAttempts.createdAt))
      .limit(200);
  },
};
