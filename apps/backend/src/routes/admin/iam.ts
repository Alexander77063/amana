import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { parseBody, parseParams } from '../../lib/validate';
import { type AdminActorVariables, adminSession } from '../../middleware/admin-session';
import { adminIamService } from '../../modules/admin/admin-iam.service';
import { adminRoleGrantsRepo } from '../../modules/admin/admin-role-grants.repo';

// The closed vocabulary of roles. An unknown role must be a 400 at the edge, never a string that
// reaches the database — a typo'd role would grant nothing while looking like it granted
// something, which is the worst possible failure mode for an access-control system.
const RoleBody = z.object({
  role: z.enum(['owner', 'admin', 'ops', 'support', 'auditor']),
  reason: z.string().max(500).optional(),
});

const OnboardBody = z.object({
  email: z.string().email(),
});

// UUIDs are validated here so a malformed id returns 400 rather than a Postgres 500.
const IdParams = z.object({ id: z.string().uuid() });

/**
 * IAM — who is staff, and what they may do. Mounted at `/admin/iam`, behind `adminSession()`.
 *
 * These handlers are deliberately thin. Every rule that matters — the permission check, the
 * self-edit block, segregation of duties — lives in `admin-iam.service`, because a check
 * performed by a route is a check the next caller can forget. The route's only real job is to
 * take the actor from the SESSION rather than from the request body: an endpoint that accepted
 * "who am I" as a parameter would undo the whole sub-plan.
 */
export const adminIamRoute = new Hono<{ Variables: AdminActorVariables }>()
  .use('*', adminSession())

  .get('/admins', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'iam.read');
    const admins = await adminIamService.listAdmins(db);
    return c.json({
      admins: admins.map((a) => ({
        id: a.id,
        email: a.email,
        displayName: a.displayName,
        status: a.status,
        provisioningSource: a.provisioningSource,
        lastSignedInAt: a.lastSignedInAt?.toISOString() ?? null,
        roles: a.roles,
      })),
    });
  })

  .post('/admins', async (c) => {
    const actor = c.get('adminActor');
    const body = await parseBody(c, OnboardBody);
    if (body instanceof Response) return body;

    const created = await adminIamService.onboardAdmin(db, {
      actorAdminUserId: actor.adminUserId,
      email: body.email,
    });
    // 201 with no roles: they exist, and they can do nothing until someone says otherwise.
    return c.json({ id: created.id, email: created.email, roles: [] }, 201);
  })

  .get('/admins/:id/roles', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    await adminIamService.requirePermission(db, actor.adminUserId, 'iam.read');

    // The LOG, not the fold. "What is true now" is on `/admins`; this answers "how did it get
    // that way", which is the question an incident review actually asks.
    const grants = await adminRoleGrantsRepo.listForAdmin(db, params.id);
    return c.json({
      grants: grants.map((g) => ({
        role: g.role,
        granted: g.granted,
        grantedByAdminUserId: g.grantedByAdminUserId,
        source: g.source,
        reason: g.reason,
        recordedAt: g.recordedAt.toISOString(),
      })),
    });
  })

  .post('/admins/:id/roles', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, RoleBody);
    if (body instanceof Response) return body;

    await adminIamService.grantRole(db, {
      actorAdminUserId: actor.adminUserId,
      targetAdminUserId: params.id,
      role: body.role,
      reason: body.reason ?? null,
    });
    return c.body(null, 204);
  })

  .post('/admins/:id/roles/revoke', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, RoleBody);
    if (body instanceof Response) return body;

    await adminIamService.revokeRole(db, {
      actorAdminUserId: actor.adminUserId,
      targetAdminUserId: params.id,
      role: body.role,
      reason: body.reason ?? null,
    });
    return c.body(null, 204);
  });
