import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { households } from './identity';

export const vendorStatusEnum = pgEnum('vendor_status', ['observed', 'claimed', 'suspended']);
export const vendorCategorySourceEnum = pgEnum('vendor_category_source', [
  'observed',
  'claimed',
  'ops',
]);

/**
 * Raw material for the registry. One row per (bank account, household) — never per sub-wallet,
 * and never per payment.
 *
 * `vendor_recents` cannot serve this purpose: `recentsService.touch` trims to the ten most recent
 * per sub-wallet on every write, so that table destroys its own history by design.
 *
 * This table is exposed by NO route. It is a payment graph over Nigerian bank accounts and is the
 * sensitive part of the design — the promotion threshold and the retention sweep are what keep it
 * from becoming a directory of private individuals.
 */
export const vendorObservations = pgTable(
  'vendor_observations',
  {
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    // household_id sits in the PRIMARY KEY so that COUNT(*) grouped by (bank_code, account_number)
    // IS the distinct-household count. No DISTINCT, no join to wallets at promotion time.
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // Last NIBSS-authoritative name seen from this household. Not trusted for display on its own;
    // the promotion pass picks the most recently seen name across all households.
    accountName: text('account_name').notNull(),
    settledCount: integer('settled_count').notNull().default(1),
    // { "<category>": <count> } as tagged by THIS household's payers — self-attested, and known
    // to be so. Consensus collapses this to a single vote per household; these counts must never
    // be summed across households or one frequent customer outvotes everyone else.
    categoryCounts: jsonb('category_counts')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, number>>(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bankCode, t.accountNumber, t.householdId] }),
    // The retention sweep scans by age; promotion scans by account via the PK's leading columns.
    lastSeenIdx: index('vendor_observations_last_seen_idx').on(t.lastSeenAt),
  }),
);

/**
 * The registry proper. A row exists only once the account has been paid by at least
 * VENDOR_REGISTRY_MIN_HOUSEHOLDS distinct households — that threshold IS the operational
 * definition of "public-facing merchant", so no vendor ever has to self-declare.
 */
export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    // NIBSS name at promotion. A claimed vendor may later override it with a trading name.
    displayName: text('display_name').notNull(),
    status: vendorStatusEnum('status').notNull().default('observed'),
    // Null until consensus is confident, or until the vendor claims and picks one.
    category: text('category'),
    // Authority marker. Only 'claimed' and 'ops' are ever ENFORCED, and only these two may ever
    // carry a category on the sensitive list.
    categorySource: vendorCategorySourceEnum('category_source').notNull().default('observed'),
    // How many distinct households voted to produce `category`. Null when category is null. Kept
    // because the confidence behind a consensus is not recoverable from the value alone.
    categoryHouseholdCount: integer('category_household_count'),
    // Human-typable display code (AMNV-7QK2H-9PZ0R), minted at claim in SP-V2. Null here because
    // an observed vendor has no code — nobody has proven they own the account.
    // Unique: this column is the lookup key for GET /vendors/code/:code in SP-V3.
    publicCode: text('public_code').unique(),
    claimedByPhone: text('claimed_by_phone'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Distinct-household count at the instant of promotion, for auditing the threshold decision.
    // The live count stays in vendor_observations.
    promotedHouseholdCount: integer('promoted_household_count').notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One registry row per bank account. Promotion is an idempotent upsert against this.
    acct: unique('vendors_bank_account_unique').on(t.bankCode, t.accountNumber),
  }),
);
