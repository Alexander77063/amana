import { sql } from 'drizzle-orm';
import { bigint, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { transactions } from './transactions';
import { masterWallets, subWallets } from './wallet';

export const redemptionStatusEnum = pgEnum('redemption_status', [
  'reserved',
  'redeemed',
  'expired',
  'refunded',
]);

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
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
