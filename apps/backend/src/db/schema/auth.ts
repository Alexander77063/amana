import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { households, users } from './identity';

export const phoneOtpChallenges = pgTable(
  'phone_otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    purpose: text('purpose', { enum: ['login', 'pair', 'vendor_claim'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One pending challenge per (phone, PURPOSE) — not per phone.
    //
    // Scoped on purpose deliberately (PRE-LAUNCH GATE 1, docs/runbook/vendor-claim.md). While this
    // was keyed on `phone` alone, a phone could hold only one live challenge, so minting a
    // `vendor_claim` code necessarily destroyed any pending `login` code. `/vendor-claim/request`
    // is unauthenticated and a promoted vendor's account number is printed on shop stickers rather
    // than secret, which made that a remote, targeted way to cancel any user's login OTP.
    //
    // Per-purpose uniqueness still holds, so a repeat request of the SAME purpose continues to
    // supersede its predecessor — the property `otpService.requestCode` relies on.
    byPhonePurposePending: uniqueIndex('phone_otp_challenges_by_phone_purpose_pending')
      .on(t.phone, t.purpose)
      .where(sql`consumed_at IS NULL`),
  }),
);

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pairingTokens = pgTable('pairing_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  principalUserId: uuid('principal_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedByUserId: uuid('consumed_by_user_id').references(() => users.id),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
