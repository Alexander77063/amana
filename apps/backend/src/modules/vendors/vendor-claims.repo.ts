import { and, desc, eq, gt, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorClaimAttempts } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ClaimAttemptRow = typeof vendorClaimAttempts.$inferSelect;

export const vendorClaimsRepo = {
  /**
   * Open a claim attempt for this vendor — or, when one is already pending, RE-OPEN it if it
   * belongs to the same phone AND that row is still inside the absolute hold ceiling. Returns null
   * when the pending attempt belongs to someone else, or when it is past the ceiling and has not
   * yet lapsed.
   *
   * The conflict comes from the partial unique index, not from a prior SELECT: two claim requests
   * arriving together must not both open an attempt, and only the index can promise that.
   *
   * The same-phone recovery is not a convenience. Without it a claimant is LOCKED OUT by the
   * runbook's own expected outcome: a `409 ownership_unproved` consumes the OTP but deliberately
   * leaves the attempt `pending` for the ops queue, so the claimant's next `/request` conflicts,
   * gets null, and — because the caller cannot be told anything (uniform 202) — silently receives
   * no second code. Matching on `phone` (and NOT on `expiresAt`, so a stale-but-unswept row is
   * recovered too) fixes that.
   *
   * `renewableSince` is the price of that recovery. Nothing at `/request` proves the caller
   * controls the phone they submitted — it is a string in a request body — so re-dating on a
   * `(vendorId, phone, pending)` match alone let ANYONE who knows a victim's number renew the slot
   * for ever with one call every `VENDOR_CLAIM_TTL_SECONDS`, permanently squatting the vendor AND
   * permanently blocking that number from claiming any other vendor via the cross-vendor guard in
   * `vendorClaimService.request`. Comparing the row's OWN `createdAt` (not its `expiresAt`, which
   * renewal moves) bounds any single hold to `VENDOR_CLAIM_MAX_HOLD_SECONDS` from first open, plus
   * whatever trailing validity the last renewal inside that window bought. It costs the legitimate
   * flow nothing: a retry inside the TTL already matched this predicate before the ceiling
   * existed, without needing the re-dating at all.
   *
   * A DIFFERENT phone still gets null while the slot is live. That is the land-grab guard: proof
   * of phone control only happens at verify, so whoever opened the pending attempt has proved
   * nothing yet, and letting a second caller take the slot from them would be the attack this
   * index exists to stop.
   */
  async openAttempt(
    db: DbOrTx,
    input: {
      vendorId: string;
      phone: string;
      expiresAt: Date;
      now: Date;
      /** Floor on the row's own `createdAt` — `now - VENDOR_CLAIM_MAX_HOLD_SECONDS`. */
      renewableSince: Date;
    },
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
          gt(vendorClaimAttempts.createdAt, input.renewableSince),
        ),
      )
      .returning();
    if (reopened) return reopened;

    // Neither path took: the slot is held by another phone, or by this phone past the ceiling.
    // Release it HERE if its own TTL has already lapsed, rather than leaving it to the hourly
    // sweep (`cron/jobs/vendor-registry-sweep.job.ts`, `17 * * * *`) — that lag added up to a
    // further ~59 minutes on every expiry, and it is what makes the ceiling above actually free
    // the slot instead of deadlocking it. Scoped to this vendor because the partial unique index
    // is on `vendorId` alone: this vendor's own pending row is the only one that can block the
    // insert. It does not replace `expireOverdue` — the sweep still reaches vendors nobody calls
    // `/request` on again.
    //
    // Deliberately `expiresAt <= now` ONLY, never "past the ceiling": expiring a past-ceiling row
    // here would let the same phone immediately re-insert with a fresh `createdAt` and so reset
    // its own ceiling on demand.
    //
    // This DELAYS that reset by one `VENDOR_CLAIM_TTL_SECONDS`; it does not close it. Once the
    // row genuinely lapses, the same phone's next `/request` releases it below and re-inserts
    // with a fresh `createdAt` and a fresh hour. So the ceiling bounds any SINGLE hold, not the
    // total — it converts a permanent exclusive lock into a repeating one with a contention gap
    // that a determined script still wins. Closing that is PRE-LAUNCH GATE 2; see the runbook's
    // "What the ceiling is not".
    const released = await db
      .update(vendorClaimAttempts)
      .set({ status: 'expired' })
      .where(
        and(
          eq(vendorClaimAttempts.vendorId, input.vendorId),
          eq(vendorClaimAttempts.status, 'pending'),
          lte(vendorClaimAttempts.expiresAt, input.now),
        ),
      )
      .returning({ id: vendorClaimAttempts.id });
    if (released.length === 0) return null;

    const [retried] = await db
      .insert(vendorClaimAttempts)
      .values({ vendorId: input.vendorId, phone: input.phone, expiresAt: input.expiresAt })
      .onConflictDoNothing()
      .returning();
    return retried ?? null;
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
