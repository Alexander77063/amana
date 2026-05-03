import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { evaluateTimeWindow } from '../../../../src/modules/rules/evaluators/time-window';
import type { TimeWindowRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';

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
    expect(evaluateTimeWindow(cfg(), intent('2026-05-03T12:00:00Z'))).toBeNull();
  });

  it('denies before window start', () => {
    const r = evaluateTimeWindow(cfg(), intent('2026-05-03T05:30:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('denies at or after window end (end is exclusive)', () => {
    const r = evaluateTimeWindow(cfg(), intent('2026-05-03T22:00:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('denies on disallowed day-of-week', () => {
    // 2026-05-03 is a Sunday (day 0)
    const c = cfg({ daysOfWeek: [1, 2, 3, 4, 5] });
    const r = evaluateTimeWindow(c, intent('2026-05-03T12:00:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('handles wraparound windows (e.g. 22-06 overnight)', () => {
    const c = cfg({ startHour: 22, endHour: 6 });
    expect(evaluateTimeWindow(c, intent('2026-05-03T23:00:00Z'))).toBeNull();
    expect(evaluateTimeWindow(c, intent('2026-05-03T03:00:00Z'))).toBeNull();
    expect(evaluateTimeWindow(c, intent('2026-05-03T12:00:00Z'))?.code).toBe('OUTSIDE_TIME_WINDOW');
  });
});
