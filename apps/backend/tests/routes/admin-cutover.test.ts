// apps/backend/tests/routes/admin-cutover.test.ts
//
// THE test for sub-plan A1 Task 4, and it is deliberately about the OLD mechanism rather than the
// new one.
//
// The plan is explicit that `ADMIN_API_KEY` is deleted rather than kept as a fallback, because "a
// fallback is the whole vulnerability with extra steps". Tests that only prove the new session
// auth works would pass just as happily with a leftover `adminAuth` mount still accepting the
// shared secret on some forgotten endpoint. So this file presents what used to be a perfectly
// valid key to all thirteen endpoints and requires every one of them to refuse it.
//
// If you are reading this because it failed: an endpoint still honours the shared key. That is the
// hole, not the test.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminRoleGrantsRepo } from '../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../src/modules/admin/admin-users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const OLD_KEY = 'test-admin-key-0000000000000000000';
const JSON_HEADERS = { 'content-type': 'application/json' };

/** Every endpoint that lived behind the shared key. Thirteen of them, per the plan. */
const THIRTEEN = [
  { method: 'GET', path: '/vendors-admin/claim-queue' },
  { method: 'POST', path: `/vendors-admin/vendors/${factories.userId()}/approve-claim` },
  { method: 'POST', path: `/vendors-admin/vendors/${factories.userId()}/category` },
  { method: 'POST', path: `/vendors-admin/vendors/${factories.userId()}/suspend` },
  { method: 'GET', path: `/vendors-admin/vendors/${factories.userId()}/consents` },
  { method: 'POST', path: `/vendors-admin/vendors/${factories.userId()}/consents/revoke` },
  { method: 'POST', path: `/vendors-admin/households/${factories.userId()}/enforcement` },
  { method: 'POST', path: '/retailers' },
  { method: 'GET', path: '/retailers' },
  { method: 'GET', path: `/retailers/${factories.userId()}` },
  { method: 'POST', path: `/retailers/${factories.userId()}/kyb` },
  { method: 'POST', path: `/retailers/${factories.userId()}/approve` },
  { method: 'POST', path: `/retailers/${factories.userId()}/suspend` },
] as const;

const app = createServer({ adminOidcProvider: stubOidcProvider() });

beforeEach(async () => {
  await truncateAll();
  // Set it deliberately. The point is not that an unconfigured key is refused — `adminAuth`
  // already failed closed on that — but that a CORRECTLY configured one buys nothing any more.
  process.env.ADMIN_API_KEY = OLD_KEY;
});

describe('the shared ops secret is gone', () => {
  it('refuses the old x-admin-api-key on every one of the 13 endpoints', async () => {
    const accepted: string[] = [];

    for (const { method, path } of THIRTEEN) {
      const res = await app.request(path, {
        method,
        headers: { 'x-admin-api-key': OLD_KEY, ...JSON_HEADERS },
        ...(method === 'POST' && { body: JSON.stringify({}) }),
      });
      // 401 specifically: the key is not an identity any more, so this is unauthenticated.
      // Anything that is not a 401 means the endpoint engaged with the request.
      if (res.status !== 401) accepted.push(`${method} ${path} -> ${res.status}`);
    }

    expect(accepted).toEqual([]);
  });

  it('refuses those endpoints outright when no credential is presented at all', async () => {
    const accepted: string[] = [];
    for (const { method, path } of THIRTEEN) {
      const res = await app.request(path, {
        method,
        headers: JSON_HEADERS,
        ...(method === 'POST' && { body: JSON.stringify({}) }),
      });
      if (res.status !== 401) accepted.push(`${method} ${path} -> ${res.status}`);
    }
    expect(accepted).toEqual([]);
  });

  it('does not accept a customer bearer token in place of a staff session', async () => {
    // Staff and customers authenticate on entirely separate rails, and this is the check that
    // they have not quietly converged: a household principal's access token is not staff access,
    // whatever its role claim says.
    const res = await app.request('/vendors-admin/claim-queue', {
      headers: { authorization: 'Bearer not-a-staff-credential' },
    });
    expect(res.status).toBe(401);
  });
});

describe('an ops admin can do the work the key used to do', () => {
  /** Provision a signed-in `ops` admin and return their session cookie. */
  async function opsSession() {
    const admin = await adminUsersRepo.insertIfAbsent(testDb, {
      email: 'ops@amana-ng.com',
      provisioningSource: 'admin',
    });
    if (!admin) throw new Error('expected a new admin');
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role: 'ops',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
    });

    const signInApp = createServer({
      adminOidcProvider: stubOidcProvider({
        identity: { email: 'ops@amana-ng.com', subject: 'sub-ops' },
      }),
    });
    const start = await signInApp.request('/admin/auth/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    const cb = await signInApp.request(
      `/admin/auth/callback?code=c&state=${encodeURIComponent(state ?? '')}`,
    );
    const token = /amana_admin_session=([^;]+)/.exec(cb.headers.get('set-cookie') ?? '')?.[1];
    if (!token) throw new Error('ops sign-in failed');
    return { app: signInApp, cookie: `amana_admin_session=${token}`, admin };
  }

  it('reads the claim queue with a session instead of a secret', async () => {
    const { app: opsApp, cookie } = await opsSession();
    const res = await opsApp.request('/vendors-admin/claim-queue', { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it('refuses an admin who holds no ops permission', async () => {
    // Authentication is not authorization. A signed-in member of staff with the wrong role must
    // not reach the vendor registry just because they can sign in.
    const iamOnly = await adminUsersRepo.insertIfAbsent(testDb, {
      email: 'iam@amana-ng.com',
      provisioningSource: 'admin',
    });
    if (!iamOnly) throw new Error('expected a new admin');
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: iamOnly.id,
      role: 'admin',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
    });

    const signInApp = createServer({
      adminOidcProvider: stubOidcProvider({
        identity: { email: 'iam@amana-ng.com', subject: 'sub-iam' },
      }),
    });
    const start = await signInApp.request('/admin/auth/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    const cb = await signInApp.request(
      `/admin/auth/callback?code=c&state=${encodeURIComponent(state ?? '')}`,
    );
    const token = /amana_admin_session=([^;]+)/.exec(cb.headers.get('set-cookie') ?? '')?.[1];

    const res = await signInApp.request('/vendors-admin/claim-queue', {
      headers: { cookie: `amana_admin_session=${token}` },
    });
    expect(res.status).toBe(403);
  });
});
