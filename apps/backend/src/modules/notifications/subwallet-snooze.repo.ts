import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { subwalletSnooze } from '../../db/schema/notifications';

type DbOrTx = PostgresJsDatabase;

export type SnoozeRow = {
  subWalletId: string;
  expiresAt: Date | null;
};

export const subwalletSnoozeRepo = {
  /** True if a snooze row exists and is either indefinite (expires_at IS NULL) or in the future. */
  async isActive(db: DbOrTx, userId: string, subWalletId: string): Promise<boolean> {
    const [row] = await db
      .select({ expiresAt: subwalletSnooze.expiresAt })
      .from(subwalletSnooze)
      .where(
        and(
          eq(subwalletSnooze.userId, userId),
          eq(subwalletSnooze.subWalletId, subWalletId),
          or(isNull(subwalletSnooze.expiresAt), gt(subwalletSnooze.expiresAt, sql`now()`)),
        ),
      )
      .limit(1);
    return !!row;
  },

  /** Idempotent — second call updates expires_at. */
  async upsert(
    db: DbOrTx,
    userId: string,
    subWalletId: string,
    expiresAt: Date | null,
  ): Promise<void> {
    await db
      .insert(subwalletSnooze)
      .values({ userId, subWalletId, expiresAt })
      .onConflictDoUpdate({
        target: [subwalletSnooze.userId, subwalletSnooze.subWalletId],
        set: { expiresAt },
      });
  },

  async delete(db: DbOrTx, userId: string, subWalletId: string): Promise<void> {
    await db
      .delete(subwalletSnooze)
      .where(
        and(eq(subwalletSnooze.userId, userId), eq(subwalletSnooze.subWalletId, subWalletId)),
      );
  },

  async listForUser(db: DbOrTx, userId: string): Promise<SnoozeRow[]> {
    return db
      .select({
        subWalletId: subwalletSnooze.subWalletId,
        expiresAt: subwalletSnooze.expiresAt,
      })
      .from(subwalletSnooze)
      .where(eq(subwalletSnooze.userId, userId));
  },
};
