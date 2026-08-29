// apps/backend/tests/modules/admin/admin-maker-checker.test.ts
//
// A role grant converts into every permission that role carries, which makes it the most dangerous
// action in the product. Task 3 makes it need two different people.
//
// The asymmetry to keep in mind while reading: GRANTS need two people, REVOCATIONS take effect
// immediately. Requiring a quorum to *remove* access would mean a compromised account stays live
// until a second admin happens to be available, so the gate is on the dangerous direction only.
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/lib/errors';
import { adminApprovalService } from '../../../src/modules/admin/admin-approval.service';
import { adminIamService } from '../../../src/modules/admin/admin-iam.service';
import { adminIdentityService } from '../../../src/modules/admin/admin-identity.service';
import { adminRoleGrantsRepo } from '../../../src/modules/admin/admin-role-grants.repo';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

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

/** Two admins who can each grant, and a target who holds nothing. */
async function twoAdminsAndATarget() {
  const maker = await adminWith('maker@amana-ng.com', ['admin']);
  const checker = await adminWith('checker@amana-ng.com', ['admin']);
  const target = await adminWith('target@amana-ng.com', []);
  return { maker, checker, target };
}

describe('maker-checker on role grants', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a grant does not take effect until a second admin approves it', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();

    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
      reason: 'joining ops',
    });

    expect(proposal.status).toBe('pending');
    // The whole point: proposing is not granting.
    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);

    await adminIamService.approveRoleGrant(testDb, {
      approvalId: proposal.id,
      checkerAdminUserId: checker.id,
    });

    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual(['ops']);
  });

  it('refuses to let the maker be their own checker', async () => {
    const { maker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });

    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: maker.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
  });

  it('refuses a checker who cannot grant roles in the first place', async () => {
    const { maker, target } = await twoAdminsAndATarget();
    const ops = await adminWith('ops@amana-ng.com', ['ops']);
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });

    // Two people is only a control if both of them are people who could have done it alone.
    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: ops.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('a rejected proposal never becomes a grant, and cannot be approved afterwards', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });

    await adminApprovalService.reject(testDb, {
      approvalId: proposal.id,
      checkerAdminUserId: checker.id,
      reason: 'not agreed',
    });

    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: checker.id,
      }),
    ).rejects.toThrow();
  });

  it('cannot be approved twice', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });
    await adminIamService.approveRoleGrant(testDb, {
      approvalId: proposal.id,
      checkerAdminUserId: checker.id,
    });

    // Replaying the approval must not append a second grant row or re-open a decided proposal.
    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: checker.id,
      }),
    ).rejects.toThrow();
    expect(await adminRoleGrantsRepo.listForAdmin(testDb, target.id)).toHaveLength(1);
  });

  it('lets the maker cancel their own proposal, but not someone else’s', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });

    await expect(
      adminApprovalService.cancel(testDb, {
        approvalId: proposal.id,
        makerAdminUserId: checker.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    await adminApprovalService.cancel(testDb, {
      approvalId: proposal.id,
      makerAdminUserId: maker.id,
    });
    expect((await adminApprovalService.findById(testDb, proposal.id))?.status).toBe('cancelled');
  });

  it('expires a stale proposal, and an expired one can no longer be approved', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });

    // A sweep writes the status transition rather than leaving a `pending` row that silently
    // stops working — the same reason `bump-ttl-sweep` exists rather than a read-time check.
    const wayLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const swept = await adminApprovalService.sweepExpired(testDb, wayLater);
    expect(swept).toBe(1);
    expect((await adminApprovalService.findById(testDb, proposal.id))?.status).toBe('expired');

    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: checker.id,
      }),
    ).rejects.toThrow();
    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
  });

  it('re-checks the proposal against the world at APPROVAL time, not proposal time', async () => {
    // Days can pass between proposing and approving. A proposal is a request, not a
    // pre-authorised write: if the target was suspended in the meantime, approving it must not
    // hand access to a suspended account.
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });
    await adminUsersRepo.setStatus(testDb, target.id, 'suspended');

    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: checker.id,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
  });

  it('re-checks segregation of duties at approval time too', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'owner',
    });
    // Between proposing and approving, the target became an admin by another route.
    await adminRoleGrantsRepo.append(testDb, {
      adminUserId: target.id,
      role: 'admin',
      granted: true,
      grantedByAdminUserId: null,
      source: 'config',
    });

    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: checker.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('records the proposal and the decision, naming both people', async () => {
    const { maker, checker, target } = await twoAdminsAndATarget();
    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });
    await adminIamService.approveRoleGrant(testDb, {
      approvalId: proposal.id,
      checkerAdminUserId: checker.id,
    });

    const proposed = await auditRepo.listByAction(testDb, 'admin.approval_proposed');
    const approved = await auditRepo.listByAction(testDb, 'admin.approval_approved');
    expect(proposed[0]?.actorAdminUserId).toBe(maker.id);
    expect(approved[0]?.actorAdminUserId).toBe(checker.id);

    // The grant itself still records the maker as the granter — the checker authorised it, the
    // maker asked for it, and both are answerable.
    const grants = await adminRoleGrantsRepo.listForAdmin(testDb, target.id);
    expect(grants[0]?.grantedByAdminUserId).toBe(maker.id);
  });
});

