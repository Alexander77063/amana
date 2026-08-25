import { randomBytes } from 'node:crypto';

/**
 * Crockford base32 with the ambiguous glyphs (I, L, O, U) removed — 32 symbols, so a random byte
 * masked with & 31 selects one with no modulo bias.
 *
 * Shared rather than duplicated: the marketplace mints voucher codes (`AMN-`) and the registry
 * mints vendor codes (`AMNV-`), and both are read aloud down a phone line by someone who must not
 * confuse a 1 for an I.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CODE_GROUP_LEN = 5;

export function randomCrockford(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CROCKFORD_ALPHABET.charAt((bytes[i] ?? 0) & 31);
  }
  return out;
}

/**
 * `PREFIX-XXXXX-XXXXX`. Two 5-symbol groups give 32^10 ≈ 1.1e15 of entropy — collisions across a
 * 10k batch are ~4e-8, and the caller's UNIQUE constraint is the authoritative dedup at write time.
 */
export function mintPrefixedCode(prefix: string): string {
  return `${prefix}-${randomCrockford(CODE_GROUP_LEN)}-${randomCrockford(CODE_GROUP_LEN)}`;
}
