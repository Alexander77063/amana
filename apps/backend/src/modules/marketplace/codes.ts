import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';

// Crockford base32 alphabet with the ambiguous glyphs (I, L, O, U) removed — 32 symbols,
// so a random byte masked with & 31 selects one with no modulo bias.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_GROUP_LEN = 5;

function randomCrockford(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CROCKFORD.charAt((bytes[i] ?? 0) & 31);
  }
  return out;
}

/**
 * Mint a human-typable single-use voucher code, e.g. `AMN-7QK2H-9PZ0R`. Two 5-symbol Crockford
 * groups give 32^10 ≈ 1.1e15 of entropy — collisions across a 10k batch are ~4e-8, and the DB
 * `code` UNIQUE constraint is the authoritative dedup at write time (service retries on clash).
 */
export function mintCode(): string {
  return `AMN-${randomCrockford(CODE_GROUP_LEN)}-${randomCrockford(CODE_GROUP_LEN)}`;
}

// Domain-separated subkey derived from FIELD_ENCRYPTION_KEY so a QR token can't be forged
// without the server secret, and this use can never collide with the at-rest field-crypto key.
function qrSecret(): Buffer {
  const fieldKey = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');
  return createHmac('sha256', fieldKey).update('amana:marketplace:qr-token:v1').digest();
}

/**
 * Opaque, unforgeable QR token bound to a redemption id: HMAC-SHA256(id) under the derived
 * secret, base64url-encoded. Deterministic per id (so it can be recomputed) but not reversible
 * and not producible without the secret.
 */
export function mintQrToken(redemptionId: string): string {
  return createHmac('sha256', qrSecret()).update(redemptionId).digest('base64url');
}

/** Constant-time check that `token` is the QR token minted for `redemptionId`. */
export function verifyQrToken(redemptionId: string, token: string): boolean {
  const expected = Buffer.from(mintQrToken(redemptionId));
  const provided = Buffer.from(token);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
