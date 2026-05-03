import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { subWallets } from './wallet';

export const vendorRecents = pgTable(
  'vendor_recents',
  {
    subWalletId: uuid('sub_wallet_id')
      .notNull()
      .references(() => subWallets.id, { onDelete: 'cascade' }),
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    accountName: text('account_name').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subWalletId, t.bankCode, t.accountNumber] }),
  }),
);
