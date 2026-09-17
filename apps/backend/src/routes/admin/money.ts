import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { anchorAdapterSingleton } from '../../integrations/anchor';
import { parseBody, parseParams } from '../../lib/validate';
import { type AdminActorVariables, adminSession } from '../../middleware/admin-session';
import { adminIamService } from '../../modules/admin/admin-iam.service';
import { MoneyOpsError, moneyOpsService } from '../../modules/admin/money-ops.service';

const ElevateBody = z.object({
  transactionId: z.string().uuid(),
  // A ten-character floor keeps "fix" out of the audit log while staying typable at 02:00.
  reason: z.string().trim().min(10).max(500),
});
const IdParams = z.object({ id: z.string().uuid() });

/**
 * Money operations — the only operator-invokable money surface (sub-plan A1 Task 7). Mounted at
 * `/admin/money`, behind `adminSession()`.
 *
 * Thin by design. Every rule lives in `moneyOpsService`; the route's jobs are to take the actor
 * from the SESSION rather than the body, to check the permission, and to turn a refusal into a
 * status. It decides nothing — in particular it never chooses a settle-or-reverse outcome, because
 * Anchor does.
 */
export const adminMoneyRoute = new Hono<{ Variables: AdminActorVariables }>()
  .use('*', adminSession())

  .get('/stuck', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'money.operate');

    // Reading the queue is not operating on it, so no elevation is required here. The flow is:
    // see the row, elevate for that row, resolve that row.
    const rows = await moneyOpsService.listStuck(db, new Date());
    return c.json({
      transactions: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        amountKobo: r.amountKobo.toString(),
        createdAt: r.createdAt.toISOString(),
        vendorResolvedName: r.vendorResolvedName,
      })),
    });
  })

  .post('/elevations', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'money.operate');
    const body = await parseBody(c, ElevateBody);
    if (body instanceof Response) return body;

    const out = await moneyOpsService.grantElevation(db, {
      actorAdminUserId: actor.adminUserId,
      transactionId: body.transactionId,
      reason: body.reason,
      now: new Date(),
    });

    return c.json({ elevationId: out.elevationId, expiresAt: out.expiresAt.toISOString() }, 201);
  })

  .post('/transactions/:id/resolve', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'money.operate');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;

    try {
      const out = await moneyOpsService.resolveStuckTransaction(db, anchorAdapterSingleton, {
        actorAdminUserId: actor.adminUserId,
        transactionId: params.id,
        now: new Date(),
      });
      return c.json(out);
    } catch (e) {
      // One mapping for every refusal: the error already carries its own status, so the route does
      // not keep a second table that could drift from the service's.
      if (e instanceof MoneyOpsError) return c.json({ error: e.code }, e.httpStatus);
      throw e;
    }
  });
