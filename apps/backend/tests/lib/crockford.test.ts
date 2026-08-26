import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  mintPrefixedCode,
  normalizeCrockford,
  randomCrockford,
} from '../../src/lib/crockford';
import { mintCode } from '../../src/modules/marketplace/codes';

describe('crockford', () => {
  it('excludes the four ambiguous glyphs', () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const glyph of ['I', 'L', 'O', 'U']) {
      expect(CROCKFORD_ALPHABET).not.toContain(glyph);
    }
  });

  it('emits only alphabet symbols, at the requested length', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomCrockford(5);
      expect(s).toHaveLength(5);
      for (const ch of s) expect(CROCKFORD_ALPHABET).toContain(ch);
    }
  });

  it('formats a prefixed code as PREFIX-XXXXX-XXXXX', () => {
    expect(mintPrefixedCode('AMNV')).toMatch(/^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('leaves the marketplace voucher format untouched', () => {
    expect(mintCode()).toMatch(/^AMN-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('does not repeat within a large batch', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => mintPrefixedCode('AMNV')));
    expect(seen.size).toBe(5000);
  });
});

describe('normalizeCrockford', () => {
  it('uppercases a code typed in lower case', () => {
    expect(normalizeCrockford('amnv-7qk2h-9pz0r')).toBe('AMNV-7QK2H-9PZ0R');
  });

  it('folds the ambiguous glyphs onto the digits they are mistaken for', () => {
    // Excluding I, L and O from MINTING is only half the point of the alphabet; the other half is
    // accepting them on INPUT, which is what makes a code safe to read down a phone line.
    expect(normalizeCrockford('AMNV-I0K2H-9PZ0R')).toBe('AMNV-10K2H-9PZ0R');
    expect(normalizeCrockford('AMNV-L0K2H-9PZ0R')).toBe('AMNV-10K2H-9PZ0R');
    expect(normalizeCrockford('AMNV-1OK2H-9PZOR')).toBe('AMNV-10K2H-9PZ0R');
    expect(normalizeCrockford('amnv-ilo2h-9pz0r')).toBe('AMNV-1102H-9PZ0R');
  });

  it('leaves U alone — it has no digit to fold into, so it simply is not a code character', () => {
    expect(normalizeCrockford('amnv-u0k2h-9pz0r')).toBe('AMNV-U0K2H-9PZ0R');
  });

  it('does not touch the dashes — grouping is format validation, not normalization', () => {
    expect(normalizeCrockford('AMNV7QK2H9PZ0R')).toBe('AMNV7QK2H9PZ0R');
    expect(normalizeCrockford('AMNV--7QK2H-9PZ0R')).toBe('AMNV--7QK2H-9PZ0R');
    expect(normalizeCrockford(' AMNV-7QK2H-9PZ0R ')).toBe(' AMNV-7QK2H-9PZ0R ');
  });

  it('is a no-op on every code it mints — normalization can never corrupt a real code', () => {
    for (let i = 0; i < 500; i++) {
      const code = mintPrefixedCode('AMNV');
      expect(normalizeCrockford(code)).toBe(code);
    }
  });
});
