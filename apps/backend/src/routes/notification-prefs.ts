import { QuietHoursSchema } from '@amana/validation';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { prefsRepo } from '../modules/notifications/prefs.repo';
import { quietHoursRepo } from '../modules/notifications/quiet-hours.repo';

const QUIET_HOURS_DEFAULT = { enabled: false, startMinute: 1320, endMinute: 420 } as const;

const NotificationPreferenceSchema = z.object({
  kind: z.enum([
    'bump_requested',
    'bump_decided',
    'txn_settled',
    'txn_failed',
    'anomaly_alert',
    'refund_received',
  ]),
  channel: z.enum(['push', 'sms', 'in_app']),
  preference: z.enum(['real_time', 'threshold', 'digest', 'silent']),
  thresholdKobo: z.string().nullable().optional(),
});

export const notificationPrefsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/notification-preferences', async (c) => {
    const a = c.get('actor');
    const rows = await prefsRepo.listByUser(db, a.userId);
    return c.json({ preferences: rows }, 200);
  })
  .put('/me/notification-preferences', async (c) => {
    const a = c.get('actor');
    const body = await parseBody(c, NotificationPreferenceSchema);
    if (body instanceof Response) return body;
    const row = await prefsRepo.upsert(db, {
      userId: a.userId,
      kind: body.kind,
      channel: body.channel,
      preference: body.preference,
      thresholdKobo: body.thresholdKobo ? BigInt(body.thresholdKobo) : null,
    });
    return c.json({ preference: row }, 200);
  })
  .get('/me/quiet-hours', async (c) => {
    const a = c.get('actor');
    const row = await quietHoursRepo.get(db, a.userId);
    return c.json(row ?? QUIET_HOURS_DEFAULT, 200);
  })
  .put('/me/quiet-hours', async (c) => {
    const a = c.get('actor');
    const body = await c.req.json().catch(() => null);
    const parsed = QuietHoursSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_param', details: parsed.error.flatten() }, 400);
    }
    await quietHoursRepo.upsert(db, a.userId, parsed.data);
    return c.json(parsed.data, 200);
  });
