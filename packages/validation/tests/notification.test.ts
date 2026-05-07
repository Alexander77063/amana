import { describe, expect, it } from 'vitest';
import { QuietHoursSchema } from '../src/notification';

describe('QuietHoursSchema', () => {
  it('accepts a valid quiet-hours window', () => {
    expect(
      QuietHoursSchema.safeParse({ enabled: true, startMinute: 1320, endMinute: 420 }).success,
    ).toBe(true);
  });
  it('accepts an enabled=false row with valid times', () => {
    expect(
      QuietHoursSchema.safeParse({ enabled: false, startMinute: 0, endMinute: 1 }).success,
    ).toBe(true);
  });
  it('rejects startMinute === endMinute', () => {
    expect(
      QuietHoursSchema.safeParse({ enabled: true, startMinute: 600, endMinute: 600 }).success,
    ).toBe(false);
  });
  it('rejects negative minutes', () => {
    expect(
      QuietHoursSchema.safeParse({ enabled: true, startMinute: -1, endMinute: 600 }).success,
    ).toBe(false);
  });
  it('rejects endMinute >= 1440', () => {
    expect(
      QuietHoursSchema.safeParse({ enabled: true, startMinute: 0, endMinute: 1440 }).success,
    ).toBe(false);
  });
  it('rejects non-integer minutes', () => {
    expect(
      QuietHoursSchema.safeParse({ enabled: true, startMinute: 1.5, endMinute: 600 }).success,
    ).toBe(false);
  });
  it('rejects missing fields', () => {
    expect(QuietHoursSchema.safeParse({ enabled: true, startMinute: 60 }).success).toBe(false);
  });
});
