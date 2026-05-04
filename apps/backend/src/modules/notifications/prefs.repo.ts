import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { notificationPreferences } from '../../db/schema';
import type { ChannelPreference, NotificationChannel, NotificationKind } from './types';

type DbOrTx = PostgresJsDatabase;

export type PreferenceRow = typeof notificationPreferences.$inferSelect;

export type UpsertPreferenceInput = {
  userId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  preference: ChannelPreference;
  thresholdKobo?: bigint | null;
};

export const prefsRepo = {
  async findOne(
    db: DbOrTx,
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
  ): Promise<PreferenceRow | undefined> {
    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.kind, kind),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);
    return row;
  },

  async listByUser(db: DbOrTx, userId: string): Promise<PreferenceRow[]> {
    return db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  },

  async upsert(db: DbOrTx, input: UpsertPreferenceInput): Promise<PreferenceRow> {
    const [row] = await db
      .insert(notificationPreferences)
      .values({
        userId: input.userId,
        kind: input.kind,
        channel: input.channel,
        preference: input.preference,
        thresholdKobo:
          input.thresholdKobo === null || input.thresholdKobo === undefined
            ? null
            : input.thresholdKobo.toString(),
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.kind,
          notificationPreferences.channel,
        ],
        set: {
          preference: input.preference,
          thresholdKobo:
            input.thresholdKobo === null || input.thresholdKobo === undefined
              ? null
              : input.thresholdKobo.toString(),
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('prefs.upsert returned no row');
    return row;
  },
};
