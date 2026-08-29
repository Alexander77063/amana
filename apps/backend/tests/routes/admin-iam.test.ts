// apps/backend/tests/routes/admin-iam.test.ts
//
// The IAM surface over HTTP. The invariants themselves are proved in
// `tests/modules/admin/admin-iam.service.test.ts`; what these tests establish is that the routes
// actually reach those checks, that they carry a real signed-in actor rather than a body field,
// and that a refusal is a 403 rather than a 500.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminIamService } from '../../src/modules/admin/admin-iam.service';
import { adminIdentityService } from '../../src/modules/admin/admin-identity.service';
import { adminRoleGrantsRepo } from '../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../src/modules/admin/admin-users.repo';
import { createServer } from '../../src/server';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const COOKIE = 'amana_admin_session';

/**
 * Sign in as `email` through the real callback and return the cookie header.
 *
 * Deliberately the whole round trip rather than a hand-made session row: these routes must be
 * reachable exactly as a browser reaches them, actor and all.
 */
async function signInAs(email: string, subject = `sub-${email}`) {
  const app = createServer({
    adminOidcProvider: stubOidcProvider({ identity: { email, subject } }),
  });
  const start = await app.request('/admin/auth/start');
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
  const cb = await app.request(
    `/admin/auth/callback?code=c&state=${encodeURIComponent(state ?? '')}`,
  );
  const token = /amana_admin_session=([^;]+)/.exec(cb.headers.get('set-cookie') ?? '')?.[1];
  if (!token) throw new Error(`sign-in failed for ${email}`);
  return { app, cookie: `${COOKIE}=${token}` };
}

/** Provision an admin with roles, without going through the routes under test. */
async function provision(email: string, roles: readonly string[]) {
  const row = await adminUsersRepo.insertIfAbsent(testDb, { email, provisioningSource: 'admin' });
  if (!row) throw new Error('expected a new admin');
  for (const role of roles) {
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: row.id,
      role: role as 'admin',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
    });
  }
  return row;
}

describe('admin IAM routes', () => {
  beforeEach(async () => {
    await truncateAll();
    await adminIdentityService.ensureBootstrapOwner(testDb);
  });

  it('/admin/me reports the roles and permissions actually held', async () => {
    await provision('ops@amana-ng.com', ['ops']);
    const { app, cookie } = await signInAs('ops@amana-ng.com');

    const res = await app.request('/admin/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roles).toEqual(['ops']);
    // The portal renders from permissions, not from role names, so it must be told them.
    expect(body.permissions).toContain('vendor.write');
    expect(body.permissions).not.toContain('iam.write');
  });

  it('/admin/me reports no roles for a freshly onboarded admin', async () => {
    await provision('newhire@amana-ng.com', []);
    const { app, cookie } = await signInAs('newhire@amana-ng.com');

    const body = await (await app.request('/admin/me', { headers: { cookie } })).json();
    expect(body.roles).toEqual([]);
    expect(body.permissions).toEqual([]);
  });

  it('an admin can onboard a colleague and grant them a role', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const created = await app.request('/admin/iam/admins', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'newhire@amana-ng.com' }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const granted = await app.request(`/admin/iam/admins/${id}/roles`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ops', reason: 'joined ops' }),
    });
    expect(granted.status).toBe(204);
    expect(await adminIamService.rolesFor(testDb, id)).toEqual(['ops']);
  });

  it('revokes a role', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    const target = await provision('leaver@amana-ng.com', ['ops']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const res = await app.request(`/admin/iam/admins/${target.id}/roles/revoke`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ops' }),
    });
    expect(res.status).toBe(204);
    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
  });

  it('lists admins with the roles they hold', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    await provision('ops@amana-ng.com', ['ops']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const res = await app.request('/admin/iam/admins', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ops = body.admins.find((a: { email: string }) => a.email === 'ops@amana-ng.com');
    expect(ops.roles).toEqual(['ops']);
  });

  it('returns the grant history for one admin', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    const target = await provision('t@amana-ng.com', ['ops']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const res = await app.request(`/admin/iam/admins/${target.id}/roles`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The log, not the fold — an auditor asks what happened, not only what is true now.
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0]).toMatchObject({ role: 'ops', granted: true });
  });

  it('403s an ops operator trying to grant a role', async () => {
    await provision('ops@amana-ng.com', ['ops']);
    const target = await provision('t@amana-ng.com', []);
    const { app, cookie } = await signInAs('ops@amana-ng.com');

    const res = await app.request(`/admin/iam/admins/${target.id}/roles`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ops' }),
    });
    // 403, not 500: a denial is an expected outcome and must not page anyone.
    expect(res.status).toBe(403);
  });

  it('403s an owner trying to grant a role, even over HTTP', async () => {
    // The route must not become the place where segregation of duties is quietly relaxed.
    const owner = await adminUsersRepo.findByEmail(testDb, 'david@amana-ng.com');
    if (!owner) throw new Error('expected the seeded owner');
    // Stand the bootstrap account down to owner-only, as the exit ceremony does.
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: owner.id,
      role: 'admin',
      granted: false,
      grantedByAdminUserId: null,
      source: 'config',
    });
    const target = await provision('t@amana-ng.com', []);
    const { app, cookie } = await signInAs('david@amana-ng.com', 'google-subject-1');

    const res = await app.request(`/admin/iam/admins/${target.id}/roles`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ops' }),
    });
    expect(res.status).toBe(403);
  });

  it('403s a self-grant made over HTTP', async () => {
    const boss = await provision('boss@amana-ng.com', ['admin']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    // The actor comes from the session, so there is no body field to point at someone else.
    const res = await app.request(`/admin/iam/admins/${boss.id}/roles`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(res.status).toBe(403);
  });

  it('401s every IAM route without a session', async () => {
    const app = createServer({ adminOidcProvider: stubOidcProvider() });
    expect((await app.request('/admin/iam/admins')).status).toBe(401);
    expect(
      (
        await app.request('/admin/iam/admins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'x@amana-ng.com' }),
        })
      ).status,
    ).toBe(401);
  });

  it('400s an unknown role rather than storing it', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    const target = await provision('t@amana-ng.com', []);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const res = await app.request(`/admin/iam/admins/${target.id}/roles`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'superuser' }),
    });
    expect(res.status).toBe(400);
  });

  it('400s a malformed admin id rather than 500ing on Postgres', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const res = await app.request('/admin/iam/admins/not-a-uuid/roles', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ops' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s a grant to an admin that does not exist', async () => {
    await provision('boss@amana-ng.com', ['admin']);
    const { app, cookie } = await signInAs('boss@amana-ng.com');

    const res = await app.request('/admin/iam/admins/00000000-0000-0000-0000-000000000009/roles', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ops' }),
    });
    expect(res.status).toBe(404);
  });
});
