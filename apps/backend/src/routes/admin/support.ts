import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { parseBody, parseParams } from '../../lib/validate';
import { type AdminActorVariables, adminSession } from '../../middleware/admin-session';
import { adminIamService } from '../../modules/admin/admin-iam.service';
import { auditRepo } from '../../modules/audit';
import {
  SupportSessionError,
  supportReadService,
  supportVerificationService,
} from '../../modules/support';

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

  // The three reads. Each one: support.read, then a LIVE session for this operator, then audit.
  // The session gate is what makes these safe; the permission alone is not enough, because
  // `support.read` without a verified customer must show nothing at all.
  .get('/verifications/:id/overview', async (c) => {
    return readEndpoint(c, 'overview', (db, userId) => supportReadService.overview(db, userId));
  })

  .get('/verifications/:id/transactions', async (c) => {
    return readEndpoint(c, 'transactions', (db, userId) =>
      supportReadService.transactions(db, userId),
    );
  })

  .get('/verifications/:id/rules', async (c) => {
    return readEndpoint(c, 'rules', async (db, userId) => ({
      rules: await supportReadService.rules(db, userId),
    }));
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

/**
 * Shared shape for the three reads. Kept as one helper rather than repeated three times so the
 * gate and the audit write cannot drift apart between endpoints — a read that forgot to audit
 * would be invisible precisely when it mattered.
 */
async function readEndpoint(
  c: Context<{ Variables: AdminActorVariables }>,
  what: 'overview' | 'transactions' | 'rules',
  read: (database: typeof db, userId: string) => Promise<unknown>,
): Promise<Response> {
  const actor = c.get('adminActor');
  await adminIamService.requirePermission(db, actor.adminUserId, 'support.read');
  const params = parseParams(c, IdParams);
  if (params instanceof Response) return params;

  let verification: Awaited<ReturnType<typeof supportVerificationService.requireLiveSession>>;
  try {
    verification = await supportVerificationService.requireLiveSession(db, {
      verificationId: params.id,
      actorAdminUserId: actor.adminUserId,
    });
  } catch (e) {
    if (e instanceof SupportSessionError) return c.json({ error: 'no_live_session' }, 403);
    throw e;
  }

  const body = await read(db, verification.userId as string);

  // Reading customer financial data is itself an event.
  await auditRepo.append(db, {
    actorKind: 'ops',
    actorAdminUserId: actor.adminUserId,
    action: `support.read.${what}`,
    subjectKind: 'support_verification',
    subjectId: verification.id,
    payloadJson: {},
  });

  return c.json(body as Record<string, unknown>);
}
