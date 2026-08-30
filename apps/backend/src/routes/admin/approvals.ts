import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { parseBody, parseParams } from '../../lib/validate';
import { type AdminActorVariables, adminSession } from '../../middleware/admin-session';
import { adminApprovalDispatch } from '../../modules/admin/admin-approval-dispatch.service';
import { adminApprovalService } from '../../modules/admin/admin-approval.service';
import { adminIamService } from '../../modules/admin/admin-iam.service';

const IdParams = z.object({ id: z.string().uuid() });
const DecisionBody = z.object({ reason: z.string().max(500).optional() });

/**
 * The maker-checker inbox. Mounted at `/admin/approvals`.
 *
 * Deliberately NOT under `/admin/iam`, where it started life in Task 3. It is one queue spanning
 * several domains — role grants and vendor claim approvals today, more later — and filing it under
 * IAM would mislead the first person who finds a vendor approval in it.
 *
 * Approving DISPATCHES on the approval's kind (`admin-approval-dispatch.service`), because
 * applying an approved action is domain work while queueing it is not.
 */
export const adminApprovalsRoute = new Hono<{ Variables: AdminActorVariables }>()
  .use('*', adminSession())

  .get('/', async (c) => {
    const actor = c.get('adminActor');
    // `iam.read` gates the inbox as a whole. It lists WHAT is awaiting a decision, not the
    // contents of any customer or merchant record, so it does not need per-domain read rights —
    // and the decision endpoints below each enforce the permission for their own kind.
    await adminIamService.requirePermission(db, actor.adminUserId, 'iam.read');
    const pending = await adminApprovalService.listPending(db);
    return c.json({
      approvals: pending.map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        payload: a.payloadJson,
        makerAdminUserId: a.makerAdminUserId,
        reason: a.reason,
        expiresAt: a.expiresAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
      })),
    });
  })

  .post('/:id/approve', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, DecisionBody);
    if (body instanceof Response) return body;

    const outcome = await adminApprovalDispatch.approve(db, {
      approvalId: params.id,
      checkerAdminUserId: actor.adminUserId,
      reason: body.reason ?? null,
    });
    // A vendor claim mints a public code the checker must read back to the merchant, so this
    // returns 200 with a body rather than a bare 204.
    return c.json(outcome, 200);
  })

  .post('/:id/reject', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, DecisionBody);
    if (body instanceof Response) return body;

    // Rejecting decides nothing domain-specific — it just closes the request — so it needs no
    // dispatch. The permission to reject is the permission to have an opinion on the queue.
    await adminIamService.requirePermission(db, actor.adminUserId, 'iam.read');
    await adminApprovalService.reject(db, {
      approvalId: params.id,
      checkerAdminUserId: actor.adminUserId,
      reason: body.reason ?? null,
    });
    return c.body(null, 204);
  })

  .post('/:id/cancel', async (c) => {
    const actor = c.get('adminActor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;

    // No permission check beyond the session: cancelling is withdrawing your OWN request, and the
    // service refuses anyone who is not the maker. Someone who has since lost the permission
    // should still be able to take back a proposal they made.
    await adminApprovalService.cancel(db, {
      approvalId: params.id,
      makerAdminUserId: actor.adminUserId,
    });
    return c.body(null, 204);
  });
