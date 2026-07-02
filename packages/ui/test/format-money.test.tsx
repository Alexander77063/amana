import { describe, expect, it } from 'vitest';
import { formatNaira } from '../src/format/money';

describe('formatNaira', () => {
  it('formats with grouping and 2 decimals', () => {
    expect(formatNaira('482000')).toBe('₦4,820.00');
    expect(formatNaira('5000')).toBe('₦50.00');
    expect(formatNaira('0')).toBe('₦0.00');
    expect(formatNaira('12345')).toBe('₦123.45');
  });

  it('is exact above 2^53 kobo (BigInt, no float coercion)', () => {
    expect(formatNaira('900719925474099999')).toBe('₦9,007,199,254,740,999.99');
  });
});
