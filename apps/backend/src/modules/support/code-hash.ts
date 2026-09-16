import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';

/**
 * Domain-separated subkey derived from `FIELD_ENCRYPTION_KEY`, following the same pattern as
 * `modules/marketplace/codes.ts`.
 *
 * Deriving rather than using the field key directly means this use can never collide with at-rest
 * field encryption, and compromise of one does not hand over the other.
 */
function supportCodeSecret(): Buffer {
  const fieldKey = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');
  return createHmac('sha256', fieldKey).update('amana:support:verification-code:v1').digest();
}

/**
 * HMAC rather than a bare digest: the space of six-digit codes is a million entries, which is
 * trivially rainbow-tabled from an unkeyed hash.
 */
export function hashCode(code: string): string {
  return createHmac('sha256', supportCodeSecret()).update(code).digest('hex');
}

/** Constant-time compare, so a wrong code cannot be narrowed by timing the response. */
export function codeMatches(code: string, hash: string): boolean {
  const a = Buffer.from(hashCode(code), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
