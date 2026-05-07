import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { userQuietHours } from '../../db/schema/notifications';

type DbOrTx = PostgresJsDatabase;

export type QuietHoursValue = {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
};

export const quietHoursRepo = {
  async get(db: DbOrTx, userId: string): Promise<QuietHoursValue | null> {
    const [row] = await db
      .select({
        enabled: userQuietHours.enabled,
        startMinute: userQuietHours.startMinute,
        endMinute: userQuietHours.endMinute,
      })
      .from(userQuietHours)
      .where(eq(userQuietHours.userId, userId))
      .limit(1);
    return row ?? null;
  },

  async upsert(db: DbOrTx, userId: string, input: QuietHoursValue): Promise<void> {
    await db
      .insert(userQuietHours)
      .values({
        userId,
        enabled: input.enabled,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
      })
      .onConflictDoUpdate({
        target: userQuietHours.userId,
        set: {
          enabled: input.enabled,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          updatedAt: new Date(),
        },
      });
  },
};
