import { describe, expect, it } from 'vitest';
import { type SnoozePreset, presetToExpiresAt } from './snooze-presets';

const HOUR = 60 * 60 * 1000;

describe('presetToExpiresAt', () => {
  it("'one_hour' adds 1 hour to now", () => {
    const now = new Date('2026-05-07T12:00:00Z');
    expect(presetToExpiresAt('one_hour', now)).toBe('2026-05-07T13:00:00.000Z');
  });

  it("'four_hours' adds 4 hours to now", () => {
    const now = new Date('2026-05-07T12:00:00Z');
    expect(presetToExpiresAt('four_hours', now)).toBe('2026-05-07T16:00:00.000Z');
  });

  it("'indefinite' returns null", () => {
    const now = new Date('2026-05-07T12:00:00Z');
    expect(presetToExpiresAt('indefinite', now)).toBeNull();
  });

  describe("'tomorrow_morning' (next 08:00 Africa/Lagos = 07:00 UTC)", () => {
    it('returns today 07:00 UTC when called before 08:00 Lagos', () => {
      // 06:30 Lagos = 05:30 UTC on May 7
      const now = new Date('2026-05-07T05:30:00Z');
      expect(presetToExpiresAt('tomorrow_morning', now)).toBe('2026-05-07T07:00:00.000Z');
    });

    it('returns tomorrow 07:00 UTC when called after 08:00 Lagos', () => {
      // 09:00 Lagos = 08:00 UTC on May 7
      const now = new Date('2026-05-07T08:00:00Z');
      expect(presetToExpiresAt('tomorrow_morning', now)).toBe('2026-05-08T07:00:00.000Z');
    });

    it('returns tomorrow 07:00 UTC when called exactly at 08:00 Lagos (= 07:00 UTC)', () => {
      // At exactly 08:00 Lagos, "tomorrow morning" means tomorrow.
      const now = new Date('2026-05-07T07:00:00Z');
      expect(presetToExpiresAt('tomorrow_morning', now)).toBe('2026-05-08T07:00:00.000Z');
    });

    it('crosses month boundary correctly', () => {
      // 09:00 Lagos on May 31 = 08:00 UTC May 31
      const now = new Date('2026-05-31T08:00:00Z');
      expect(presetToExpiresAt('tomorrow_morning', now)).toBe('2026-06-01T07:00:00.000Z');
    });
  });
});
