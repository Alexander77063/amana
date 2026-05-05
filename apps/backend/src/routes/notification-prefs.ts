import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { prefsRepo } from '../modules/notifications/prefs.repo';
import type {
  ChannelPreference,
  NotificationChannel,
  NotificationKind,
} from '../modules/notifications/types';

const KINDS: NotificationKind[] = [
  'bump_requested',
  'bump_decided',
  'txn_settled',
  'txn_failed',
  'anomaly_alert',
  'refund_received',
];
const CHANNELS: NotificationChannel[] = ['push', 'sms', 'in_app'];
const PREFS: ChannelPreference[] = ['real_time', 'threshold', 'digest', 'silent'];

export const notificationPrefsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/notification-preferences', async (c) => {
    const a = c.get('actor');
    const rows = await prefsRepo.listByUser(db, a.userId);
    return c.json({ preferences: rows }, 200);
  })
  .put('/me/notification-preferences', async (c) => {
    const a = c.get('actor');
    const body = await c.req.json<{
      kind: NotificationKind;
      channel: NotificationChannel;
      preference: ChannelPreference;
      thresholdKobo?: string | null;
    }>();
    if (
      !KINDS.includes(body.kind) ||
      !CHANNELS.includes(body.channel) ||
      !PREFS.includes(body.preference)
    ) {
      return c.json({ error: 'invalid_param' }, 400);
    }
    const row = await prefsRepo.upsert(db, {
      userId: a.userId,
      kind: body.kind,
      channel: body.channel,
      preference: body.preference,
      thresholdKobo: body.thresholdKobo ? BigInt(body.thresholdKobo) : null,
    });
    return c.json({ preference: row }, 200);
  });
