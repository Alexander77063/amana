import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const actorKindEnum = pgEnum('actor_kind', ['user', 'system', 'partner']);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  actorKind: actorKindEnum('actor_kind').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  subjectKind: text('subject_kind').notNull(),
  subjectId: uuid('subject_id').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
