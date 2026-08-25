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
    // At most one pending attempt per vendor. A partial unique index rather than a plain one so
    // that the historical expired/rejected rows are unconstrained: without the WHERE clause a
    // vendor could never be retried after a failed claim.
    onePending: uniqueIndex('vendor_claim_attempts_one_pending')
      .on(t.vendorId)
      .where(sql`status = 'pending'`),
    phoneIdx: index('vendor_claim_attempts_phone_idx').on(t.phone),
  }),
);
