import { describe, expect, it } from 'vitest';
import { maskAccount } from '../../src/lib/mask-account';

describe('maskAccount', () => {
  it('returns null when input is null', () => {
    expect(maskAccount(null)).toBeNull();
  });

  it('masks a 10-digit NUBAN to last 4', () => {
    expect(maskAccount('0123456789')).toBe('***6789');
  });

  it('passes through short strings prefixed with ***', () => {
    expect(maskAccount('12')).toBe('***12');
    expect(maskAccount('1234')).toBe('***1234');
  });

  it('handles empty string by returning null (treat as missing)', () => {
    expect(maskAccount('')).toBeNull();
  });
});
