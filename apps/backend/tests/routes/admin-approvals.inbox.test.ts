import { beforeEach, describe, expect, it } from 'vitest';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer({ adminOidcProvider: stubOidcProvider() });
const NOW = new Date();

async function post(cookie: string, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function proposeRoleGrant(cookie: string, targetId: string) {
  const res = await post(cookie, `/admin/iam/admins/${targetId}/roles`, {
    role: 'ops',
    reason: 'inbox test',
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { approvalId: string }).approvalId;
}

async function proposeVendorClaim(cookie: string) {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'INBOX SHOP',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  const res = await post(cookie, `/vendors-admin/vendors/${v.id}/approve-claim`, {
    phone: factories.phone(),
    category: 'food',
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { approvalId: string }).approvalId;
}

describe('GET /admin/approvals — scoped by permission per kind', () => {
  beforeEach(truncateAll);

  it('an ops admin sees vendor claims but not role grants', async () => {
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const target = await signedInAdmin('newbie@amana-ng.com', []);
    const roleId = await proposeRoleGrant(admin.cookie, target.adminUserId);
    const claimId = await proposeVendorClaim(ops.cookie);

    const ops2 = await signedInAdmin('ops2@amana-ng.com', ['ops']);
    const res = await app.request('/admin/approvals', { headers: { cookie: ops2.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: Array<{ id: string; kind: string }> };
    expect(body.approvals.map((a) => a.id)).toContain(claimId);
    expect(body.approvals.map((a) => a.id)).not.toContain(roleId);
  });

  it('an admin sees role grants but not vendor claims', async () => {
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const target = await signedInAdmin('newbie@amana-ng.com', []);
    const roleId = await proposeRoleGrant(admin.cookie, target.adminUserId);
    const claimId = await proposeVendorClaim(ops.cookie);

    const admin2 = await signedInAdmin('admin2@amana-ng.com', ['admin']);
    const res = await app.request('/admin/approvals', { headers: { cookie: admin2.cookie } });
    const body = (await res.json()) as { approvals: Array<{ id: string; makerEmail: string }> };
    expect(body.approvals.map((a) => a.id)).toContain(roleId);
    expect(body.approvals.map((a) => a.id)).not.toContain(claimId);
    expect(body.approvals.find((a) => a.id === roleId)?.makerEmail).toBe('admin1@amana-ng.com');
  });

  it('the maker always sees their own proposal, whatever their permissions', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    // Take the role away — the proposal is still theirs to see and cancel.
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const revoke = await post(admin.cookie, `/admin/iam/admins/${ops.adminUserId}/roles/revoke`, {
      role: 'ops',
    });
    expect(revoke.status).toBe(204);

    const res = await app.request('/admin/approvals', { headers: { cookie: ops.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: Array<{ id: string }> };
    expect(body.approvals.map((a) => a.id)).toEqual([claimId]);
  });

  it('a support admin with no matching permission sees an empty inbox, not a 403', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    await proposeVendorClaim(ops.cookie);
    const support = await signedInAdmin('support@amana-ng.com', ['support']);
    const res = await app.request('/admin/approvals', { headers: { cookie: support.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { approvals: unknown[] }).approvals).toEqual([]);
  });

  it('?status=decided lists decisions with the checker named', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const ops2 = await signedInAdmin('ops2@amana-ng.com', ['ops']);
    const approve = await post(ops2.cookie, `/admin/approvals/${claimId}/approve`, {
      reason: 'checked with the shop',
    });
    expect(approve.status).toBe(200);

    const pending = await app.request('/admin/approvals', { headers: { cookie: ops.cookie } });
    expect(((await pending.json()) as { approvals: unknown[] }).approvals).toEqual([]);

    const decided = await app.request('/admin/approvals?status=decided', {
      headers: { cookie: ops.cookie },
    });
    expect(decided.status).toBe(200);
    const body = (await decided.json()) as {
      approvals: Array<{
        id: string;
        status: string;
        checkerEmail: string | null;
        decisionReason: string | null;
        decidedAt: string | null;
      }>;
    };
    const row = body.approvals.find((a) => a.id === claimId);
    expect(row?.status).toBe('approved');
    expect(row?.checkerEmail).toBe('ops2@amana-ng.com');
    expect(row?.decisionReason).toBe('checked with the shop');
    expect(row?.decidedAt).toMatch(/^\d{4}-/);
  });

  it('rejects an unknown status with 400', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const res = await app.request('/admin/approvals?status=everything', {
      headers: { cookie: ops.cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/approvals/:id/reject — the permission to decline is the permission to decide', () => {
  beforeEach(truncateAll);

  it('an auditor cannot reject a vendor claim', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const auditor = await signedInAdmin('auditor@amana-ng.com', ['auditor']);
    const res = await post(auditor.cookie, `/admin/approvals/${claimId}/reject`, {});
    expect(res.status).toBe(403);
  });

  it('a second ops admin can reject a vendor claim', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const ops2 = await signedInAdmin('ops2@amana-ng.com', ['ops']);
    const res = await post(ops2.cookie, `/admin/approvals/${claimId}/reject`, {
      reason: 'wrong phone',
    });
    expect(res.status).toBe(204);
  });

  it('an ops admin cannot reject a role grant', async () => {
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const target = await signedInAdmin('newbie@amana-ng.com', []);
    const roleId = await proposeRoleGrant(admin.cookie, target.adminUserId);
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const res = await post(ops.cookie, `/admin/approvals/${roleId}/reject`, {});
    expect(res.status).toBe(403);
  });

  it('the maker still cannot reject their own proposal', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const res = await post(ops.cookie, `/admin/approvals/${claimId}/reject`, {});
    expect(res.status).toBe(403);
  });
});
