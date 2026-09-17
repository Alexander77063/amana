/**
 * Who a session speaks for. `retailer` is the marketplace supply side (SP4b) — a peer of the
 * household roles, not a flag on them: a retailer owner has no household, wallet or sub-wallet.
 */
export type Role = 'principal' | 'agent' | 'retailer';
export type KycTier = '1' | '2' | '3';
export type UserStatus = 'active' | 'suspended';
export type OtpPurpose = 'login' | 'pair';

export type User = {
  id: string;
  role: Role;
  phone: string;
  kycTier: KycTier;
  status?: UserStatus;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export type LoginResponse = IssuedTokens & { user: User };

/**
 * The terms + privacy notice version a client must state it displayed when a call CREATES a user.
 *
 * Shared rather than defined per side, and that is the whole point. The backend began requiring
 * `acceptedTermsVersion` at signup on 2026-08-27; no client was ever updated, so every new signup
 * was refused with `terms_not_accepted`. Nothing caught it: each side was internally consistent,
 * returning users log in on a branch that never reaches the check, and no unit test spans the two.
 * One constant, imported by both, is what stops that recurring — bump it here and the apps and the
 * server move together or fail to compile.
 *
 * Bumping it is a deliberate act: acceptance is recorded against the version, so a new value means
 * existing users are asked to accept again. See `userConsentService` for how that is stored.
 */
export const PRINCIPAL_TERMS_VERSION = '2026-08-27.v1';
export const AGENT_TERMS_VERSION = '2026-08-27.v1';

export function requiredTermsVersion(role: 'principal' | 'agent'): string {
  return role === 'principal' ? PRINCIPAL_TERMS_VERSION : AGENT_TERMS_VERSION;
}
