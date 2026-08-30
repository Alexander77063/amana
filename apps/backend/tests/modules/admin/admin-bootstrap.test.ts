// apps/backend/tests/modules/admin/admin-bootstrap.test.ts
//
// The bootstrap is a genuine deadlock unless it is designed: Task 1 seeds one `owner`, but the
// role matrix says `owner` cannot grant roles — only `admin` can. One owner and no admins means
// the system admits nobody, forever, with no path out.
//
// The resolution: configuration seeds BOTH roles onto the bootstrap address, marked in the data as
// config-granted. That account is break-glass, which the plan already lists under `owner`. What
// makes it acceptable rather than a permanent god account is that it has an EXIT, and the last
// test here is that exit, executed.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../../src/env';
import { adminIamService } from '../../../src/modules/admin/admin-iam.service';
import { adminIdentityService } from '../../../src/modules/admin/admin-identity.service';
import { adminRoleGrantsRepo } from '../../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seededOwner() {
  const owner = await adminUsersRepo.findByEmail(testDb, env.ADMIN_BOOTSTRAP_OWNER_EMAIL);
  if (!owner) throw new Error('expected the seeded owner');
  return owner;
}

describe('admin bootstrap', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('seeds the first account with both owner and admin', async () => {
    await adminIdentityService.ensureBootstrapOwner(testDb);
    const owner = await seededOwner();

    // Both, deliberately. Without `admin` nobody could ever be onboarded; without `owner` the
    // account could not do the thing it exists for.
    expect((await adminIamService.rolesFor(testDb, owner.id)).sort()).toEqual(['admin', 'owner']);
  });

  it('marks those grants as config-made, with no granting admin', async () => {
    await adminIdentityService.ensureBootstrapOwner(testDb);
    const owner = await seededOwner();

    const log = await adminRoleGrantsRepo.listForAdmin(testDb, owner.id);
    expect(log).toHaveLength(2);
    for (const row of log) {
      // Null granter IS the marker, exactly as `provisioningSource: 'config'` marks the user row.
      // Every other grant in the system names a person; these two cannot, and that difference is
      // what makes the break-glass account visible in the data rather than only in a runbook.
      expect(row.grantedByAdminUserId).toBeNull();
      expect(row.source).toBe('config');
      expect(row.granted).toBe(true);
    }
  });

  it('is idempotent — a restart does not pile up duplicate grants', async () => {
    // Runs on every boot of every instance, so this is not a nicety.
    await adminIdentityService.ensureBootstrapOwner(testDb);
    await adminIdentityService.ensureBootstrapOwner(testDb);
    await adminIdentityService.ensureBootstrapOwner(testDb);

    const owner = await seededOwner();
    expect(await adminRoleGrantsRepo.listForAdmin(testDb, owner.id)).toHaveLength(2);
    expect((await adminIamService.rolesFor(testDb, owner.id)).sort()).toEqual(['admin', 'owner']);
  });

  it('does not resurrect a role an admin deliberately revoked', async () => {
    // The exit ceremony below revokes the bootstrap account's `admin`. If the next deploy simply
    // granted it back, the ceremony would be theatre and the god account would be permanent.
    await adminIdentityService.ensureBootstrapOwner(testDb);
    const owner = await seededOwner();
    const realAdmin = await adminIamService.onboardAdmin(testDb, {
      actorAdminUserId: owner.id,
      email: 'ada@amana-ng.com',
    });
    await adminIamService.grantRole(testDb, {
      actorAdminUserId: owner.id,
      targetAdminUserId: realAdmin.id,
      role: 'admin',
    });
    await adminIamService.revokeRole(testDb, {
      actorAdminUserId: realAdmin.id,
      targetAdminUserId: owner.id,
      role: 'admin',
    });

    await adminIdentityService.ensureBootstrapOwner(testDb);

    expect(await adminIamService.rolesFor(testDb, owner.id)).toEqual(['owner']);
  });

  it('the exit ceremony works end to end', async () => {
    // The whole justification for seeding a break-glass account is that it can be stood down.
    // A ceremony written only in a runbook is a ceremony nobody has ever run; this is it, run.
    await adminIdentityService.ensureBootstrapOwner(testDb);
    const owner = await seededOwner();

    // 1. The break-glass account onboards a real member of staff and makes them an admin.
    const ada = await adminIamService.onboardAdmin(testDb, {
      actorAdminUserId: owner.id,
      email: 'ada@amana-ng.com',
    });
    await adminIamService.grantRole(testDb, {
      actorAdminUserId: owner.id,
      targetAdminUserId: ada.id,
      role: 'admin',
      reason: 'first real admin',
    });

    // 2. That admin — not the break-glass account itself, which invariant 1 forbids — removes the
    //    bootstrap account's access-granting power.
    await adminIamService.revokeRole(testDb, {
      actorAdminUserId: ada.id,
      targetAdminUserId: owner.id,
      role: 'admin',
      reason: 'bootstrap complete; restoring segregation of duties',
    });

    // 3. Segregation of duties now holds: one account grants access, a different one moves money,
    //    and neither can become the other alone.
    expect(await adminIamService.rolesFor(testDb, owner.id)).toEqual(['owner']);
    expect(await adminIamService.rolesFor(testDb, ada.id)).toEqual(['admin']);

    // And the break-glass account can no longer hand out roles.
    await expect(
      adminIamService.grantRole(testDb, {
        actorAdminUserId: owner.id,
        targetAdminUserId: ada.id,
        role: 'ops',
      }),
    ).rejects.toThrow();

    // The whole sequence is on the record, attributed to whoever performed each step.
    const ownerLog = await adminRoleGrantsRepo.listForAdmin(testDb, owner.id);
    expect(ownerLog.map((r) => `${r.role}:${r.granted}`)).toEqual([
      'owner:true',
      'admin:true',
      'admin:false',
    ]);
    expect(ownerLog[2]?.grantedByAdminUserId).toBe(ada.id);
  });
});
