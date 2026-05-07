import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { prefsRepo } from './prefs.repo';
import { quietService } from './quiet.service';
import type {
  ChannelPreference,
  NotificationChannel,
  NotificationIntent,
  NotificationKind,
} from './types';

/**
 * Default preference matrix when no per-user row exists.
 * Rationale:
 *  - Bump requests + anomaly alerts wake the principal in real-time on push (action-required).
 *  - Settled / failed txns go to in-app real-time + push real-time (visibility).
 *  - SMS defaults to silent (cost + noise) except bump_requested where it's a fallback for principals
 *    without push tokens registered (Anchor can't reach them otherwise).
 */
const DEFAULT_MATRIX: Record<NotificationKind, Record<NotificationChannel, ChannelPreference>> = {
  bump_requested: { push: 'real_time', sms: 'real_time', in_app: 'real_time' },
  bump_decided: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_settled: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_failed: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  anomaly_alert: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  refund_received: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
};

export const prefsService = {
  /** Returns the effective preference for (user, kind, channel), falling back to the default matrix. */
  async getPreference(
    db: PostgresJsDatabase,
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
  ): Promise<{ preference: ChannelPreference; thresholdKobo: bigint | null }> {
    const row = await prefsRepo.findOne(db, userId, kind, channel);
    if (row) {
      return {
        preference: row.preference as ChannelPreference,
        thresholdKobo: row.thresholdKobo === null ? null : BigInt(row.thresholdKobo),
      };
    }
    return { preference: DEFAULT_MATRIX[kind][channel], thresholdKobo: null };
  },

  /**
   * Decide whether to send a given intent on a given channel.
   * Order: per-(kind, channel) matrix first; then quietService layer when matrix said 'send'.
   */
  async shouldSend(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    channel: NotificationChannel,
  ): Promise<
    | 'send'
    | 'skip_silent'
    | 'skip_threshold'
    | 'defer_digest'
    | 'skip_snoozed'
    | 'skip_quiet_hours'
  > {
    // 1) Resolve the existing per-(kind, channel) matrix.
    const { preference, thresholdKobo } = await prefsService.getPreference(
      db,
      intent.recipientUserId,
      intent.kind,
      channel,
    );

    let matrixDecision:
      | 'send'
      | 'skip_silent'
      | 'skip_threshold'
      | 'defer_digest';

    if (preference === 'silent') {
      matrixDecision = 'skip_silent';
    } else if (preference === 'digest') {
      matrixDecision = 'defer_digest';
    } else if (preference === 'threshold') {
      // Threshold semantics: send only when amount/score is at or above the threshold.
      if (intent.kind === 'anomaly_alert') {
        if (intent.anomalyScore === undefined) {
          matrixDecision = 'skip_threshold';
        } else {
          const scoreCutoff =
            thresholdKobo === null ? 0.85 : Number(thresholdKobo) / 100;
          matrixDecision =
            intent.anomalyScore >= scoreCutoff ? 'send' : 'skip_threshold';
        }
      } else if (intent.amountKobo === undefined || thresholdKobo === null) {
        matrixDecision = 'skip_threshold';
      } else {
        matrixDecision =
          intent.amountKobo >= thresholdKobo ? 'send' : 'skip_threshold';
      }
    } else {
      matrixDecision = 'send';
    }

    // 2) Matrix non-'send' wins (more specific user pref).
    if (matrixDecision !== 'send') return matrixDecision;

    // 3) Matrix said 'send' — consult quietService.
    const quietReason = await quietService.reasonQuiet(db, intent, channel);
    if (quietReason === 'snooze') return 'skip_snoozed';
    if (quietReason === 'quiet_hours') return 'skip_quiet_hours';
    return 'send';
  },
};
