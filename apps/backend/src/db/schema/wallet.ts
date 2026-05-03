import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households, users } from './identity';

export const masterWalletStatusEnum = pgEnum('master_wallet_status', ['active', 'frozen']);
export const subWalletStatusEnum = pgEnum('sub_wallet_status', ['active', 'suspended', 'closed']);
export const ledgerAccountKindEnum = pgEnum('ledger_account_kind', [
  'master',
  'sub',
  'suspense',
  'fee',
  'external',
]);
export const normalSideEnum = pgEnum('normal_side', ['debit', 'credit']);

export const masterWallets = pgTable('master_wallets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'restrict' }),
  anchorVirtualAccount: text('anchor_virtual_account').notNull(),
  anchorBankCode: text('anchor_bank_code').notNull(),
  currency: text('currency').notNull().default('NGN'),
  status: masterWalletStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subWallets = pgTable('sub_wallets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  masterWalletId: uuid('master_wallet_id')
    .notNull()
    .references(() => masterWallets.id, { onDelete: 'restrict' }),
  agentUserId: uuid('agent_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  status: subWalletStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  masterWalletId: uuid('master_wallet_id')
    .notNull()
    .references(() => masterWallets.id, { onDelete: 'restrict' }),
  kind: ledgerAccountKindEnum('kind').notNull(),
  subWalletId: uuid('sub_wallet_id').references(() => subWallets.id, { onDelete: 'restrict' }),
  normalSide: normalSideEnum('normal_side').notNull(),
});
