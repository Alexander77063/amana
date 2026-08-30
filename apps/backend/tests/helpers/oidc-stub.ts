import type { OidcIdentity, OidcProvider } from '../../src/modules/admin/oidc/types';

export type StubOidcOptions = {
  /** The identity the stub returns for any code it is handed. */
  identity?: Partial<OidcIdentity>;
  /** Make the exchange throw, as a real provider does on a bad code or a failed signature check. */
  failWith?: Error;
};

/**
 * An `OidcProvider` that never talks to Google.
 *
 * The whole point of the provider seam: Task 1 has to be buildable and testable before the
 * `amana-ng.com` Workspace tenant exists. Everything the service decides — domain enforcement,
 * provisioning, suspension, subject binding — is decided on the claims, so a stub that returns
 * claims exercises all of it.
 */
export function stubOidcProvider(options: StubOidcOptions = {}): OidcProvider & {
  calls: { code: string; codeVerifier: string; nonce: string }[];
} {
  const calls: { code: string; codeVerifier: string; nonce: string }[] = [];
  return {
    calls,
    authorizationUrl(input) {
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.searchParams.set('state', input.state);
      u.searchParams.set('nonce', input.nonce);
      u.searchParams.set('code_challenge', input.codeChallenge);
      return u.toString();
    },
    async exchangeCode(input) {
      calls.push(input);
      if (options.failWith) throw options.failWith;
      return {
        subject: 'google-subject-1',
        email: 'david@amana-ng.com',
        emailVerified: true,
        hostedDomain: 'amana-ng.com',
        name: 'David',
        ...options.identity,
      };
    },
  };
}
