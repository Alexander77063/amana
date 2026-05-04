import type { authSessions, pairingTokens, phoneOtpChallenges } from '../../db/schema';

export type OtpChallengeRow = typeof phoneOtpChallenges.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type PairingTokenRow = typeof pairingTokens.$inferSelect;

export type OtpPurpose = 'login' | 'pair';

export type AccessTokenClaims = {
  sub: string;
  role: 'principal' | 'agent';
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
