// apps/backend/tests/modules/admin/admin-iam.service.test.ts
//
// The invariants are the actual product of sub-plan A1; everything else is plumbing. Each one gets
// its own test, because they are the kind of rule a future contributor "simplifies" in good faith —
// owner-as-god-mode is the reflex, and these tests are what stops it.
//
// All checks live in the SERVICE layer, never the route, for the same reason `wallet-access.service`
// does: a check a route performs is a check the next caller can forget.
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../src/lib/errors';
import { adminIamService } from '../../../src/modules/admin/admin-iam.service';
import { adminRoleGrantsRepo } from '../../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

/** An admin holding exactly the roles given — the shape most of these tests need. */
async function adminWith(email: string, roles: readonly string[]) {
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

describe('adminIamService', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('invariant 4 — least privilege by default', () => {
    it('onboards a new admin with no roles at all', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);

      const created = await adminIamService.onboardAdmin(testDb, {
        actorAdminUserId: actor.id,
        email: 'newhire@amana-ng.com',
      });

      expect(created.email).toBe('newhire@amana-ng.com');
      expect(created.provisioningSource).toBe('admin');
      // They can sign in and do precisely nothing. This will feel broken on day one, and it is
      // correct — see the plan's self-review.
      expect(await adminIamService.rolesFor(testDb, created.id)).toEqual([]);
      expect(await adminIamService.permissionsFor(testDb, created.id)).toEqual([]);
    });

    it('refuses to onboard an address outside the Workspace domain', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      await expect(
        adminIamService.onboardAdmin(testDb, {
          actorAdminUserId: actor.id,
          email: 'contractor@gmail.com',
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('invariant 1 — nobody can change their own roles', () => {
    it('refuses a self-grant even from a full admin', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);

      // This is what stops `admin` from becoming every other role. Without it, the role that
      // hands out access can hand itself money power, and the whole matrix collapses to one role.
      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: actor.id,
          targetAdminUserId: actor.id,
          role: 'owner',
        }),
      ).rejects.toThrow(ForbiddenError);

      expect(await adminIamService.rolesFor(testDb, actor.id)).toEqual(['admin']);
    });

    it('refuses a self-revoke too', async () => {
      // Symmetry matters: self-revocation is how an admin would escape a maker-checker trail in
      // Task 3, and "I removed my own access" is still an unattributable change to permissions.
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      await expect(
        adminIamService.revokeRole(testDb, {
          actorAdminUserId: actor.id,
          targetAdminUserId: actor.id,
          role: 'admin',
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('invariant 3 — segregation of duties', () => {
    it('refuses to let an owner grant a role', async () => {
      // Counterintuitive and load-bearing. `owner` is the most powerful role in the product and
      // still cannot hand out access: the role that moves money must not be able to give itself
      // helpers. If you are here because this test failed after you "fixed" owner permissions,
      // this is the rule, not a bug.
      const owner = await adminWith('david@amana-ng.com', ['owner']);
      const target = await adminWith('someone@amana-ng.com', []);

      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: owner.id,
          targetAdminUserId: target.id,
          role: 'ops',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('refuses to let an admin grant themselves money power indirectly via another account', async () => {
      // An admin may not create a colleague who holds BOTH access-granting and money power,
      // because that account is the merger the segregation exists to prevent.
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      const checker = await adminWith('checker@amana-ng.com', ['admin']);
      const target = await adminWith('both@amana-ng.com', []);

      // Grants go through maker-checker since Task 3, so this takes two people to land.
      const first = await adminIamService.grantRole(testDb, {
        actorAdminUserId: actor.id,
        targetAdminUserId: target.id,
        role: 'admin',
      });
      await adminIamService.approveRoleGrant(testDb, {
        approvalId: first.id,
        checkerAdminUserId: checker.id,
      });

      // Refused at PROPOSAL time — an impossible request should not sit in an inbox for a week
      // before failing.
      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: actor.id,
          targetAdminUserId: target.id,
          role: 'owner',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('gives admin no money permission and owner no access-granting permission', async () => {
      const admin = await adminWith('a@amana-ng.com', ['admin']);
      const owner = await adminWith('o@amana-ng.com', ['owner']);

      const adminPerms = await adminIamService.permissionsFor(testDb, admin.id);
      const ownerPerms = await adminIamService.permissionsFor(testDb, owner.id);

      expect(adminPerms).toContain('iam.write');
      expect(adminPerms).not.toContain('money.operate');
      expect(ownerPerms).toContain('money.operate');
      expect(ownerPerms).not.toContain('iam.write');
    });
  });

  describe('permission checks', () => {
    it('refuses a role change from someone with no roles', async () => {
      const nobody = await adminWith('nobody@amana-ng.com', []);
      const target = await adminWith('target@amana-ng.com', []);

      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: nobody.id,
          targetAdminUserId: target.id,
          role: 'ops',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('refuses a role change from an ops operator', async () => {
      const ops = await adminWith('ops@amana-ng.com', ['ops']);
      const target = await adminWith('t@amana-ng.com', []);

      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: ops.id,
          targetAdminUserId: target.id,
          role: 'ops',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('refuses to act for a suspended admin, whatever roles they hold', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      const target = await adminWith('t@amana-ng.com', []);
      await adminUsersRepo.setStatus(testDb, actor.id, 'suspended');

      // Suspension has to bite in the service, not only at the session: a live cookie issued
      // before the suspension must stop being able to do things, not merely stop being renewed.
      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: actor.id,
          targetAdminUserId: target.id,
          role: 'ops',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('requirePermission passes for a held permission and throws for a missing one', async () => {
      const ops = await adminWith('ops@amana-ng.com', ['ops']);

      await expect(
        adminIamService.requirePermission(testDb, ops.id, 'vendor.write'),
      ).resolves.toBeUndefined();
      await expect(adminIamService.requirePermission(testDb, ops.id, 'iam.write')).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('refuses a grant to an admin that does not exist', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      await expect(
        adminIamService.grantRole(testDb, {
          actorAdminUserId: actor.id,
          targetAdminUserId: '00000000-0000-0000-0000-000000000009',
          role: 'ops',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('the happy path, and what it records', () => {
    it('grants a role and attributes it to the admin who granted it', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      const checker = await adminWith('checker@amana-ng.com', ['admin']);
      const target = await adminWith('newhire@amana-ng.com', []);

      const proposal = await adminIamService.grantRole(testDb, {
        actorAdminUserId: actor.id,
        targetAdminUserId: target.id,
        role: 'ops',
        reason: 'joined the ops team',
      });
      // The grant is attributed to the MAKER, not the checker: the maker asked for it, the
      // checker agreed to it, and the approval row records the second half.
      await adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: checker.id,
      });

      expect(await adminIamService.rolesFor(testDb, target.id)).toEqual(['ops']);

      const log = await adminRoleGrantsRepo.listForAdmin(testDb, target.id);
      expect(log).toHaveLength(1);
      expect(log[0]?.grantedByAdminUserId).toBe(actor.id);
      expect(log[0]?.source).toBe('admin');
      expect(log[0]?.reason).toBe('joined the ops team');

      // And it is an audit event in its own right, naming the operator — the thing that was
      // impossible before this sub-plan.
      const audit = await auditRepo.listByAction(testDb, 'admin.role_granted');
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorAdminUserId).toBe(actor.id);
      expect(audit[0]?.subjectId).toBe(target.id);
      expect(audit[0]?.payloadJson).toMatchObject({ role: 'ops' });
    });

    it('revokes a role and records who took it away', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      const target = await adminWith('leaver@amana-ng.com', ['ops']);

      await adminIamService.revokeRole(testDb, {
        actorAdminUserId: actor.id,
        targetAdminUserId: target.id,
        role: 'ops',
        reason: 'left the team',
      });

      expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
      const audit = await auditRepo.listByAction(testDb, 'admin.role_revoked');
      expect(audit[0]?.actorAdminUserId).toBe(actor.id);
    });

    it('records onboarding as an attributable event', async () => {
      const actor = await adminWith('boss@amana-ng.com', ['admin']);
      const created = await adminIamService.onboardAdmin(testDb, {
        actorAdminUserId: actor.id,
        email: 'newhire@amana-ng.com',
      });

      const audit = await auditRepo.listByAction(testDb, 'admin.onboarded');
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorAdminUserId).toBe(actor.id);
      expect(audit[0]?.subjectId).toBe(created.id);
    });
  });
});
