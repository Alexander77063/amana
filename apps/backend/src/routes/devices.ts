import { Hono } from 'hono';
import { db } from '../db/client';
import { actor, type Actor, type ActorVariables } from '../middleware/actor';
import { deviceTokensRepo } from '../modules/notifications/device-tokens.repo';

export const devicesRoute = new Hono<{ Variables: ActorVariables }>()
  .use(actor())
  .post('/', async (c) => {
    const a = c.get('actor');
    const body = await c.req.json<{
      expoPushToken: string;
      platform: 'ios' | 'android';
      deviceLabel?: string | null;
    }>();
    if (!body.expoPushToken || !body.platform) {
      return c.json({ error: 'missing_params' }, 400);
    }
    const row = await deviceTokensRepo.register(db, {
      userId: a.userId,
      expoPushToken: body.expoPushToken,
      platform: body.platform,
      deviceLabel: body.deviceLabel ?? null,
    });
    return c.json({ id: row.id }, 201);
  })
  .delete('/:id', async (c) => {
    const a = c.get('actor');
    const id = c.req.param('id');
    const ok = await deviceTokensRepo.deleteById(db, id, a.userId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: true }, 200);
  });
