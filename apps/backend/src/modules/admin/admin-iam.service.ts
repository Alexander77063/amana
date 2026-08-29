import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
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

  async grantRole(db: DbOrTx, input: RoleChangeInput, now: Date = new Date()): Promise<void> {
    await changeRole(db, input, true, now);
  },

  async revokeRole(db: DbOrTx, input: RoleChangeInput, now: Date = new Date()): Promise<void> {
    await changeRole(db, input, false, now);
  },
};

async function changeRole(
  db: DbOrTx,
  input: RoleChangeInput,
  granted: boolean,
  now: Date,
): Promise<void> {
  // Order matters: permission first, so someone with no business here learns nothing about who
  // exists from the difference between a 403 and a 404.
  await adminIamService.requirePermission(db, input.actorAdminUserId, 'iam.write');

  // Invariant 1. This is what stops `admin` becoming every other role: without it, the role that
  // hands out access hands itself money power, and the matrix collapses to a single role.
  //
  // Note what it does NOT stop — an admin granting `admin` to a second account they control.
  // That is Task 3's maker-checker, and this invariant should not be read as closing it.
  if (input.actorAdminUserId === input.targetAdminUserId) {
    throw new ForbiddenError('cannot_change_own_roles');
  }

  const target = await adminUsersRepo.findById(db, input.targetAdminUserId);
  if (!target) throw new NotFoundError('admin_not_found');

  if (granted) {
    // Invariant 3, enforced on the target rather than the actor: no account may end up holding
    // both the role that grants access and the role that moves money. Otherwise one admin could
    // simply build that account out of a colleague — or a second account of their own — and the
    // segregation would exist only on paper.
    const [a, b] = MUTUALLY_EXCLUSIVE;
    const other = input.role === a ? b : input.role === b ? a : null;
    if (other) {
      const held = await adminRoleGrantsRepo.currentRoles(db, target.id);
      if (held.includes(other)) throw new ForbiddenError('segregation_of_duties');
    }
  }

  await adminRoleGrantsRepo.append(db, {
    adminUserId: target.id,
    role: input.role,
    granted,
    grantedByAdminUserId: input.actorAdminUserId,
    source: 'admin',
    reason: input.reason ?? null,
  });

  await auditRepo.append(
    db,
    auditEvents.adminRoleChanged({
      actorAdminUserId: input.actorAdminUserId,
      targetAdminUserId: target.id,
      role: input.role,
      granted,
      reason: input.reason ?? null,
      at: now,
    }),
  );
}
