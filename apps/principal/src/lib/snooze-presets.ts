// FORWARD: 'custom' preset opens a date/time picker — see 6b-5 spec §6a
export type SnoozePreset = 'one_hour' | 'four_hours' | 'tomorrow_morning' | 'indefinite';

const HOUR_MS = 60 * 60 * 1000;
const TOMORROW_MORNING_HOUR_LAGOS = 8;

/**
 * Converts a preset choice to an ISO8601 expiry string (or null for indefinite).
 * `now` is parameterized so the function stays pure and the tests don't need fake timers.
 *
 * 'tomorrow_morning' targets the next 08:00 in Africa/Lagos (UTC+1, no DST).
 * At exactly 08:00, today's morning has already passed — return tomorrow's.
 */
export function presetToExpiresAt(preset: SnoozePreset, now: Date): string | null {
  if (preset === 'indefinite') return null;
  if (preset === 'one_hour') return new Date(now.getTime() + HOUR_MS).toISOString();
  if (preset === 'four_hours') return new Date(now.getTime() + 4 * HOUR_MS).toISOString();

  // 'tomorrow_morning' — find the next 08:00 in Africa/Lagos.
  const lagosHour = lagosHourOf(now);
  // Today's 08:00 Lagos = today's 07:00 UTC.
  const ymd = utcYmdForLagosToday(now);
  const todayMorningUtc = new Date(
    Date.UTC(ymd.y, ymd.m, ymd.d, TOMORROW_MORNING_HOUR_LAGOS - 1, 0, 0),
  );
  if (lagosHour < TOMORROW_MORNING_HOUR_LAGOS) {
    return todayMorningUtc.toISOString();
  }
  return new Date(todayMorningUtc.getTime() + 24 * HOUR_MS).toISOString();
}

function lagosHourOf(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    hour12: false,
  });
  return Number.parseInt(fmt.format(d), 10) % 24;
}

function utcYmdForLagosToday(d: Date): { y: number; m: number; d: number } {
  // Lagos = UTC+1. The Lagos calendar date is the UTC calendar date of (UTC + 1h).
  const lagosNow = new Date(d.getTime() + 60 * 60 * 1000);
  return {
    y: lagosNow.getUTCFullYear(),
    m: lagosNow.getUTCMonth(),
    d: lagosNow.getUTCDate(),
  };
}
