import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deviceTokens } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type DeviceTokenRow = typeof deviceTokens.$inferSelect;

export type RegisterTokenInput = {
  userId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  deviceLabel?: string | null;
};

export const deviceTokensRepo = {
  /** Register or refresh a device token. Upserts on `expoPushToken` (unique). */
  async register(db: DbOrTx, input: RegisterTokenInput): Promise<DeviceTokenRow> {
    const [row] = await db
      .insert(deviceTokens)
      .values({
        userId: input.userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        deviceLabel: input.deviceLabel ?? null,
      })
      .onConflictDoUpdate({
        target: deviceTokens.expoPushToken,
        set: {
          userId: input.userId,
          platform: input.platform,
          deviceLabel: input.deviceLabel ?? null,
          lastSeenAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('deviceTokens.register returned no row');
    return row;
  },

  async listByUser(db: DbOrTx, userId: string): Promise<DeviceTokenRow[]> {
    return db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId))
      .orderBy(desc(deviceTokens.lastSeenAt));
  },

  async deleteById(db: DbOrTx, id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)))
      .returning({ id: deviceTokens.id });
    return result.length > 0;
  },
};
