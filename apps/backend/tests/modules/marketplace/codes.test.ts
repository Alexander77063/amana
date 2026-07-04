import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mintCode, mintQrToken, verifyQrToken } from '../../../src/modules/marketplace/codes';

// Crockford base32, ambiguous chars (I, L, O, U) removed.
const CODE_RE = /^AMN-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

describe('marketplace codes', () => {
  it('mintCode returns AMN-XXXXX-XXXXX in the Crockford alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = mintCode();
      expect(code).toMatch(CODE_RE);
      // No ambiguous characters anywhere in the code.
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('mintCode is unique across 10k draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(mintCode());
    }
    expect(seen.size).toBe(10_000);
  });

  it('mintQrToken is deterministic per redemption id', () => {
    const id = randomUUID();
    expect(mintQrToken(id)).toBe(mintQrToken(id));
  });

  it('mintQrToken is unique across 10k distinct ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(mintQrToken(randomUUID()));
    }
    expect(seen.size).toBe(10_000);
  });

  it('mintQrToken yields an opaque token that does not leak the id', () => {
    const id = randomUUID();
    const token = mintQrToken(id);
    expect(token).not.toContain(id);
    expect(token.length).toBeGreaterThan(20);
  });

  it('verifyQrToken accepts a matching token and rejects forgeries', () => {
    const id = randomUUID();
    const token = mintQrToken(id);
    expect(verifyQrToken(id, token)).toBe(true);
    // Wrong id.
    expect(verifyQrToken(randomUUID(), token)).toBe(false);
    // Tampered token.
    expect(verifyQrToken(id, `${token}x`)).toBe(false);
    expect(verifyQrToken(id, 'not-a-real-token')).toBe(false);
  });
});
