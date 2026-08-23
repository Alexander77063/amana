import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { evaluateTimeWindow } from '../../../../src/modules/rules/evaluators/time-window';
import type { TimeWindowRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';

// Windows are evaluated on the household's wall clock (Africa/Lagos, UTC+1 year-round), not
// UTC — a parent who blocks spending before 6am means 6am where they live. Every timestamp
// below is written as UTC with the Lagos equivalent in a comment, so the intent stays obvious.
const intent = (iso: string): TxnIntent => ({
  amountKobo: kobo(0n),
  category: null,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date(iso),
});

const cfg = (overrides: Partial<TimeWindowRuleConfig> = {}): TimeWindowRuleConfig => ({
  startHour: 6,
  endHour: 22,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  ...overrides,
});

describe('evaluateTimeWindow', () => {
  it('allows mid-window', () => {
    // 13:00 Lagos
    expect(evaluateTimeWindow(cfg(), intent('2026-05-03T12:00:00Z'))).toBeNull();
  });

  it('denies before window start', () => {
    // 05:30 Lagos — before a 06:00 start
    const r = evaluateTimeWindow(cfg(), intent('2026-05-03T04:30:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('allows exactly at window start (start is inclusive)', () => {
    // 06:00 Lagos
    expect(evaluateTimeWindow(cfg(), intent('2026-05-03T05:00:00Z'))).toBeNull();
  });

  it('denies at or after window end (end is exclusive)', () => {
    // 22:00 Lagos
    const r = evaluateTimeWindow(cfg(), intent('2026-05-03T21:00:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  // The regression that motivated moving off UTC: this instant is 05:30 UTC but 06:30 in
  // Lagos. Under the old UTC evaluation it was denied, an hour after the parent's window had
  // actually opened.
  it('uses Lagos wall clock, not UTC, at the boundary', () => {
    expect(evaluateTimeWindow(cfg(), intent('2026-05-03T05:30:00Z'))).toBeNull();
  });

  it('denies on disallowed day-of-week', () => {
    // 2026-05-03 is a Sunday (day 0); 13:00 Lagos, still Sunday
    const c = cfg({ daysOfWeek: [1, 2, 3, 4, 5] });
    const r = evaluateTimeWindow(c, intent('2026-05-03T12:00:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  // 23:30 UTC on Saturday is already 00:30 Sunday in Lagos, so the day-of-week check has to
  // roll over with the local clock too — not just the hour.
  it('rolls the day over on the Lagos clock', () => {
    const weekdaysOnly = cfg({ daysOfWeek: [1, 2, 3, 4, 5], startHour: 0, endHour: 23 });
    // Saturday 2026-05-02 23:30Z = Sunday 00:30 Lagos → still a weekend, denied
    expect(evaluateTimeWindow(weekdaysOnly, intent('2026-05-02T23:30:00Z'))?.code).toBe(
      'OUTSIDE_TIME_WINDOW',
    );
    // Sunday 2026-05-03 23:30Z = Monday 00:30 Lagos → a weekday, allowed
    expect(evaluateTimeWindow(weekdaysOnly, intent('2026-05-03T23:30:00Z'))).toBeNull();
  });

  it('handles wraparound windows (e.g. 22-06 overnight)', () => {
    const c = cfg({ startHour: 22, endHour: 6 });
    expect(evaluateTimeWindow(c, intent('2026-05-03T22:00:00Z'))).toBeNull(); // 23:00 Lagos
    expect(evaluateTimeWindow(c, intent('2026-05-03T03:00:00Z'))).toBeNull(); // 04:00 Lagos
    expect(evaluateTimeWindow(c, intent('2026-05-03T12:00:00Z'))?.code).toBe('OUTSIDE_TIME_WINDOW'); // 13:00 Lagos
  });
});