describe('revocation is deliberately NOT maker-checked', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('takes effect immediately, with one admin', async () => {
    // The plan says maker-checker covers "destructive actions AND role grants", and a reader will
    // assume that includes revocation. It deliberately does not.
    //
    // Requiring a quorum to REMOVE access means a compromised or departing account keeps its
    // powers until a second admin is available. The gate belongs on the direction that creates
    // power, not the one that takes it away — the fail-safe direction.
    const maker = await adminWith('boss@amana-ng.com', ['admin']);
    const target = await adminWith('leaver@amana-ng.com', ['ops']);

    await adminIamService.revokeRole(testDb, {
      actorAdminUserId: maker.id,
      targetAdminUserId: target.id,
      role: 'ops',
    });

    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
  });
});

describe('the bootstrap exemption', () => {
  beforeEach(async () => {
    await truncateAll();
    await adminIdentityService.ensureBootstrapOwner(testDb);
  });

  async function bootstrap() {
    const row = await adminUsersRepo.findByEmail(testDb, 'david@amana-ng.com');
    if (!row) throw new Error('expected the seeded owner');
    return row;
  }

  it('lets the config-seeded account complete a grant alone, so the ceremony is possible', async () => {
    // Without this the exit ceremony from Task 2 deadlocks: the bootstrap account is the only
    // admin, so its proposal to create the first real admin could never find a second approver.
    const boot = await bootstrap();
    const ada = await adminIamService.onboardAdmin(testDb, {
      actorAdminUserId: boot.id,
      email: 'ada@amana-ng.com',
    });

    const result = await adminIamService.grantRole(testDb, {
      actorAdminUserId: boot.id,
      targetAdminUserId: ada.id,
      role: 'admin',
      reason: 'first real admin',
    });

    expect(result.status).toBe('approved');
    expect(await adminIamService.rolesFor(testDb, ada.id)).toEqual(['admin']);
  });

  it('still writes a proposal row, so the exception is visible rather than inferred', async () => {
    const boot = await bootstrap();
    const ada = await adminIamService.onboardAdmin(testDb, {
      actorAdminUserId: boot.id,
      email: 'ada@amana-ng.com',
    });
    const result = await adminIamService.grantRole(testDb, {
      actorAdminUserId: boot.id,
      targetAdminUserId: ada.id,
      role: 'admin',
    });

    // Maker and checker are the same account, on the record. A reader should be able to SEE the
    // exception was used, not deduce it from a missing approval.
    const row = await adminApprovalService.findById(testDb, result.id);
    expect(row?.makerAdminUserId).toBe(boot.id);
    expect(row?.checkerAdminUserId).toBe(boot.id);
  });

  it('is anchored on being config-provisioned, NOT on being the only admin', async () => {
    // The attack this closes: a rogue admin revokes every peer so as to become the sole admin,
    // and then grants at will. Gating on a COUNT would let them re-enter single-admin mode;
    // gating on `provisioningSource` cannot be reached by any admin action.
    const rogue = await adminWith('rogue@amana-ng.com', ['admin']);
    const target = await adminWith('accomplice@amana-ng.com', []);

    // Stand down the bootstrap account so `rogue` really is the only admin who can grant.
    const boot = await bootstrap();
    await adminIamService.revokeRole(testDb, {
      actorAdminUserId: rogue.id,
      targetAdminUserId: boot.id,
      role: 'admin',
    });

    const proposal = await adminIamService.grantRole(testDb, {
      actorAdminUserId: rogue.id,
      targetAdminUserId: target.id,
      role: 'admin',
    });

    expect(proposal.status).toBe('pending');
    expect(await adminIamService.rolesFor(testDb, target.id)).toEqual([]);
    await expect(
      adminIamService.approveRoleGrant(testDb, {
        approvalId: proposal.id,
        checkerAdminUserId: rogue.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('self-extinguishes once the ceremony is done', async () => {
    // After standing down, the bootstrap account holds `owner` only — which has no `iam.write` —
    // so the exemption becomes unreachable without a second config-provisioned row appearing.
    const boot = await bootstrap();
    const ada = await adminIamService.onboardAdmin(testDb, {
      actorAdminUserId: boot.id,
      email: 'ada@amana-ng.com',
    });
    await adminIamService.grantRole(testDb, {
      actorAdminUserId: boot.id,
      targetAdminUserId: ada.id,
      role: 'admin',
    });
    await adminIamService.revokeRole(testDb, {
      actorAdminUserId: ada.id,
      targetAdminUserId: boot.id,
      role: 'admin',
    });

    const someone = await adminWith('someone@amana-ng.com', []);
    await expect(
      adminIamService.grantRole(testDb, {
        actorAdminUserId: boot.id,
        targetAdminUserId: someone.id,
        role: 'ops',
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
