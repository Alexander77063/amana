import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { prefsRepo } from './prefs.repo';
import type { ChannelPreference, NotificationChannel, NotificationIntent, NotificationKind } from './types';

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
   * Returns 'send' | 'skip_silent' | 'skip_threshold' | 'defer_digest'.
   */
  async shouldSend(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    channel: NotificationChannel,
  ): Promise<'send' | 'skip_silent' | 'skip_threshold' | 'defer_digest'> {
    const { preference, thresholdKobo } = await prefsService.getPreference(
      db,
      intent.recipientUserId,
      intent.kind,
      channel,
    );
    if (preference === 'silent') return 'skip_silent';
    if (preference === 'digest') return 'defer_digest';
    if (preference === 'threshold') {
      // Threshold semantics: send only when amount/score is at or above the threshold.
      if (intent.kind === 'anomaly_alert') {
        if (intent.anomalyScore === undefined) return 'skip_threshold';
        // Score threshold uses fixed 0.85 from spec §10 STR triggers when no per-user threshold set.
        const scoreCutoff = thresholdKobo === null ? 0.85 : Number(thresholdKobo) / 100; // store as percent×100
        return intent.anomalyScore >= scoreCutoff ? 'send' : 'skip_threshold';
      }
      if (intent.amountKobo === undefined || thresholdKobo === null) return 'skip_threshold';
      return intent.amountKobo >= thresholdKobo ? 'send' : 'skip_threshold';
    }
    return 'send';
  },
};
