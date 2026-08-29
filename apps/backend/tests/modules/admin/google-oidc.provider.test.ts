// apps/backend/tests/modules/admin/google-oidc.provider.test.ts
//
// The real provider, exercised without touching Google. Its `fetch` and its key set are both
// injectable, so an ID token can be signed here with a throwaway key pair and put through exactly
// the verification production runs. Everything the service trusts is asserted by this file: if
// the signature, issuer, audience or nonce checks were dropped, these tests are what notices.
import { SignJWT, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGoogleOidcProvider } from '../../../src/modules/admin/oidc/google-oidc.provider';

const CLIENT_ID = 'amana-admin-portal.apps.googleusercontent.com';
const ISSUER = 'https://accounts.google.com';

let signId: (claims: Record<string, unknown>, overrides?: { issuer?: string }) => Promise<string>;
let keySet: Parameters<typeof createGoogleOidcProvider>[0]['keySet'];

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  // A local stand-in for Google's published JWKS: one key, always returned.
  keySet = async () => publicKey;

  signId = async (claims, overrides) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(overrides?.issuer ?? ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
});

function providerWith(idToken: string | null, tokenStatus = 200) {
  const calls: { url: string; body: string }[] = [];
  const provider = createGoogleOidcProvider({
    clientId: CLIENT_ID,
    clientSecret: 'test-secret',
    redirectUri: 'https://admin.amana-ng.com/admin/auth/callback',
    keySet,
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify(idToken ? { id_token: idToken } : { error: 'bad' }), {
        status: tokenStatus,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
  return { provider, calls };
}

describe('createGoogleOidcProvider', () => {
  it('builds an authorization URL with the parameters Google requires', () => {
    const { provider } = providerWith(null);
    const url = new URL(
      provider.authorizationUrl({ state: 'st', nonce: 'no', codeChallenge: 'ch' }),
    );

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('no');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('email');
    // Ask Google to restrict the account chooser to the Workspace. A hint, not a control — the
    // `hd` claim is still verified — but it stops staff picking a personal account by accident.
    expect(url.searchParams.get('hd')).toBeTruthy();
  });

  it('exchanges a code and returns the verified identity', async () => {
    const idToken = await signId({
      sub: 'g-1',
      email: 'david@amana-ng.com',
      email_verified: true,
      hd: 'amana-ng.com',
      name: 'David',
      nonce: 'the-nonce',
    });
    const { provider, calls } = providerWith(idToken);

    const identity = await provider.exchangeCode({
      code: 'auth-code',
      codeVerifier: 'the-verifier',
      nonce: 'the-nonce',
    });

    expect(identity).toEqual({
      subject: 'g-1',
      email: 'david@amana-ng.com',
      emailVerified: true,
      hostedDomain: 'amana-ng.com',
      name: 'David',
    });
    // PKCE verifier and the secret go in the POST body, never a query string.
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]?.body).toContain('code_verifier=the-verifier');
    expect(calls[0]?.body).toContain('grant_type=authorization_code');
  });

  it('rejects an ID token whose nonce is not the one we issued', async () => {
    const idToken = await signId({
      sub: 'g-1',
      email: 'david@amana-ng.com',
      email_verified: true,
      hd: 'amana-ng.com',
      nonce: 'a-different-nonce',
    });
    const { provider } = providerWith(idToken);

    // Without this check a token minted for another login could be replayed into ours.
    await expect(
      provider.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'the-nonce' }),
    ).rejects.toThrow(/nonce/i);
  });

  it('rejects an ID token from the wrong issuer', async () => {
    const idToken = await signId(
      { sub: 'g-1', email: 'x@amana-ng.com', email_verified: true, nonce: 'n' },
      { issuer: 'https://evil.example.com' },
    );
    const { provider } = providerWith(idToken);

    await expect(
      provider.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'n' }),
    ).rejects.toThrow();
  });

  it('rejects a token endpoint that does not return an ID token', async () => {
    const { provider } = providerWith(null, 400);

    await expect(
      provider.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'n' }),
    ).rejects.toThrow();
  });

  it('reports a missing hosted domain as absent rather than inventing one', async () => {
    // A personal Google account has no `hd`. The provider must pass that fact through untouched:
    // the service refuses on it, and a provider that defaulted it to the Workspace domain would
    // silently disable the check that keeps strangers out.
    const idToken = await signId({
      sub: 'g-2',
      email: 'someone@gmail.com',
      email_verified: true,
      nonce: 'n',
    });
    const { provider } = providerWith(idToken);

    const identity = await provider.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'n' });
    expect(identity.hostedDomain).toBeNull();
    expect(identity.name).toBeNull();
  });
});
