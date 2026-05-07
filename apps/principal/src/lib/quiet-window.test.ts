import { describe, expect, it } from 'vitest';
import { nowMinuteInWindow } from './quiet-window';

function lagosDate(h: number, m: number): Date {
  // UTC = Lagos - 1h
  return new Date(Date.UTC(2026, 4, 7, h - 1, m, 0));
}

describe('nowMinuteInWindow (Africa/Lagos)', () => {
  describe('cross-midnight 22:00 → 07:00', () => {
    it('false at 21:59', () => {
      expect(nowMinuteInWindow(lagosDate(21, 59), 1320, 420, 'Africa/Lagos')).toBe(false);
    });
    it('true at 22:00', () => {
      expect(nowMinuteInWindow(lagosDate(22, 0), 1320, 420, 'Africa/Lagos')).toBe(true);
    });
    it('true at 03:00', () => {
      expect(nowMinuteInWindow(lagosDate(3, 0), 1320, 420, 'Africa/Lagos')).toBe(true);
    });
    it('true at 06:59', () => {
      expect(nowMinuteInWindow(lagosDate(6, 59), 1320, 420, 'Africa/Lagos')).toBe(true);
    });
    it('false at 07:00', () => {
      expect(nowMinuteInWindow(lagosDate(7, 0), 1320, 420, 'Africa/Lagos')).toBe(false);
    });
  });

  describe('non-cross-midnight 13:00 → 14:00', () => {
    it('false at 12:59', () => {
      expect(nowMinuteInWindow(lagosDate(12, 59), 780, 840, 'Africa/Lagos')).toBe(false);
    });
    it('true at 13:00', () => {
      expect(nowMinuteInWindow(lagosDate(13, 0), 780, 840, 'Africa/Lagos')).toBe(true);
    });
    it('true at 13:30', () => {
      expect(nowMinuteInWindow(lagosDate(13, 30), 780, 840, 'Africa/Lagos')).toBe(true);
    });
    it('false at 14:00', () => {
      expect(nowMinuteInWindow(lagosDate(14, 0), 780, 840, 'Africa/Lagos')).toBe(false);
    });
  });
});
