import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { type AdminApprovalRow, adminApprovalService } from './admin-approval.service';
import { normaliseEmail } from './admin-identity.service';
import { type AdminRole, adminRoleGrantsRepo } from './admin-role-grants.repo';
import { type AdminUserRow, adminUsersRepo } from './admin-users.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * What an admin may do, named as capabilities rather than as routes.
 *
 * Permissions exist so a route never asks "is this person an `ops`?" — it asks whether they may
 * do the thing. That indirection is what lets the role matrix change without every call site
 * changing with it, and it keeps the matrix readable as one table.
 */
export const ADMIN_PERMISSIONS = [
  'vendor.read',
  'vendor.write',
  'retailer.read',
  'retailer.write',
  'iam.read',
  'iam.write',
  'audit.read',
  'support.verify',
  'support.read',
  'money.operate',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * The role matrix, in code. Mirrors the table in the sub-plan; the doc is the explanation and this
 * is the enforcement, so change them together.
 *
 * The two entries worth reading twice are `owner` and `admin`. `owner` has `money.operate` and
 * NOT `iam.write`; `admin` has `iam.write` and NOT `money.operate`. That is invariant 3 —
 * segregation of duties — and it is the whole reason neither role can become the other alone.
 */
const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  // Money power is granted here but is NOT standing power: Task 7 puts it behind JIT elevation,
  // so holding `owner` is permission to *request* it, with a reason and an expiry.
  // `iam.read` so an owner can see who holds access without being able to change it.
  owner: ['money.operate', 'iam.read'],
  // Onboards admins and moves roles around. Deliberately blind to customer data and to money.
  admin: ['iam.read', 'iam.write'],
  // The day job: the vendor claim queue, retailer KYB, suspensions, categories.
  ops: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'],
  // Task 6 builds this out. Reads only, and only after the customer has verified electronically.
  support: ['support.verify', 'support.read'],
  // Reads everything, including the audit log. Writes nothing, anywhere.
  auditor: ['audit.read', 'iam.read', 'vendor.read', 'retailer.read'],
};

/** Roles that may never be held together, because holding both defeats segregation of duties. */
const MUTUALLY_EXCLUSIVE: readonly [AdminRole, AdminRole] = ['admin', 'owner'];

export type RoleChangeInput = {
  actorAdminUserId: string;
  targetAdminUserId: string;
  role: AdminRole;
  reason?: string | null;
};

