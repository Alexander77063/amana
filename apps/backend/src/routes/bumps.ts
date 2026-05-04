import { Hono } from 'hono';
import { db } from '../db/client';
import { actor, type Actor } from '../middleware/actor';
import { bumpWorkflowService } from '../modules/bumps/bump-workflow.service';
import { isOk } from '../lib/result';

export const bumpsRoute = new Hono()
  .use(actor())
  .post('/:id/decision', async (c) => {
    const id = c.req.param('id');
    const a = c.get('actor') as Actor;
    if (a.role !== 'principal') {
      return c.json({ error: 'only_principal_can_decide' }, 403);
    }
    const body = await c.req.json<{ decision: 'approve_once' | 'approve_raise_limit' | 'deny' }>();
    if (!['approve_once', 'approve_raise_limit', 'deny'].includes(body.decision)) {
      return c.json({ error: 'bad_decision' }, 400);
    }
    const result = await bumpWorkflowService.decide(db, {
      bumpRequestId: id,
      decidedByUserId: a.userId,
      decision: body.decision,
      now: new Date(),
    });
    if (isOk(result)) {
      return c.json({
        status: result.value.bumpRequest.status,
        oneShotToken: result.value.oneShotToken?.token ?? null,
      }, 200);
    }
    const status = result.error.code === 'BUMP_NOT_FOUND' ? 404 :
      result.error.code === 'BUMP_EXPIRED' ? 410 :
      409;
    return c.json({ error: result.error.code }, status);
  });
