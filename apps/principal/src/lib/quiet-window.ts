/** Returns the minute-of-day (0..1439) for `now` in the given IANA timezone. */
export function minuteOfDayInTz(now: Date, tz: string): number {
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

/**
 * True if `now` (in the given timezone) falls inside [startMinute, endMinute) with
 * cross-midnight semantics (when startMinute > endMinute).
 *
 * Mirrors the backend's `quietService` evaluation so the screen can preview "active now"
 * status without a server roundtrip.
 */
export function nowMinuteInWindow(
  now: Date,
  startMinute: number,
  endMinute: number,
  tz: string,
): boolean {
  const m = minuteOfDayInTz(now, tz);
  if (startMinute <= endMinute) return m >= startMinute && m < endMinute;
  return m >= startMinute || m < endMinute;
}
