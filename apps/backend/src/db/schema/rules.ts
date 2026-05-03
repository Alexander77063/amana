import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subWallets } from './wallet';
import { users } from './identity';

export const ruleSetStatusEnum = pgEnum('rule_set_status', ['active', 'superseded']);

export const ruleSets = pgTable('rule_sets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  subWalletId: uuid('sub_wallet_id')
    .notNull()
    .references(() => subWallets.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  status: ruleSetStatusEnum('status').notNull().default('active'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
