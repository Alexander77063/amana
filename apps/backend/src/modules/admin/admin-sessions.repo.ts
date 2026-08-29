import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminSessions, adminUsers } from '../../db/schema';
import type { AdminUserRow } from './admin-users.repo';

type DbOrTx = PostgresJsDatabase;

export type AdminSessionRow = typeof adminSessions.$inferSelect;

export const adminSessionsRepo = {
  async insert(
    db: DbOrTx,
    input: { adminUserId: string; tokenHash: string; expiresAt: Date },
  ): Promise<AdminSessionRow> {
    const [row] = await db.insert(adminSessions).values(input).returning();
    if (!row) throw new Error('adminSessions.insert returned no row');
    return row;
  },

  /**
   * Resolve a live session by its token digest, joined to its admin in one query.
   *
   * Liveness (not revoked, not expired) is in the WHERE clause rather than checked in the
   * service: this runs on every authenticated admin request, and a filter the database applies
   * cannot be forgotten by a caller.
   */
  async findLiveByTokenHash(
    db: DbOrTx,
    tokenHash: string,
    now: Date,
  ): Promise<{ session: AdminSessionRow; adminUser: AdminUserRow } | null> {
    const [row] = await db
      .select({ session: adminSessions, adminUser: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async touch(db: DbOrTx, sessionId: string, now: Date): Promise<void> {
    await db.update(adminSessions).set({ lastUsedAt: now }).where(eq(adminSessions.id, sessionId));
  },

  /** Revoke by digest. Idempotent, and a no-op for a token that was never issued. */
  async revokeByTokenHash(db: DbOrTx, tokenHash: string, now: Date): Promise<void> {
    await db
      .update(adminSessions)
      .set({ revokedAt: now })
      .where(and(eq(adminSessions.tokenHash, tokenHash), isNull(adminSessions.revokedAt)));
  },
};
