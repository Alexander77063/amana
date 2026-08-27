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

/**
 * Fold a human-typed code onto the form we mint, so a lookup can compare it byte for byte.
 *
 * Dropping I, L, O and U from the alphabet is only half of what the alphabet is for. Minting
 * without them means we never PRODUCE an ambiguous glyph; accepting them on input means we never
 * REJECT someone who read the code off a shop window, or heard it down a phone line, and typed
 * the letter they saw. Crockford's own spec decodes both halves, and a code that only works when
 * transcribed perfectly is not the code we designed.
 *
 * - Upper-cases, because `=` in Postgres is case-sensitive and every minted code is upper-case.
 * - `I` and `L` fold to `1`; `O` folds to `0` — the digit each is mistaken for.
 * - `U` is left alone deliberately. It is excluded from the alphabet with no digit to fold into,
 *   so a `U` is simply not a code character and must miss rather than be coerced into a hit.
 *
 * Dashes are untouched, and a code missing them is NOT repaired here: grouping is format
 * validation, and a malformed code should 400 at the route rather than silently resolve.
 *
 * Safe on every code we mint — the alphabet contains none of the folded glyphs, so normalizing a
 * real code is a no-op, prefix included (`AMNV` and `AMN` have no I/L/O either).
 */
export function normalizeCrockford(code: string): string {
  return code.toUpperCase().replace(/[ILO]/g, (ch) => (ch === 'O' ? '0' : '1'));
}
