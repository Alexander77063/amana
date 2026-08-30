/**
 * The identity an OIDC provider asserts, reduced to the claims this codebase actually decides on.
 *
 * Everything here comes from a verified ID token. A provider implementation that returns claims it
 * has not verified (signature, issuer, audience, expiry, nonce) breaks every check downstream,
 * because the service layer trusts this object completely.
 */
export type OidcIdentity = {
  /** Google's `sub` — stable for the life of the account, unlike the email. */
  subject: string;
  email: string;
  emailVerified: boolean;
  /**
   * Google's `hd` (hosted domain) claim: present only for Workspace accounts, and asserted by
   * Google rather than by the user. A personal gmail.com account that happens to have set its
   * address to look like a Workspace one has no `hd`, which is why this is checked separately
   * from the email's domain.
   */
  hostedDomain: string | null;
  name: string | null;
};

export type AuthorizationUrlInput = {
  state: string;
  nonce: string;
  codeChallenge: string;
};

export type ExchangeCodeInput = {
  code: string;
  codeVerifier: string;
  /** Must match the `nonce` claim in the returned ID token, or the exchange must throw. */
  nonce: string;
};

/**
 * The seam that lets Task 1 ship before the `amana-ng.com` Workspace tenant exists.
 *
 * Tests inject a stub; `google-oidc.provider.ts` is the real one. The service layer never
 * imports the Google implementation directly — it takes a provider, so there is no code path
 * where a test accidentally reaches the network or production accidentally reaches a stub.
 */
export interface OidcProvider {
  authorizationUrl(input: AuthorizationUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<OidcIdentity>;
}
