import { describe, expect, it } from 'vitest';
import { CROCKFORD_ALPHABET, mintPrefixedCode, randomCrockford } from '../../src/lib/crockford';
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
