import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { transactions } from './transactions';
import { masterWallets, subWallets } from './wallet';

export const vasCategoryEnum = pgEnum('vas_category', [
  'airtime',
  'data',
  'electricity',
  'cabletv',
]);

// Lifecycle of the bill fulfilment (distinct from the money txn status).
export const vasStatusEnum = pgEnum('vas_status', ['pending', 'successful', 'failed']);

export const vasRecipientKindEnum = pgEnum('vas_recipient_kind', ['phone', 'meter', 'smartcard']);

export const vasPurchases = pgTable('vas_purchases', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'restrict' }),
  buyerUserId: uuid('buyer_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  masterWalletId: uuid('master_wallet_id')
    .notNull()
    .references(() => masterWallets.id, { onDelete: 'restrict' }),
  subWalletId: uuid('sub_wallet_id').references(() => subWallets.id, { onDelete: 'restrict' }),
  category: vasCategoryEnum('category').notNull(),
  provider: text('provider').notNull(), // Anchor biller slug (e.g. 'mtn', 'ikeja-electric')
  productSlug: text('product_slug'), // data plan / disco product slug; null for airtime
  recipientKind: vasRecipientKindEnum('recipient_kind').notNull(),
  recipient: text('recipient').notNull(), // phone | meter | smartcard number
  customerName: text('customer_name'), // from customer-validation (electricity/cable)
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  commissionKobo: bigint('commission_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  anchorBillId: text('anchor_bill_id'), // Anchor BillPayment id (set once the call returns)
  token: text('token'), // prepaid electricity token (set on success)
  status: vasStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const vasBeneficiaries = pgTable(
  'vas_beneficiaries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    subWalletId: uuid('sub_wallet_id')
      .notNull()
      .references(() => subWallets.id, { onDelete: 'cascade' }),
    kind: vasRecipientKindEnum('kind').notNull(),
    value: text('value').notNull(), // normalized phone / meter / smartcard
    label: text('label').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft-remove keeps history; an inactive row does not authorize a purchase. MUST be a real
    // boolean — this is an authorization control, and a stringly-typed 'false' is truthy in JS,
    // so any `if (b.active)` check would fail OPEN on a cash-out gate.
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    uniqPerWallet: unique('vas_beneficiaries_wallet_kind_value_uniq').on(
      t.subWalletId,
      t.kind,
      t.value,
    ),
  }),
);
