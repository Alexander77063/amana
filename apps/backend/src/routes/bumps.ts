import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { isOk } from '../lib/result';
import { parseBody, parseParams } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { bumpWorkflowService } from '../modules/bumps/bump-workflow.service';

const ParamsSchema = z.object({ id: z.string().uuid() });
const DecisionSchema = z.object({
  decision: z.enum(['approve_once', 'approve_raise_limit', 'deny']),
});

export const bumpsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/:id/decision', async (c) => {
    const params = parseParams(c, ParamsSchema);
    if (params instanceof Response) return params;
    const a = c.get('actor') as Actor;
    if (a.role !== 'principal') {
      return c.json({ error: 'only_principal_can_decide' }, 403);
    }
    const body = await parseBody(c, DecisionSchema);
    if (body instanceof Response) return body;
    const result = await bumpWorkflowService.decide(db, {
      bumpRequestId: params.id,
      decidedByUserId: a.userId,
      decision: body.decision,
      now: new Date(),
    });
    if (isOk(result)) {
      return c.json(
        {
          status: result.value.bumpRequest.status,
          oneShotToken: result.value.oneShotToken?.token ?? null,
        },
        200,
      );
    }
    const status =
      result.error.code === 'BUMP_NOT_FOUND'
        ? 404
        : result.error.code === 'BUMP_EXPIRED'
          ? 410
          : 409;
    return c.json({ error: result.error.code }, status);
  });
