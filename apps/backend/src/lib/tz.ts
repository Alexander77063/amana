/**
 * Wall-clock helpers in a named IANA timezone.
 *
 * Rules that a human sets in the app ("no spending before 6am", "weekdays only") must be
 * evaluated in the household's local wall clock, not UTC. Nigeria is UTC+1 year-round, so a
 * UTC evaluation silently shifts every window an hour later than the parent set it.
 *
 * `Intl.DateTimeFormat` is used rather than a fixed offset so this stays correct if Amana ever
 * operates outside WAT — and it is the same mechanism `notifications/quiet.service.ts` already
 * uses for quiet hours, so the product has one definition of "local time", not two.
 */

/** The household's wall clock. Nigeria only, for now — see MONEY_TZ usage sites. */
export const MONEY_TZ = 'Africa/Lagos';

/** Hour of day (0..23) at `at`, in `tz`. */
export function hourInTz(at: Date, tz: string = MONEY_TZ): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).format(at);
  // en-GB renders midnight as "24" in some ICU versions; normalise it to 0.
  return Number(hour) % 24;
}

/** Day of week at `at` in `tz`, using the same 0=Sunday convention as `Date.getUTCDay()`. */
export function weekdayInTz(at: Date, tz: string = MONEY_TZ): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const index = days.indexOf(name);
  if (index < 0) throw new Error(`unrecognised weekday "${name}" for tz ${tz}`);
  return index;
}
