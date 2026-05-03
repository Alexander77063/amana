import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { auditLog } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ActorKind = 'user' | 'system' | 'partner';

export type AuditEntry = {
  actorKind: ActorKind;
  actorUserId?: string | null;
  action: string;
  subjectKind: string;
  subjectId: string;
  payloadJson: unknown;
};

export type AuditRow = typeof auditLog.$inferSelect;

export const auditRepo = {
  async append(db: DbOrTx, entry: AuditEntry): Promise<AuditRow> {
    const [row] = await db
      .insert(auditLog)
      .values({
        actorKind: entry.actorKind,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        subjectKind: entry.subjectKind,
        subjectId: entry.subjectId,
        payloadJson: entry.payloadJson as object,
      })
      .returning();
    if (!row) throw new Error('audit.append returned no row');
    return row;
  },

  async listBySubject(db: DbOrTx, subjectId: string): Promise<AuditRow[]> {
    return db.select().from(auditLog).where(eq(auditLog.subjectId, subjectId));
  },

  async listByActor(db: DbOrTx, actorUserId: string): Promise<AuditRow[]> {
    return db.select().from(auditLog).where(eq(auditLog.actorUserId, actorUserId));
  },

  async listByAction(db: DbOrTx, action: string): Promise<AuditRow[]> {
    return db.select().from(auditLog).where(eq(auditLog.action, action));
  },
};
