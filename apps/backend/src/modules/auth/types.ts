import type { authSessions, pairingTokens, phoneOtpChallenges } from '../../db/schema';

export type OtpChallengeRow = typeof phoneOtpChallenges.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type PairingTokenRow = typeof pairingTokens.$inferSelect;

/**
 * What an OTP challenge was minted for.
 *
 * **Adding a value here is not a one-line change.** `verifyCode` refuses a challenge whose purpose
 * is not in the caller's `allowedPurposes` (`otp.service.ts`), so every existing call site keeps
 * working — which is exactly the point, and also why a new purpose is easy to add carelessly.
 * Decide deliberately, per call site, whether it belongs in that site's allow-list; the default of
 * "no" is the safe one. `requestCode` also invalidates a phone's active challenges before inserting,
 * so a new purpose reachable from an unauthenticated endpoint can cancel someone's in-flight login
 * OTP — weigh that before exposing one.
 */
export type OtpPurpose = 'login' | 'pair';

/**
 * Who a token can speak for.
 *
 * `retailer` is the marketplace supply side (SP4b) and is deliberately a peer of the two
 * household roles, not a flag on them: a retailer owner has no household, wallet or sub-wallet,
 * so every household route must reject it by default rather than by remembering to.
 *
 * This is AUTHENTICATION only. Authorisation is always by identity against the resource's owner,
 * never by this claim — a forged role must still fail (decisions #7/#17).
 */
export const ACTOR_ROLES = ['principal', 'agent', 'retailer'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export function isActorRole(v: unknown): v is ActorRole {
  return typeof v === 'string' && (ACTOR_ROLES as readonly string[]).includes(v);
}

export type AccessTokenClaims = {
  sub: string;
  role: ActorRole;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  sessionId: string;
};
