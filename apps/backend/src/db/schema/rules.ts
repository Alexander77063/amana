import { sql } from 'drizzle-orm';
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { subWallets } from './wallet';

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

export const ruleKindEnum = pgEnum('rule_kind', [
  'limit',
  'category',
  'time_window',
  'allowlist',
  'anomaly_threshold',
]);

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ruleSetId: uuid('rule_set_id')
    .notNull()
    .references(() => ruleSets.id, { onDelete: 'cascade' }),
  kind: ruleKindEnum('kind').notNull(),
  configJson: jsonb('config_json').notNull(),
  priority: integer('priority').notNull().default(100),
});
