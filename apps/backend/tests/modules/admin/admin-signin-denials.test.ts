// apps/backend/tests/modules/admin/admin-signin-denials.test.ts
//
// The refusal matrix. Signing in to the admin portal is the one place where "who are you" is
// decided, so each way of failing it gets its own case — a single "it denies bad sign-ins" test
// would pass with most of these checks missing.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminIdentityService } from '../../../src/modules/admin/admin-identity.service';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { stubOidcProvider } from '../../helpers/oidc-stub';
import { testDb, truncateAll } from '../../helpers/test-db';

/** Run one full start → callback round trip against a provider returning `identity`. */
async function signInWith(identity: Parameters<typeof stubOidcProvider>[0]) {
  const provider = stubOidcProvider(identity);
  const started = await adminIdentityService.startLogin(testDb, provider);
  return adminIdentityService.completeLogin(testDb, provider, {
    state: started.state,
    code: 'code',
  });
}

describe('admin sign-in denials', () => {
  beforeEach(async () => {
    await truncateAll();
    await adminIdentityService.ensureBootstrapOwner(testDb);
  });

  it('refuses an unverified Google email', async () => {
    const result = await signInWith({ identity: { emailVerified: false } });
    expect(result).toMatchObject({ kind: 'denied', reason: 'email_unverified' });
  });

  it('refuses an address outside the Workspace domain', async () => {
    const result = await signInWith({
      identity: { email: 'stranger@gmail.com', hostedDomain: null },
    });
    expect(result).toMatchObject({ kind: 'denied', reason: 'outside_workspace_domain' });
  });

  it('refuses an address that only LOOKS like the Workspace domain', async () => {
    // A personal Google account whose profile email is set to an amana-ng.com address. The
    // address passes a naive string check; Google's `hd` claim is what exposes it, which is why
    // the check is on both and not on either.
    const result = await signInWith({
      identity: { email: 'david@amana-ng.com', hostedDomain: null },
    });
    expect(result).toMatchObject({ kind: 'denied', reason: 'outside_workspace_domain' });
  });

  it('refuses a Workspace member who has not been provisioned as an admin', async () => {
    // Invariant 4, and the whole shape of Task 1: signing in does not create an admin. Everyone
    // in the Workspace can reach Google's consent screen; only a provisioned row gets a session.
    const result = await signInWith({
      identity: { email: 'newhire@amana-ng.com', subject: 'google-subject-newhire' },
    });
    expect(result).toMatchObject({ kind: 'denied', reason: 'not_provisioned' });
  });

  it('refuses a suspended admin', async () => {
    const owner = await adminUsersRepo.findByEmail(testDb, 'david@amana-ng.com');
    if (!owner) throw new Error('expected the seeded owner');
    await adminUsersRepo.setStatus(testDb, owner.id, 'suspended');

    const result = await signInWith({});
    expect(result).toMatchObject({ kind: 'denied', reason: 'suspended' });
  });

  it('refuses a different Google subject presenting a bound admin address', async () => {
    await signInWith({}); // binds google-subject-1

    const result = await signInWith({ identity: { subject: 'google-subject-impostor' } });
    expect(result).toMatchObject({ kind: 'denied', reason: 'subject_mismatch' });
  });

  it('refuses a callback whose state we never issued', async () => {
    const provider = stubOidcProvider();
    const result = await adminIdentityService.completeLogin(testDb, provider, {
      state: 'never-issued',
      code: 'code',
    });
    expect(result).toMatchObject({ kind: 'denied', reason: 'unknown_state' });
    // Nothing was exchanged: an unknown state must not cost us a call to Google.
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses a replay of a state that already completed a sign-in', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);
    const first = await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'code',
    });
    expect(first.kind).toBe('signed_in');

    const replay = await adminIdentityService.completeLogin(testDb, provider, {
      state: started.state,
      code: 'code',
    });
    expect(replay).toMatchObject({ kind: 'denied', reason: 'unknown_state' });
  });

  it('refuses an expired login request', async () => {
    const provider = stubOidcProvider();
    const started = await adminIdentityService.startLogin(testDb, provider);

    const wayLater = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await adminIdentityService.completeLogin(
      testDb,
      provider,
      { state: started.state, code: 'code' },
      wayLater,
    );
    expect(result).toMatchObject({ kind: 'denied', reason: 'unknown_state' });
  });

  it('refuses when the code exchange itself fails', async () => {
    const result = await signInWith({ failWith: new Error('invalid_grant') });
    expect(result).toMatchObject({ kind: 'denied', reason: 'exchange_failed' });
  });

  it('issues no session for any denial', async () => {
    const result = await signInWith({ identity: { email: 'stranger@gmail.com' } });
    if (result.kind !== 'denied') throw new Error('expected a denial');
    // Belt and braces: a denial that still minted a cookie would be the whole vulnerability.
    expect(result).not.toHaveProperty('sessionToken');
  });
});
