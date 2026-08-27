import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { vendors } from './vendors';

export const vendorClaimStatusEnum = pgEnum('vendor_claim_status', [
  'pending',
  'verified',
  'expired',
  'rejected',
]);

/**
 * One in-flight attempt by a phone number to claim one registry vendor.
 *
 * This exists because the OTP challenge is keyed by phone alone: something has to remember WHICH
 * account the phone said it was claiming between the request and the verify, and it must not be
 * the client — otherwise the verify step could redirect a legitimately-earned OTP at a different
 * vendor.
 */
export const vendorClaimAttempts = pgTable(
  'vendor_claim_attempts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    status: vendorClaimStatusEnum('status').notNull().default('pending'),
    // How ownership was established. Null while pending; 'phone_lookup' or 'ops' once verified.
    // Recorded because a vendor verified by a human is a different trust proposition from one
    // verified by NIBSS, and only the audit log would otherwise remember which.
    ownershipProof: text('ownership_proof'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // At most one pending attempt per vendor PER PHONE — not one per vendor.
    //
    // Scoped on phone deliberately (PRE-LAUNCH GATE 2, docs/runbook/vendor-claim.md). Keyed on
    // `vendorId` alone, a `pending` row was an EXCLUSIVE slot that `/request` handed out with no
    // proof of anything: nothing there establishes that the caller controls the phone they
    // submitted, it is a string in a request body. So anyone who knew a vendor's account number —
    // printed on shop POS stickers, not secret — could take the slot and lock the real owner out
    // until it lapsed.
    //
    // Exclusivity now happens at `/verify`, where the OTP proves phone control, and the claim
    // transaction closes the losing attempts. Someone who cannot receive the SMS holds nothing,
    // so the race stops existing rather than being bounded by a timer.
    //
    // Still partial, for the original reason: historical expired/rejected rows must be
    // unconstrained or a vendor could never be retried after a failed claim. Still unique per
    // (vendor, phone) so a repeat request from the same phone renews its own row instead of
    // piling up duplicates.
    onePendingPerPhone: uniqueIndex('vendor_claim_attempts_one_pending_per_phone')
      .on(t.vendorId, t.phone)
      .where(sql`status = 'pending'`),
    phoneIdx: index('vendor_claim_attempts_phone_idx').on(t.phone),
  }),
);
