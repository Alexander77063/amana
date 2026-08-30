import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../../env';
import type { OidcIdentity, OidcProvider } from './types';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

export type GoogleOidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** The Workspace domain sent as Google's `hd` hint on the consent screen. */
  hostedDomainHint?: string;
  /**
   * Where the signing keys come from. Defaults to Google's published JWKS, which `jose` caches
   * and refreshes on its own. Injectable so the verification path can be tested against a
   * throwaway key pair instead of the internet.
   */
  keySet?: JWTVerifyGetKey;
  fetchImpl?: typeof fetch;
};

/** Google returns `email_verified` as a boolean, but has historically also sent the string. */
function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The production OIDC provider: Google Workspace, authorization-code flow with PKCE.
 *
 * It does two things and refuses to do a third. It builds the redirect, and it turns a code into
 * a *verified* identity — signature, issuer, audience, expiry and nonce all checked before any
 * claim is returned. What it does not do is decide anything: whether an address may sign in is
 * `admin-identity.service.ts`'s call. Keeping the judgement out of here is what makes the stub in
 * tests a faithful substitute rather than a shortcut past the real rules.
 */
export function createGoogleOidcProvider(config: GoogleOidcConfig): OidcProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const keySet = config.keySet ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

  return {
    authorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      // A hint only: it pre-filters the account chooser to the Workspace so staff do not pick a
      // personal account by mistake. It is not a control — anyone can edit a URL — which is why
      // the `hd` CLAIM is verified independently after the exchange.
      url.searchParams.set('hd', config.hostedDomainHint ?? env.ADMIN_WORKSPACE_DOMAIN);
      // Force the account chooser rather than silently reusing whichever Google session the
      // browser already has. Staff machines are shared more often than staff admit.
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier, nonce }): Promise<OidcIdentity> {
      const body = new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      });

      const response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        // Deliberately does not include the response body: it echoes the authorization code.
        throw new Error(`google token exchange failed: ${response.status}`);
      }

      const payload = (await response.json()) as { id_token?: unknown };
      const idToken = asStringOrNull(payload.id_token);
      if (!idToken) throw new Error('google token exchange returned no id_token');

      // Signature, issuer, audience and expiry. `jose` throws on any of them, and the caller
      // treats a throw as a refused sign-in.
      const { payload: claims } = await jwtVerify(idToken, keySet, {
        issuer: GOOGLE_ISSUER,
        audience: config.clientId,
      });

      // The nonce is checked here rather than left to the caller: it is the only defence against
      // an ID token minted for a different login being replayed into this one, and a check that
      // every caller must remember is a check that one caller will forget.
      if (claims.nonce !== nonce) {
        throw new Error('google id_token nonce mismatch');
      }

      const email = asStringOrNull(claims.email);
      if (!email) throw new Error('google id_token carried no email');
      if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        throw new Error('google id_token carried no subject');
      }

      return {
        subject: claims.sub,
        email,
        emailVerified: asBoolean(claims.email_verified),
        hostedDomain: asStringOrNull(claims.hd),
        name: asStringOrNull(claims.name),
      };
    },
  };
}
