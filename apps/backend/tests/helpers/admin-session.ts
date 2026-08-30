import { adminRoleGrantsRepo } from '../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../src/modules/admin/admin-users.repo';
import { createServer } from '../../src/server';
import { stubOidcProvider } from './oidc-stub';
import { testDb } from './test-db';

export type AdminRoleName = 'owner' | 'admin' | 'ops' | 'support' | 'auditor';

/**
 * Provision a member of staff with the given roles and sign them in, returning a `cookie` header
 * ready to put on a request.
 *
 * The sign-in is a real round trip through `/admin/auth/start` and `/admin/auth/callback` against
 * the stub OIDC provider, rather than a hand-inserted session row: these tests exist to prove the
 * ops surfaces are reachable exactly as a browser reaches them, and a fabricated session would
 * skip the part most likely to break.
 *
 * The returned cookie works against ANY `createServer()` instance, because admin sessions live in
 * Postgres rather than in process memory — so a test can keep its existing module-level `app`.
 */
export async function signedInAdmin(
  email: string,
  roles: readonly AdminRoleName[],
): Promise<{ cookie: string; adminUserId: string }> {
  const admin = await adminUsersRepo.insertIfAbsent(testDb, {
    email,
    provisioningSource: 'admin',
  });
  if (!admin) throw new Error(`admin ${email} already exists in this test`);

  for (const role of roles) {
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: admin.id,
      role,
      granted: true,
      // Null granter: these are fixtures, not grants made by a person. Real grants always name
      // one, and Task 3 requires two people for them.
      grantedByAdminUserId: null,
      source: 'config',
    });
  }

  const app = createServer({
    adminOidcProvider: stubOidcProvider({ identity: { email, subject: `sub-${email}` } }),
  });
  const start = await app.request('/admin/auth/start');
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
  const callback = await app.request(
    `/admin/auth/callback?code=test-code&state=${encodeURIComponent(state ?? '')}`,
  );
  const token = /amana_admin_session=([^;]+)/.exec(callback.headers.get('set-cookie') ?? '')?.[1];
  if (!token) throw new Error(`admin sign-in failed for ${email}`);

  return { cookie: `amana_admin_session=${token}`, adminUserId: admin.id };
}
