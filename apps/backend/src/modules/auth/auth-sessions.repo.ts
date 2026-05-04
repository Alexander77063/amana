import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { authSessions } from '../../db/schema';
import type { AuthSessionRow } from './types';

type DbOrTx = PostgresJsDatabase;

export type InsertSessionInput = {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
};

export const authSessionsRepo = {
  async insert(db: DbOrTx, input: InsertSessionInput): Promise<AuthSessionRow> {
    const [row] = await db.insert(authSessions).values(input).returning();
    if (!row) throw new Error('authSessions.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<AuthSessionRow | undefined> {
    const [row] = await db.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);
    return row;
  },

  async listActive(db: DbOrTx, userId: string, now: Date): Promise<AuthSessionRow[]> {
    return db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
        ),
      )
      .orderBy(desc(authSessions.lastUsedAt));
  },

  async touchLastUsed(db: DbOrTx, id: string, now: Date): Promise<void> {
    await db.update(authSessions).set({ lastUsedAt: now }).where(eq(authSessions.id, id));
  },

  async rotate(
    db: DbOrTx,
    sessionId: string,
    newInput: InsertSessionInput,
    now: Date,
  ): Promise<AuthSessionRow> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await txDb.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, sessionId));
      const [row] = await txDb.insert(authSessions).values(newInput).returning();
      if (!row) throw new Error('authSessions.rotate insert returned no row');
      return row;
    });
  },

  async revoke(db: DbOrTx, id: string, now: Date): Promise<void> {
    await db.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, id));
  },
};
