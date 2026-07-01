import { sql } from 'drizzle-orm';
import {
  bigint,
  decimal,
  geometry,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { masterWallets, subWallets } from './wallet';

export const txnKindEnum = pgEnum('txn_kind', ['spend', 'topup', 'refund', 'fee', 'reversal']);
export const txnStatusEnum = pgEnum('txn_status', [
  'draft',
  'rule_eval',
  'bump_pending',
  'in_flight',
  'settled',
  'failed',
  'reversed',
]);

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  masterWalletId: uuid('master_wallet_id')
    .notNull()
    .references(() => masterWallets.id, { onDelete: 'restrict' }),
  subWalletId: uuid('sub_wallet_id').references(() => subWallets.id, { onDelete: 'restrict' }), // nullable: principal direct spend
  kind: txnKindEnum('kind').notNull(),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  inflowFeeAbsorbedKobo: bigint('inflow_fee_absorbed_kobo', { mode: 'bigint' }), // topup rows only; fee Amana absorbed
  status: txnStatusEnum('status').notNull().default('draft'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  nibssSessionId: text('nibss_session_id'),
  vendorAccount: text('vendor_account'),
  vendorBankCode: text('vendor_bank_code'),
  vendorResolvedName: text('vendor_resolved_name'),
  category: text('category'),
  anomalyScore: decimal('anomaly_score', { precision: 3, scale: 2 }),
  bumpRequestId: uuid('bump_request_id'), // FK to bump_requests, enforced at DB layer (migration 0013)
  agentNote: text('agent_note'),
  errorMessage: text('error_message'), // populated when status='failed' (6b-6); null otherwise
  geolocation: geometry('geolocation', { type: 'point', srid: 4326 }),
  attachedMedia: jsonb('attached_media'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Set atomically when the NIP-out is submitted, so a retry can't re-reserve.
  sentAt: timestamp('sent_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
});
