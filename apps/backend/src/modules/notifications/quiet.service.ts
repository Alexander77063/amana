import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { quietHoursRepo } from './quiet-hours.repo';
import { subwalletSnoozeRepo } from './subwallet-snooze.repo';
import type { NotificationChannel, NotificationIntent, NotificationKind } from './types';

const QUIET_TZ = 'Africa/Lagos'; // FORWARD: per-user TZ in user_quiet_hours.timezone — see 6b-5 spec §6a
const BREAKTHROUGH_KINDS: NotificationKind[] = [
  // FORWARD: user-configurable list (user_breakthrough_kinds) — see 6b-5 spec §6a
  'anomaly_alert',
  'bump_requested',
];

/** Returns the current minute-of-day (0..1439) in the given IANA timezone. */
export function nowMinuteInTz(now: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.format(now); // "HH:MM"
  const [h, m] = parts.split(':').map(Number);
  return ((h ?? 0) % 24) * 60 + (m ?? 0);
}

/** True if `minute` falls inside [startMinute, endMinute) with cross-midnight semantics. */
export function minuteInWindow(
  minute: number,
  startMinute: number,
  endMinute: number,
): boolean {
  if (startMinute <= endMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute;
}

export const quietService = {
  /** null = not quiet. Reason ∈ { 'snooze' | 'quiet_hours' } when quiet. */
  async reasonQuiet(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    channel: NotificationChannel,
  ): Promise<'snooze' | 'quiet_hours' | null> {
    if (channel === 'in_app') return null;
    if (BREAKTHROUGH_KINDS.includes(intent.kind)) return null;

    if (
      intent.subWalletId &&
      (await subwalletSnoozeRepo.isActive(db, intent.recipientUserId, intent.subWalletId))
    ) {
      return 'snooze';
    }

    const qh = await quietHoursRepo.get(db, intent.recipientUserId);
    if (qh?.enabled) {
      const now = nowMinuteInTz(new Date(), QUIET_TZ);
      if (minuteInWindow(now, qh.startMinute, qh.endMinute)) {
        return 'quiet_hours';
      }
    }
    return null;
  },
};
