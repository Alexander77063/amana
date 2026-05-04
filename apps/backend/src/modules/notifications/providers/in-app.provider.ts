import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { notificationsRepo } from '../notifications.repo';
import type { NotificationIntent, RenderedNotification } from '../types';

export const inAppProvider = {
  async send(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    rendered: RenderedNotification,
  ): Promise<{ notificationId: string }> {
    const row = await notificationsRepo.insert(db, {
      recipientUserId: intent.recipientUserId,
      kind: intent.kind,
      channel: 'in_app',
      status: 'sent',
      dedupeKey: intent.dedupeKey,
      payload: { title: rendered.title, body: rendered.body, data: rendered.data },
    });
    return { notificationId: row.id };
  },
};
