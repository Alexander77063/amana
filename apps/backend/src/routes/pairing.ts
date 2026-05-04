import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { pairingService } from '../modules/auth/pairing.service';
import { householdsRepo } from '../modules/identity/households.repo';

export const pairingRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const body = await c.req.json<{ householdId: string }>();
    const hh = await householdsRepo.findById(db, body.householdId);
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const t = await pairingService.issue(db, {
      principalUserId: a.userId,
      householdId: body.householdId,
    });
    return c.json(
      {
        pairingTokenId: t.id,
        code: t.code,
        expiresAt: t.expiresAt.toISOString(),
      },
      201,
    );
  });
