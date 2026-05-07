import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { subWallets } from './wallet';

export const notificationKindEnum = pgEnum('notification_kind', [
  'bump_requested',
  'bump_decided',
  'txn_settled',
  'txn_failed',
  'anomaly_alert',
  'refund_received',
]);

export const notificationChannelEnum = pgEnum('notification_channel', ['push', 'sms', 'in_app']);

export const channelPreferenceEnum = pgEnum('channel_preference', [
  'real_time',
  'threshold',
  'digest',
  'silent',
]);

export const devicePlatformEnum = pgEnum('device_platform', ['ios', 'android']);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
  'skipped',
  'read',
]);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    preference: channelPreferenceEnum('preference').notNull(),
    thresholdKobo: text('threshold_kobo'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.kind, t.channel] }),
  }),
);

export const deviceTokens = pgTable('device_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expoPushToken: text('expo_push_token').notNull().unique(),
  platform: devicePlatformEnum('platform').notNull(),
  deviceLabel: text('device_label'),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  recipientUserId: uuid('recipient_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: notificationKindEnum('kind').notNull(),
  channel: notificationChannelEnum('channel').notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  dedupeKey: text('dedupe_key').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  providerReceipt: text('provider_receipt'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subwalletSnooze = pgTable(
  'subwallet_snooze',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subWalletId: uuid('sub_wallet_id')
      .notNull()
      .references(() => subWallets.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.subWalletId] }),
  }),
);

export const userQuietHours = pgTable('user_quiet_hours', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  startMinute: smallint('start_minute').notNull(),
  endMinute: smallint('end_minute').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
