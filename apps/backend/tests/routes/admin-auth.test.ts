// apps/backend/tests/routes/admin-auth.test.ts
//
// The HTTP surface of admin sign-in, exercised through the real server so the security headers,
// the error handler and the rate limiters are all in the path.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminIdentityService } from '../../src/modules/admin/admin-identity.service';
import { auditRepo } from '../../src/modules/audit/audit.repo';
import { createServer } from '../../src/server';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const COOKIE = 'amana_admin_session';

function appWith(options: Parameters<typeof stubOidcProvider>[0] = {}) {
  return createServer({ adminOidcProvider: stubOidcProvider(options) });
}

/** Pull the `state` back out of the Location we send the browser to. */
function stateFrom(location: string): string {
  const s = new URL(location).searchParams.get('state');
  if (!s) throw new Error('no state in authorization url');
  return s;
}

/** Drive a whole browser round trip and hand back the callback response. */
async function roundTrip(app: ReturnType<typeof createServer>) {
  const start = await app.request('/admin/auth/start');
  const state = stateFrom(start.headers.get('location') ?? '');
  return app.request(`/admin/auth/callback?code=google-code&state=${encodeURIComponent(state)}`);
}

function sessionCookieFrom(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = /amana_admin_session=([^;]+)/.exec(setCookie);
  return match?.[1] ?? null;
}

describe('admin auth routes', () => {
  beforeEach(async () => {
    await truncateAll();
    await adminIdentityService.ensureBootstrapOwner(testDb);
  });

  it('start redirects to Google', async () => {
    const res = await appWith().request('/admin/auth/start');

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com');
    expect(stateFrom(location)).toBeTruthy();
  });

  it('callback signs the owner in and sets a hardened session cookie', async () => {
    const res = await roundTrip(appWith());

    expect(res.status).toBe(302);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${COOKIE}=`);
    // A staff session cookie is not readable by script, not sent over plain HTTP, and not sent
    // to other sites. `Lax` rather than `Strict` on purpose: the callback itself arrives as a
    // top-level navigation from Google, and `Strict` drops the cookie on exactly that hop.
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  it('the cookie it sets is accepted by /admin/me', async () => {
    const app = appWith();
    const res = await roundTrip(app);
    const token = sessionCookieFrom(res);
    expect(token).toBeTruthy();

    const me = await app.request('/admin/me', {
      headers: { cookie: `${COOKIE}=${token}` },
    });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.email).toBe('david@amana-ng.com');
    // Task 2 seeds the bootstrap account with BOTH roles, because `owner` alone could never
    // grant anyone anything and the system would admit nobody. It is break-glass, and
    // `google-workspace-setup.md` documents how to stand it down once a real admin exists.
    expect([...body.roles].sort()).toEqual(['admin', 'owner']);
  });

  it('/admin/me refuses a request with no cookie', async () => {
    const res = await appWith().request('/admin/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'admin_unauthorized' });
  });

  it('/admin/me refuses a forged cookie', async () => {
    const res = await appWith().request('/admin/me', {
      headers: { cookie: `${COOKIE}=not-a-real-session-token` },
    });
    expect(res.status).toBe(401);
  });

  it('answers every refusal identically, whatever the real reason', async () => {
    // The service distinguishes seven denial reasons for the audit log. The browser must be told
    // none of them: a caller who can tell "not provisioned" from "outside the domain" can map the
    // staff directory from outside, which is the same enumeration oracle the customer-facing OTP
    // rails were built to avoid.
    const cases = [
      { identity: { emailVerified: false } },
      { identity: { email: 'stranger@gmail.com', hostedDomain: null } },
      { identity: { email: 'newhire@amana-ng.com' } },
      { failWith: new Error('invalid_grant') },
    ];

    const seen = new Set<string>();
    for (const c of cases) {
      const res = await roundTrip(appWith(c));
      seen.add(`${res.status} ${res.headers.get('location')}`);
      expect(sessionCookieFrom(res)).toBeNull();
    }
    expect(seen.size).toBe(1);
  });

  it('refuses a callback carrying a code but no state', async () => {
    // `state` is the CSRF defence and the single-use marker; a callback without one was never
    // started by us. It is refused exactly as every other failure is — same destination, no
    // cookie — rather than with a distinguishable 400, so a malformed probe learns nothing a
    // refused sign-in would not also tell it.
    const app = appWith();
    const refused = await app.request('/admin/auth/callback?code=google-code');
    const alsoRefused = await roundTrip(appWith({ identity: { email: 'stranger@gmail.com' } }));

    expect(sessionCookieFrom(refused)).toBeNull();
    expect(refused.status).toBe(alsoRefused.status);
    expect(refused.headers.get('location')).toBe(alsoRefused.headers.get('location'));
    expect(refused.headers.get('location')).toContain('error=sign_in_failed');
  });

  it('logout revokes the session and clears the cookie', async () => {
    const app = appWith();
    const token = sessionCookieFrom(await roundTrip(app));

    const out = await app.request('/admin/auth/logout', {
      method: 'POST',
      headers: { cookie: `${COOKIE}=${token}` },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie') ?? '').toContain(`${COOKIE}=;`);

    const after = await app.request('/admin/me', { headers: { cookie: `${COOKIE}=${token}` } });
    expect(after.status).toBe(401);

    const rows = await auditRepo.listByAction(testDb, 'admin.signed_out');
    expect(rows).toHaveLength(1);
  });

  it('logout without a session is refused rather than pretending to work', async () => {
    const res = await appWith().request('/admin/auth/logout', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
