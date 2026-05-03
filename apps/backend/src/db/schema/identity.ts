import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['principal', 'agent']);
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const households = pgTable('households', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  principalUserId: uuid('principal_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
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
