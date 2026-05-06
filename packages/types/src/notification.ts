export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received';

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';

/**
 * UI-side preference enum. The backend enum also includes 'digest' but the
 * digest cron is not yet implemented, so the UI only reads/writes these three
 * for v1. When `digest` is reintroduced, add it here and to the upsert input.
 */
export type ChannelPreference = 'real_time' | 'threshold' | 'silent';

export type Notification = {
  id: string;
  recipientUserId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  dedupeKey: string;
  payloadJson: unknown;
  createdAt: string;
  updatedAt: string;
};

/**
 * The row shape the backend returns for `GET /me/notification-preferences`.
 * `preference` allows `'digest'` on the read side because a power user might
 * have set it via direct API; the UI displays such rows as if they were 'silent'.
 * `thresholdKobo` is BigInt-safe — string over the wire.
 */
export type NotificationPreference = {
  userId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  preference: ChannelPreference | 'digest';
  thresholdKobo: string | null;
  updatedAt: string;
};

export type MyNotificationPreferencesResponse = {
  preferences: NotificationPreference[];
};

/**
 * Write side. The UI never sends 'digest' for v1, so the input type is the
 * narrower ChannelPreference.
 */
export type UpsertPreferenceInput = {
  kind: NotificationKind;
  channel: NotificationChannel;
  preference: ChannelPreference;
  thresholdKobo?: string | null;
};

/**
 * Resolved client-side from `notification.payloadJson` + `notification.kind`.
 * `kind: 'none'` means the inbox tap should mark-read only — no navigation.
 */
export type NotificationDeepLink =
  | { kind: 'bump'; bumpRequestId: string }
  | { kind: 'transaction'; transactionId: string; subWalletId: string } // 6b-5: deep-link target when txn-detail screen ships
  | { kind: 'none' };

export type MyNotificationsResponse = {
  notifications: Notification[];
};
