export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received';

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';

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
 * Resolved client-side from `notification.payloadJson` + `notification.kind`.
 * `kind: 'none'` means the inbox tap should mark-read only — no navigation.
 */
export type NotificationDeepLink =
  | { kind: 'bump'; bumpRequestId: string }
  | { kind: 'transaction'; transactionId: string }
  | { kind: 'none' };

export type MyNotificationsResponse = {
  notifications: Notification[];
};
