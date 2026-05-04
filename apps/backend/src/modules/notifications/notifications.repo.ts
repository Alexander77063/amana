import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { notifications } from '../../db/schema';
import type { NotificationChannel, NotificationKind, NotificationStatus } from './types';

type DbOrTx = PostgresJsDatabase;

export type NotificationRow = typeof notifications.$inferSelect;

export type InsertNotificationInput = {
  recipientUserId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  dedupeKey: string;
  payload: Record<string, unknown>;
  providerReceipt?: string | null;
  errorMessage?: string | null;
};

export const notificationsRepo = {
  async insert(db: DbOrTx, input: InsertNotificationInput): Promise<NotificationRow> {
    const [row] = await db
      .insert(notifications)
      .values({
        recipientUserId: input.recipientUserId,
        kind: input.kind,
        channel: input.channel,
        status: input.status,
        dedupeKey: input.dedupeKey,
        payloadJson: input.payload as object,
        providerReceipt: input.providerReceipt ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .returning();
    if (!row) throw new Error('notifications.insert returned no row');
    return row;
  },

  async findByDedupeKey(
    db: DbOrTx,
    recipientUserId: string,
    channel: NotificationChannel,
    dedupeKey: string,
  ): Promise<NotificationRow | undefined> {
    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, recipientUserId),
          eq(notifications.channel, channel),
          eq(notifications.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    return row;
  },

  async listByRecipient(
    db: DbOrTx,
    recipientUserId: string,
    limit: number,
  ): Promise<NotificationRow[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, recipientUserId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  },

  async markRead(db: DbOrTx, id: string, recipientUserId: string): Promise<boolean> {
    const result = await db
      .update(notifications)
      .set({ status: 'read', updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientUserId, recipientUserId),
        ),
      )
      .returning({ id: notifications.id });
    return result.length > 0;
  },

  async setStatus(
    db: DbOrTx,
    id: string,
    status: NotificationStatus,
    extra?: { providerReceipt?: string; errorMessage?: string },
  ): Promise<void> {
    await db
      .update(notifications)
      .set({
        status,
        providerReceipt: extra?.providerReceipt ?? null,
        errorMessage: extra?.errorMessage ?? null,
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, id));
  },
};
