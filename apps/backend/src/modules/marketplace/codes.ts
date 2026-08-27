import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';
import { mintPrefixedCode } from '../../lib/crockford';

/**
 * Mint a human-typable single-use voucher code, e.g. `AMN-7QK2H-9PZ0R`. The DB `code` UNIQUE
 * constraint is the authoritative dedup at write time (the service retries on clash).
 */
export function mintCode(): string {
  return mintPrefixedCode('AMN');
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
