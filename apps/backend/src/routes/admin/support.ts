import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { parseBody, parseParams } from '../../lib/validate';
import { type AdminActorVariables, adminSession } from '../../middleware/admin-session';
import { adminIamService } from '../../modules/admin/admin-iam.service';
import { supportVerificationService } from '../../modules/support';

const StartBody = z.object({ phone: z.string().regex(/^\+\d{8,15}$/) });
const CodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const IdParams = z.object({ id: z.string().uuid() });

/**
 * Support verification — the operator's side. Mounted at `/admin/support`, behind `adminSession()`.
 *
 * Thin by design: every rule that matters lives in `supportVerificationService`, because a check
 * performed by a route is a check the next caller forgets. The route's own jobs are to take the
 * actor from the SESSION rather than the body, and to decide nothing.
 */
export const adminSupportRoute = new Hono<{ Variables: AdminActorVariables }>()
  .use('*', adminSession())

  .post('/verifications', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'support.verify');
    const body = await parseBody(c, StartBody);
    if (body instanceof Response) return body;

    const result = await supportVerificationService.start(db, {
      actorAdminUserId: actor.adminUserId,
      phoneE164: body.phone,
    });

    if ('capped' in result) {
      // An explicit 429, NOT a silent 202. The no-oracle rule protects whether a CUSTOMER exists;
      // an operator's own quota reveals nothing about that. Swallowing this would leave support
      // watching a verification that was never dispatched and blaming the customer for a limit
      // that staff hit.
      c.header('Retry-After', String(result.retryAfterSeconds));
      return c.json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds }, 429);
    }

    // `decoys` are deliberately NOT returned. The operator reads ONE number aloud; an operator
    // holding all three could read a wrong one and learn from which the customer taps. Nor is the
    // rail returned — that would leak whether the customer has the app installed.
    return c.json({ verificationId: result.verificationId, matchNumber: result.matchNumber }, 202);
  })

  .post('/verifications/:id/code', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'support.verify');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, CodeBody);
    if (body instanceof Response) return body;

    const outcome = await supportVerificationService.confirmCode(db, {
      verificationId: params.id,
      actorAdminUserId: actor.adminUserId,
      code: body.code,
    });
    // Always 200: the outcome is the payload. A 404 for `not_found` would tell an operator which
    // verification ids exist, including ones belonging to a colleague.
    return c.json({ outcome });
  })

  .get('/verifications/:id', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'support.verify');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;

    const status = await supportVerificationService.readStatus(db, {
      verificationId: params.id,
      actorAdminUserId: actor.adminUserId,
    });
    if (!status) return c.json({ error: 'not_found' }, 404);
    return c.json(status);
  });
