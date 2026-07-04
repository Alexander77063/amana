import { sql } from 'drizzle-orm';
import { bigint, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { transactions } from './transactions';
import { masterWallets, subWallets } from './wallet';

export const redemptionStatusEnum = pgEnum('redemption_status', [
  'reserved',
  'redeemed',
  'expired',
  'refunded',
]);

export const redemptionPayoutStatusEnum = pgEnum('redemption_payout_status', [
  'pending',
  'paid',
  'failed_retryable',
  'stuck',
]);

export const retailerOnboardingStatusEnum = pgEnum('retailer_onboarding_status', [
  'applied',
  'kyb_pending',
  'approved',
  'suspended',
]);

export const catalogItemStatusEnum = pgEnum('catalog_item_status', ['active', 'inactive']);

export const dealTypeEnum = pgEnum('deal_type', ['markdown']);

export const dealStatusEnum = pgEnum('deal_status', ['active', 'paused', 'ended']);

export const retailers = pgTable('retailers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  businessName: text('business_name').notNull(),
  // KYB in SP4 — the Anchor business customer id is null until then.
  anchorBusinessCustomerId: text('anchor_business_customer_id'),
  payoutBankCode: text('payout_bank_code').notNull(),
  payoutAccountNumber: text('payout_account_number').notNull(),
  // SP2 creates retailers directly live-approved; the apply→review→KYB flow is SP4.
  onboardingStatus: retailerOnboardingStatusEnum('onboarding_status').notNull().default('approved'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const catalogItems = pgTable('catalog_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  retailerId: uuid('retailer_id')
    .notNull()
    .references(() => retailers.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  // Gross list price (bigint kobo). Deals mark this down; effective price resolved in SP2 Task 4.
  priceKobo: bigint('price_kobo', { mode: 'bigint' }).notNull(),
  section: text('section').notNull(),
  description: text('description'),
  photoUrl: text('photo_url'),
  durationMinutes: integer('duration_minutes'),
  status: catalogItemStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  retailerId: uuid('retailer_id')
    .notNull()
    .references(() => retailers.id, { onDelete: 'restrict' }),
  // Null = retailer-wide (applies to all the retailer's items).
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, {
    onDelete: 'restrict',
  }),
  type: dealTypeEnum('type').notNull().default('markdown'),
  // Exactly one of discountBps / discountKobo is set — enforced in the service (SP2 Task 4), not the DB.
  discountBps: integer('discount_bps'),
  discountKobo: bigint('discount_kobo', { mode: 'bigint' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: dealStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const redemptions = pgTable('redemptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // The reserve (marketplace_purchase) transaction that holds the discounted funds in suspense.
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'restrict' }),
  buyerUserId: uuid('buyer_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  masterWalletId: uuid('master_wallet_id')
    .notNull()
    .references(() => masterWallets.id, { onDelete: 'restrict' }),
  // Nullable: principal-direct purchase spends the master LA (decision #17), no sub-wallet.
  subWalletId: uuid('sub_wallet_id').references(() => subWallets.id, { onDelete: 'restrict' }),
  // Text placeholders in SP1; SP4 swaps retailerId/catalogItemId to FKs via migration.
  retailerId: text('retailer_id').notNull(),
  catalogItemId: text('catalog_item_id').notNull(),
  dealId: text('deal_id'),
  grossKobo: bigint('gross_kobo', { mode: 'bigint' }).notNull(),
  discountedKobo: bigint('discounted_kobo', { mode: 'bigint' }).notNull(),
  commissionKobo: bigint('commission_kobo', { mode: 'bigint' }).notNull(),
  code: text('code').notNull().unique(),
  qrToken: text('qr_token').notNull().unique(),
  status: redemptionStatusEnum('status').notNull().default('reserved'),
  // The redemption payout (NIP-out) transaction created when the retailer scans. Nullable until redeemed.
  payoutTransactionId: uuid('payout_transaction_id').references(() => transactions.id, {
    onDelete: 'restrict',
  }),
  // Payout state machine, distinct from the voucher `status`. Nullable until the payout is initiated.
  payoutStatus: redemptionPayoutStatusEnum('payout_status'),
  payoutAttempts: integer('payout_attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
