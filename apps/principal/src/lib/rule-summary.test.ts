import { describe, expect, it } from 'vitest';
import { ruleKindLabel, summariseRule } from './rule-summary';

describe('summariseRule', () => {
  it('states a daily limit in naira, not kobo', () => {
    expect(summariseRule('limit', { windowKind: 'daily', maxKobo: '20000000' })).toBe(
      '₦200,000.00 per day',
    );
  });

  it('distinguishes a monthly limit', () => {
    expect(summariseRule('limit', { windowKind: 'monthly', maxKobo: '5000000' })).toBe(
      '₦50,000.00 per month',
    );
  });

  it('reads an allowlist as what is permitted', () => {
    expect(
      summariseRule('category', { mode: 'allowlist', categories: ['transport', 'school'] }),
    ).toBe('Only transport and school');
  });

  it('reads a blocklist as what is forbidden', () => {
    expect(summariseRule('category', { mode: 'blocklist', categories: ['airtime_data'] })).toBe(
      'Cannot spend on airtime & data',
    );
  });

  it('uses the shared category labels, so the screen cannot drift from the picker', () => {
    expect(summariseRule('category', { mode: 'allowlist', categories: ['cable_tv'] })).toContain(
      'cable',
    );
  });

  it('falls back to the raw value for a category this build does not know', () => {
    expect(summariseRule('category', { mode: 'allowlist', categories: ['spaceflight'] })).toBe(
      'Only spaceflight',
    );
  });

  it('names weekdays rather than listing five abbreviations', () => {
    expect(
      summariseRule('time_window', { startHour: 6, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] }),
    ).toBe('6am to 6pm, weekdays');
  });

  it('names weekends', () => {
    expect(summariseRule('time_window', { startHour: 9, endHour: 21, daysOfWeek: [0, 6] })).toBe(
      '9am to 9pm, weekends',
    );
  });

  it('lists the days when the set is not a common shape', () => {
    expect(summariseRule('time_window', { startHour: 8, endHour: 12, daysOfWeek: [1, 3] })).toBe(
      '8am to noon, Mon, Wed',
    );
  });

  it('says midnight and noon rather than 0am and 12pm', () => {
    expect(
      summariseRule('time_window', {
        startHour: 0,
        endHour: 12,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      }),
    ).toBe('midnight to noon, every day');
  });

  it('counts an approved-vendor list', () => {
    expect(
      summariseRule('allowlist', { accounts: [{ bankCode: '058', accountNumber: '0123456789' }] }),
    ).toBe('Only 1 approved account');
  });

  it('describes an anomaly threshold', () => {
    expect(summariseRule('anomaly_threshold', { maxScore: 80 })).toBe(
      'Hold anything scoring above 80',
    );
  });

  // A rule this build cannot describe is still being enforced against the agent. Showing the raw
  // config is ugly; showing nothing would misrepresent what the wallet is bound by.
  it('falls back to raw config for an unknown rule kind', () => {
    expect(summariseRule('future_rule', { a: 1 })).toBe('{"a":1}');
  });

  it('does not throw on a malformed config', () => {
    expect(() => summariseRule('limit', null)).not.toThrow();
    expect(() => summariseRule('category', { mode: 'allowlist' })).not.toThrow();
    expect(() => summariseRule('time_window', {})).not.toThrow();
  });

  it('handles an empty category list without claiming everything is allowed', () => {
    expect(summariseRule('category', { mode: 'allowlist', categories: [] })).toBe(
      'Nothing allowed',
    );
  });
});

describe('ruleKindLabel', () => {
  it('gives each kind a heading a parent would recognise', () => {
    expect(ruleKindLabel('limit')).toBe('Spending limit');
    expect(ruleKindLabel('time_window')).toBe('Allowed hours');
  });

  it('passes an unknown kind through unchanged', () => {
    expect(ruleKindLabel('future_rule')).toBe('future_rule');
  });
});
