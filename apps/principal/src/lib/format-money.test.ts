import { describe, expect, it } from 'vitest';
import { formatNaira } from './format-money';

describe('formatNaira', () => {
  it('formats a whole-naira kobo amount with grouping and 2 decimals', () => {
    expect(formatNaira('482000')).toBe('₦4,820.00');
  });

  it('formats a small fee', () => {
    expect(formatNaira('5000')).toBe('₦50.00');
  });

  it('formats zero', () => {
    expect(formatNaira('0')).toBe('₦0.00');
  });

  it('keeps sub-naira precision', () => {
    expect(formatNaira('12345')).toBe('₦123.45');
  });
});
