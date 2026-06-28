import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseParams, parseQuery } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { notificationsRepo } from '../modules/notifications/notifications.repo';

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
});
const IdParams = z.object({ id: z.string().uuid() });

export const notificationsListRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/notifications', async (c) => {
    const a = c.get('actor');
    const q = parseQuery(c, ListQuery);
    if (q instanceof Response) return q;
    const rows = await notificationsRepo.listByRecipient(db, a.userId, q.limit);
    return c.json({ notifications: rows }, 200);
  })
  .post('/me/notifications/:id/read', async (c) => {
    const a = c.get('actor');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const ok = await notificationsRepo.markRead(db, params.id, a.userId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ marked: true }, 200);
  });
