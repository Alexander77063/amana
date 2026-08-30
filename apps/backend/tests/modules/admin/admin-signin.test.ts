// apps/backend/tests/modules/admin/admin-signin.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { adminIdentityService } from '../../../src/modules/admin/admin-identity.service';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { stubOidcProvider } from '../../helpers/oidc-stub';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('admin sign-in', () => {
  beforeEach(async () => {
    await truncateAll();
    await adminIdentityService.ensureBootstrapOwner(testDb);
  });

  it('startLogin returns an authorization URL carrying the state it persisted', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);

    expect(started.authorizationUrl).toContain('accounts.google.com');
    const url = new URL(started.authorizationUrl);
    expect(url.searchParams.get('state')).toBe(started.state);
    // PKCE: the challenge travels to Google, the verifier never leaves us.
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(started.authorizationUrl).not.toContain('code_verifier');
  });

  it('signs in the seeded owner and binds their Google subject on first sign-in', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);

    const result = await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'google-auth-code',
    });

    expect(result.kind).toBe('signed_in');
    if (result.kind !== 'signed_in') return;
    expect(result.adminUser.email).toBe('david@amana-ng.com');
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const owner = await adminUsersRepo.findByEmail(testDb, 'david@amana-ng.com');
    expect(owner?.googleSubject).toBe('google-subject-1');
    expect(owner?.lastSignedInAt).not.toBeNull();

    // The PKCE verifier we stored is the one handed to the exchange — not a fresh one.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.code).toBe('google-auth-code');
    expect(provider.calls[0]?.codeVerifier).toBeTruthy();
  });

  it('resolveSession returns the admin for a live session token', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);
    const result = await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'c',
    });
    if (result.kind !== 'signed_in') throw new Error('expected sign-in');

    const resolved = await adminIdentityService.resolveSession(testDb, result.sessionToken);
    expect(resolved?.adminUser.email).toBe('david@amana-ng.com');
  });

  it('resolveSession rejects a token that was never issued', async () => {
    const resolved = await adminIdentityService.resolveSession(testDb, 'not-a-real-token');
    expect(resolved).toBeNull();
  });

  it('signOut revokes the session, and the token stops working immediately', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);
    const result = await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'c',
    });
    if (result.kind !== 'signed_in') throw new Error('expected sign-in');

    await adminIdentityService.signOut(testDb, result.sessionToken);

    expect(await adminIdentityService.resolveSession(testDb, result.sessionToken)).toBeNull();
  });
});
