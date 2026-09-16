import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { users } from './identity';

export const supportVerificationStatusEnum = pgEnum('support_verification_status', [
  'pending',
  'verified',
  'denied',
  'expired',
]);

/**
 * `none` is not an absence — it records that nothing was dispatched, because the number matched no
 * eligible customer. Keeping it as a value rather than a null is what lets the "no such customer"
 * path be read back and audited like any other.
 */
export const supportVerificationRailEnum = pgEnum('support_verification_rail', [
  'push',
  'sms',
  'none',
]);

/**
 * One row per verification ATTEMPT, written whether or not the phone resolves to a customer.
 *
 * That is deliberate. A table that only held rows for real customers would itself be an
 * enumeration oracle, and the "no such customer" path has to be indistinguishable from a customer
 * who simply did not answer — same shape, same timing, same expiry.
 *
 * This row is also the audit anchor. Every support read cites `id`, which is what makes "which
 * operator read this customer's data, under which verified session" answerable at all.
 */
export const supportVerifications = pgTable(
  'support_verifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Nullable only so the schema test can insert without a staff fixture; every production write
    // sets it, and the service is what guarantees that — an operator-less verification is
    // meaningless, and the session is bound to whoever started it.
    adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
    phoneE164: text('phone_e164').notNull(),
    // Null when the number matched nobody. Never surfaced to the operator.
    userId: uuid('user_id').references(() => users.id),
    status: supportVerificationStatusEnum('status').notNull().default('pending'),
    rail: supportVerificationRailEnum('rail').notNull(),
    // Push rail: the two-digit number the operator reads aloud. 10-99.
    matchNumber: smallint('match_number'),
    // SMS rail: a hash, never the code. Storing a readable code would hand anyone with database
    // access the ability to pass verification without the customer.
    codeHash: text('code_hash'),
    attempts: smallint('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
  },
  (t) => ({
    // The two cap queries: starts by one operator in a window, starts against one phone in a
    // window. Both are counted in the database rather than in an in-memory limiter, because a
    // daily cap that resets on every deploy is not a cap.
    byOperatorCreated: index('support_verifications_admin_created_idx').on(
      t.adminUserId,
      t.createdAt,
    ),
    byPhoneCreated: index('support_verifications_phone_created_idx').on(t.phoneE164, t.createdAt),
  }),
);
