import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { users } from './identity';

export const actorKindEnum = pgEnum('actor_kind', ['user', 'system', 'partner', 'ops']);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    // The second kind of actor: Amana staff, who are not `users` rows (see `db/schema/admin.ts`
    // for why — `users` demands a phone and a NIN that staff do not have).
    //
    // This column is the fix for the gap that motivated sub-plan A1: every ops write today
    // records `actorKind: 'ops'` and a null actor, so the trail says an operator did it but never
    // which one. Task 4 moves the 13 ops endpoints onto it; Task 1 lands it and uses it for
    // sign-in. `restrict` on delete, like `actorUserId`: an admin row can never be deleted out
    // from under the history of what they did.
    actorAdminUserId: uuid('actor_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
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
