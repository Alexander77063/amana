import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { deviceTokensRepo } from '../modules/notifications/device-tokens.repo';

export const devicesRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    const RegisterSchema = z.object({
      expoPushToken: z.string().min(1),
      platform: z.enum(['ios', 'android']),
      deviceLabel: z.string().nullable().optional(),
    });
    const body = await parseBody(c, RegisterSchema);
    if (body instanceof Response) return body;
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
