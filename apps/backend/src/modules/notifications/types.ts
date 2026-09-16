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

/**
 * The little the PROVIDERS actually need: who to reach, and a label for logs. `NotificationIntent`
 * satisfies this structurally, so every existing caller is unaffected.
 *
 * It exists so a sender that must NOT be preference-resolved — support verification (sub-plan A1
 * Task 6) — can use the push and SMS rails without being forced to become a `NotificationKind`.
 * That union is backed by the `notification_kind` Postgres enum on `notifications.kind` and
 * `notification_preferences.kind`; adding a member to it would mean a migration AND would make the
 * new kind preference-able, which for a security challenge is precisely wrong.
 */
export type NotificationTarget = {
  recipientUserId: string;
  /** Free-form label for logs only. Not persisted, not matched against preferences. */
  kind: string;
};

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
  /**
   * Sub-wallet this intent originates from. Absent for principal direct-spend (decision #17).
   * FORWARD: per-kind sub-wallet snooze (subwallet_snooze_kind table) — see 6b-5 spec §6a
   */
  subWalletId?: string;
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
