import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const actorKindEnum = pgEnum('actor_kind', ['user', 'system', 'partner']);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    subjectKind: text('subject_kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Atomic webhook dedupe: one row per Anchor event. Partial so other audit
    // subjects (which legitimately repeat) are unaffected.
    anchorWebhookSubjectUniq: uniqueIndex('audit_log_anchor_webhook_subject_uniq')
      .on(t.subjectId)
      .where(sql`subject_kind = 'anchor_webhook'`),
  }),
);