export const adminIamService = {
  async rolesFor(db: DbOrTx, adminUserId: string): Promise<AdminRole[]> {
    return adminRoleGrantsRepo.currentRoles(db, adminUserId);
  },

  async permissionsFor(db: DbOrTx, adminUserId: string): Promise<AdminPermission[]> {
    const roles = await adminRoleGrantsRepo.currentRoles(db, adminUserId);
    const permissions = new Set<AdminPermission>();
    for (const role of roles) {
      for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission);
    }
    return [...permissions];
  },

  /**
   * The gate every permissioned admin action goes through. Throws rather than returning a
   * boolean, so a caller who forgets to check the result still fails closed.
   */
  async requirePermission(
    db: DbOrTx,
    adminUserId: string,
    permission: AdminPermission,
  ): Promise<void> {
    const admin = await adminUsersRepo.findById(db, adminUserId);
    // Suspension bites here, not only at the session. A cookie minted before someone was
    // suspended must stop being able to DO things, not merely stop being renewed.
    if (!admin || admin.status !== 'active') throw new ForbiddenError('admin_not_active');

    const permissions = await adminIamService.permissionsFor(db, adminUserId);
    if (!permissions.includes(permission)) throw new ForbiddenError('missing_permission');
  },

  async listAdmins(db: DbOrTx): Promise<(AdminUserRow & { roles: AdminRole[] })[]> {
    const admins = await adminUsersRepo.listAll(db);
    const withRoles = [];
    for (const admin of admins) {
      withRoles.push({ ...admin, roles: await adminRoleGrantsRepo.currentRoles(db, admin.id) });
    }
    return withRoles;
  },

  /**
   * Create an admin record for a colleague. They get NO roles (invariant 4) and can do nothing
   * until someone grants one, explicitly and attributably.
   */
  async onboardAdmin(
    db: DbOrTx,
    input: { actorAdminUserId: string; email: string },
    now: Date = new Date(),
  ): Promise<AdminUserRow> {
    await adminIamService.requirePermission(db, input.actorAdminUserId, 'iam.write');

    const email = normaliseEmail(input.email);
    // The Workspace domain is the identity boundary, so it is enforced on the way IN as well as
    // at sign-in. Creating a record that could never sign in is not a useful thing to allow.
    if (email.split('@')[1] !== env.ADMIN_WORKSPACE_DOMAIN.toLowerCase()) {
      throw new ForbiddenError('outside_workspace_domain');
    }

    const existing = await adminUsersRepo.findByEmail(db, email);
    if (existing) return existing;

    const created = await adminUsersRepo.insertIfAbsent(db, {
      email,
      provisioningSource: 'admin',
    });
    if (!created) throw new ForbiddenError('admin_already_exists');

    await auditRepo.append(
      db,
      auditEvents.adminOnboarded({
        actorAdminUserId: input.actorAdminUserId,
        newAdminUserId: created.id,
        email,
        at: now,
      }),
    );
    return created;
  },

  /**
   * PROPOSE a role grant. It does not take effect until a different admin approves it.
   *
   * Returns the proposal, whose `status` tells the caller what happened: `pending` in the normal
   * case, or `approved` when the config-seeded bootstrap account used its exemption and the grant
   * has already been applied.
   */
  async grantRole(
    db: DbOrTx,
    input: RoleChangeInput,
    now: Date = new Date(),
  ): Promise<AdminApprovalRow> {
    await adminIamService.requirePermission(db, input.actorAdminUserId, 'iam.write');
    // Checked at proposal time as well as at apply time so an impossible request is refused
    // immediately rather than sitting in someone's inbox for a week before failing.
    await assertGrantable(db, input);

    // The bootstrap exemption. Anchored on `provisioningSource === 'config'` — an immutable
    // property of one row that NO admin action can confer — and deliberately not on "is the only
    // admin", which is a count and therefore attackable: a rogue admin could revoke every peer
    // (revocation being immediate) to re-enter single-admin mode and then grant at will.
    //
    // It exists because without it the Task 2 exit ceremony deadlocks: the bootstrap account is
    // the only admin, so its proposal to create the first real admin could never find a second
    // approver. It self-extinguishes — once stood down, the account holds `owner` only, which has
    // no `iam.write`, so `requirePermission` above already refuses it.
    const actor = await adminUsersRepo.findById(db, input.actorAdminUserId);
    const selfApprove = actor?.provisioningSource === 'config';

    const proposal = await adminApprovalService.propose(
      db,
      {
        kind: 'role_grant',
        makerAdminUserId: input.actorAdminUserId,
        payload: { targetAdminUserId: input.targetAdminUserId, role: input.role },
        reason: input.reason ?? null,
        selfApprove,
      },
      now,
    );

    if (selfApprove) {
      await applyRoleGrant(db, input.actorAdminUserId, input, now);
    }
    return proposal;
  },

  /**
   * Approve someone else's proposed grant, and apply it.
   *
   * The checker must be able to grant roles themselves — two people is only a control if both
   * could have done it alone — and must not be the maker.
   */
  async approveRoleGrant(
    db: DbOrTx,
    input: { approvalId: string; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<void> {
    await adminIamService.requirePermission(db, input.checkerAdminUserId, 'iam.write');

    const proposal = await adminApprovalService.findById(db, input.approvalId);
    if (!proposal) throw new NotFoundError('approval_not_found');
    if (proposal.kind !== 'role_grant') throw new ConflictError('wrong_approval_kind');

    const payload = proposal.payloadJson as { targetAdminUserId: string; role: AdminRole };
    const change: RoleChangeInput = {
      actorAdminUserId: proposal.makerAdminUserId,
      targetAdminUserId: payload.targetAdminUserId,
      role: payload.role,
      // Carried from the proposal onto the grant row. The maker's justification is the answer to
      // "why does this person have this role", and it belongs on the grant that is read later,
      // not only on an approval nobody will think to look up.
      reason: proposal.reason,
    };

    // RE-VALIDATE against the world as it is now, not as it was when this was proposed. Days can
    // pass: the target may have been suspended, or acquired the mutually exclusive role by
    // another route. A proposal is a request, never a pre-authorised write.
    await assertGrantable(db, change);

    // Claim the proposal first. The conditional UPDATE inside means two checkers racing cannot
    // both win, so the grant is applied exactly once.
    await adminApprovalService.approve(db, input, now);
    await applyRoleGrant(db, proposal.makerAdminUserId, change, now);
  },

  /**
   * Revoke a role. Takes effect IMMEDIATELY — deliberately not maker-checked.
   *
   * The plan says maker-checker covers "destructive actions and role grants", and revocation
   * reads as destructive. It is not gated, because requiring a quorum to REMOVE access means a
   * compromised or departing account keeps its powers until a second admin is available. The gate
   * belongs on the direction that creates power; taking it away must always be possible alone.
   */
  async revokeRole(db: DbOrTx, input: RoleChangeInput, now: Date = new Date()): Promise<void> {
    await adminIamService.requirePermission(db, input.actorAdminUserId, 'iam.write');
    if (input.actorAdminUserId === input.targetAdminUserId) {
      throw new ForbiddenError('cannot_change_own_roles');
    }
    const target = await adminUsersRepo.findById(db, input.targetAdminUserId);
    if (!target) throw new NotFoundError('admin_not_found');

    await applyRoleChange(db, input.actorAdminUserId, input, false, now);
  },
};

/**
 * Everything that must be true for a grant to be legal, checked against the CURRENT world.
 *
 * Called twice on purpose — once when proposing, so an impossible request fails immediately
 * instead of waiting a week in an inbox, and again when approving, because the days in between
 * are real and the target may have been suspended or acquired the exclusive role since.
 */
async function assertGrantable(db: DbOrTx, input: RoleChangeInput): Promise<void> {
  // Invariant 1. This is what stops `admin` becoming every other role: without it, the role that
  // hands out access hands itself money power, and the matrix collapses to a single role.
  if (input.actorAdminUserId === input.targetAdminUserId) {
    throw new ForbiddenError('cannot_change_own_roles');
  }

  const target = await adminUsersRepo.findById(db, input.targetAdminUserId);
  if (!target) throw new NotFoundError('admin_not_found');
  // Granting a role to a suspended account would quietly arm it for whenever it is reinstated.
  if (target.status !== 'active') throw new ForbiddenError('target_not_active');

  // Invariant 3, enforced on the TARGET rather than the actor: no account may end up holding both
  // the role that grants access and the role that moves money. Checking only the actor would let
  // one admin build that merged account out of a colleague — or a second account of their own —
  // and the segregation would exist only on paper.
  const [a, b] = MUTUALLY_EXCLUSIVE;
  const other = input.role === a ? b : input.role === b ? a : null;
  if (other) {
    const held = await adminRoleGrantsRepo.currentRoles(db, target.id);
    if (held.includes(other)) throw new ForbiddenError('segregation_of_duties');
  }
}

/** Apply an approved grant. Callers have already established that it is legal. */
async function applyRoleGrant(
  db: DbOrTx,
  granterAdminUserId: string,
  input: RoleChangeInput,
  now: Date,
): Promise<void> {
  await applyRoleChange(db, granterAdminUserId, input, true, now);
}

/**
 * Write the grant row and its audit event.
 *
 * `granterAdminUserId` is the MAKER, not the checker: the maker asked for it and is the person
 * the grant is attributed to, while the checker's agreement is recorded on the approval. Both are
 * answerable, for different things.
 */
async function applyRoleChange(
  db: DbOrTx,
  granterAdminUserId: string,
  input: RoleChangeInput,
  granted: boolean,
  now: Date,
): Promise<void> {
  await adminRoleGrantsRepo.append(db, {
    adminUserId: input.targetAdminUserId,
    role: input.role,
    granted,
    grantedByAdminUserId: granterAdminUserId,
    source: 'admin',
    reason: input.reason ?? null,
  });

  await auditRepo.append(
    db,
    auditEvents.adminRoleChanged({
      actorAdminUserId: granterAdminUserId,
      targetAdminUserId: input.targetAdminUserId,
      role: input.role,
      granted,
      reason: input.reason ?? null,
      at: now,
    }),
  );
}
