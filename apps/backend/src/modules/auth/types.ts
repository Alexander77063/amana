import type { authSessions, pairingTokens, phoneOtpChallenges } from '../../db/schema';

export type OtpChallengeRow = typeof phoneOtpChallenges.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type PairingTokenRow = typeof pairingTokens.$inferSelect;

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
