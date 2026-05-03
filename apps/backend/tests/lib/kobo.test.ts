import { describe, expect, it } from 'vitest';
import {
  fromNairaString,
  type Kobo,
  kobo,
  toNairaString,
  zeroKobo,
} from '../../src/lib/kobo';

describe('kobo', () => {
  it('kobo() brands a bigint', () => {
    const k: Kobo = kobo(15000n);
    expect(k).toBe(15000n);
  });

  it('zeroKobo is 0n', () => {
    expect(zeroKobo).toBe(0n);
  });

  it('fromNairaString parses with kobo precision', () => {
    expect(fromNairaString('150.00')).toBe(15000n);
    expect(fromNairaString('150.5')).toBe(15050n);
    expect(fromNairaString('0.01')).toBe(1n);
    expect(fromNairaString('1000')).toBe(100000n);
  });

  it('fromNairaString rejects more than 2 decimals', () => {
    expect(() => fromNairaString('1.234')).toThrow(/decimals/);
  });

  it('fromNairaString rejects negative input', () => {
    expect(() => fromNairaString('-1.00')).toThrow(/negative/);
  });

  it('toNairaString formats with NGN comma grouping and 2 decimals', () => {
    expect(toNairaString(kobo(15000n))).toBe('150.00');
    expect(toNairaString(kobo(150050n))).toBe('1,500.50');
    expect(toNairaString(kobo(1n))).toBe('0.01');
    expect(toNairaString(kobo(100000000n))).toBe('1,000,000.00');
  });
});
