import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// 'retailer' is the marketplace supply side: the owner login for a retailer business (SP4b).
// It is a peer of principal/agent rather than a flag on them, because a retailer owner has no
// household, no wallet and no sub-wallet — every household route must reject it outright, and a
// distinct role is what makes that rejection the default rather than something each route
// remembers to check.
export const userRoleEnum = pgEnum('user_role', ['principal', 'agent', 'retailer']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended']);
export const kycTierEnum = pgEnum('kyc_tier', ['1', '2', '3']);
export const memberStatusEnum = pgEnum('member_status', ['active', 'suspended']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  role: userRoleEnum('role').notNull(),
  phone: text('phone').notNull().unique(),
  bvn: text('bvn'), // nullable — agents have none
  nin: text('nin').notNull(),
  kycTier: kycTierEnum('kyc_tier').notNull(),
  status: userStatusEnum('status').notNull().default('active'),
  anchorCustomerId: text('anchor_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const households = pgTable('households', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  principalUserId: uuid('principal_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  // Three-state on purpose. TRUE = registry category enforced for this household, FALSE = never,
  // NULL = inherit env.VENDOR_CATEGORY_ENFORCE_DEFAULT. Nullable is what lets the rollout proceed
  // household by household without a backfill touching every row.
  vendorCategoryEnforced: boolean('vendor_category_enforced'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: memberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.householdId, t.userId] }) }),
);
