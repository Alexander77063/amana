import { bigint, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subWallets } from './wallet';
import { transactions } from './transactions';
import { users } from './identity';

export const bumpStatusEnum = pgEnum('bump_status', [
  'pending',
  'approved_once',
  'raise_limit',
  'denied',
  'expired',
]);

export const bumpRequests = pgTable('bump_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'restrict' }),
  subWalletId: uuid('sub_wallet_id')
    .notNull()
    .references(() => subWallets.id, { onDelete: 'restrict' }),
  requestedByUserId: uuid('requested_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  vendorResolvedName: text('vendor_resolved_name').notNull(),
  agentNote: text('agent_note'),
  status: bumpStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oneShotTokens = pgTable('one_shot_tokens', {
  token: text('token').primaryKey(),
  bumpRequestId: uuid('bump_request_id')
    .notNull()
    .references(() => bumpRequests.id, { onDelete: 'cascade' }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
