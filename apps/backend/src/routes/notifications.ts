import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { notificationsRepo } from '../modules/notifications/notifications.repo';

export const notificationsListRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/notifications', async (c) => {
    const a = c.get('actor');
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);
    const rows = await notificationsRepo.listByRecipient(db, a.userId, limit);
    return c.json({ notifications: rows }, 200);
  })
  .post('/me/notifications/:id/read', async (c) => {
    const a = c.get('actor');
    const ok = await notificationsRepo.markRead(db, c.req.param('id'), a.userId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ marked: true }, 200);
  });
