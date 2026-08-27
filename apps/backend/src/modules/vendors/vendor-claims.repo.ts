import { and, desc, eq, gt, lte, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorClaimAttempts } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ClaimAttemptRow = typeof vendorClaimAttempts.$inferSelect;

export const vendorClaimsRepo = {
  /**
   * Open a claim attempt for this (vendor, phone) — or re-open the one already pending for it.
   *
   * A pending row is no longer an exclusive hold on the vendor (PRE-LAUNCH GATE 2): the partial
   * unique index is on `(vendorId, phone)`, so other phones may have their own attempts open on
   * the same vendor at the same time and this call never competes with them. Whoever proves phone
   * control at `/verify` wins; `rejectOtherPendingForVendor` closes the rest inside the claim
   * transaction.
   *
   * That is what removed the `renewableSince` ceiling this function used to take. The ceiling
   * existed solely to bound how long one unproven caller could squat an exclusive slot. With no
   * exclusive slot there is nothing to bound, and keeping it would have been strictly harmful: it
   * refused to renew a row past the ceiling that had not yet lapsed, returned null, and so sent
   * the CALLER — including the honest owner whose own row it was — the uniform 202 with no code.
   * The runbook flagged exactly that window as the one case where a squat genuinely stranded a
   * victim.
   *
   * Returns null only when the insert and the update both miss, which now means the row changed
   * status underneath us — a concurrent verify or sweep.
   */
  async openAttempt(
    db: DbOrTx,
    input: {
      vendorId: string;
      phone: string;
      expiresAt: Date;
      now: Date;
    },
  ): Promise<ClaimAttemptRow | null> {
    const [row] = await db
      .insert(vendorClaimAttempts)
      .values({ vendorId: input.vendorId, phone: input.phone, expiresAt: input.expiresAt })
      .onConflictDoNothing()
      .returning();
    if (row) return row;

    // The only thing that can conflict now is this same phone's own pending row on this same
    // vendor, so re-dating it is unconditionally right — it is the caller's own attempt. One
    // UPDATE rather than SELECT-then-UPDATE, so a concurrent request from this phone resolves in
    // the database rather than in a read/write gap.
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
   * Close every OTHER pending attempt on a vendor, once one of them has been verified.
   *
   * Called inside the claim transaction. Without it a vendor ends up `claimed` while strangers'
   * attempts sit `pending` — phantom entries in the ops queue for a business that no longer needs
   * review, and rows `findPendingByPhone` would still hand to a later `/verify`.
   */
  async rejectOtherPendingForVendor(
    db: DbOrTx,
    vendorId: string,
    exceptAttemptId: string,
  ): Promise<number> {
    const changed = await db
      .update(vendorClaimAttempts)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(vendorClaimAttempts.vendorId, vendorId),
          eq(vendorClaimAttempts.status, 'pending'),
          ne(vendorClaimAttempts.id, exceptAttemptId),
        ),
      )
      .returning({ id: vendorClaimAttempts.id });
    return changed.length;
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
