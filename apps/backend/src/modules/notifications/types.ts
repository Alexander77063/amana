export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received';

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type ChannelPreference = 'real_time' | 'threshold' | 'digest' | 'silent';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';

/** What dispatchers pass in. The service resolves recipient prefs + fans out. */
export type NotificationIntent = {
  kind: NotificationKind;
  recipientUserId: string;
  /** Stable per-source-event key, e.g. `bump:${bumpRequestId}`. Used for dedupe + receipts. */
  dedupeKey: string;
  /** Free-form payload — templates pluck from this. */
  payload: Record<string, unknown>;
  /** Optional kobo amount for threshold-preference filtering (e.g. txn_settled). */
  amountKobo?: bigint;
  /** Optional anomaly score for threshold filtering on anomaly_alert. */
  anomalyScore?: number;
};

/** Result returned by `notificationService.dispatch`. */
export type DispatchResult = {
  intent: NotificationIntent;
  rows: Array<{
    notificationId: string;
    channel: NotificationChannel;
    status: NotificationStatus;
  }>;
};

/** Returned by template builders. */
export type RenderedNotification = {
  /** Push title / SMS prefix / in-app card title. */
  title: string;
  /** Body text. Plain — no markup. */
  body: string;
  /** Structured data for in-app rendering + push deep links. */
  data: Record<string, unknown>;
};
