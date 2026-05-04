import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../../env';
import { logger } from '../../../lib/logger';
import { deviceTokensRepo } from '../device-tokens.repo';
import type { NotificationIntent, RenderedNotification } from '../types';

const expo = new Expo({
  accessToken: env.EXPO_ACCESS_TOKEN,
});

export type ExpoSendResult = {
  attempted: number;
  accepted: number;
  rejected: number;
  tickets: ExpoPushTicket[];
};

export const expoPushProvider = {
  async send(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    rendered: RenderedNotification,
  ): Promise<ExpoSendResult> {
    const tokens = await deviceTokensRepo.listByUser(db, intent.recipientUserId);
    if (tokens.length === 0) {
      return { attempted: 0, accepted: 0, rejected: 0, tickets: [] };
    }

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.expoPushToken))
      .map((t) => ({
        to: t.expoPushToken,
        title: rendered.title,
        body: rendered.body,
        data: rendered.data,
        sound: 'default',
      }));

    if (messages.length === 0) {
      return { attempted: tokens.length, accepted: 0, rejected: tokens.length, tickets: [] };
    }

    const tickets: ExpoPushTicket[] = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const sent = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...sent);
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'expo push send failed');
        // Mark every token in this chunk as rejected by emitting an error ticket.
        for (let i = 0; i < chunk.length; i++) {
          tickets.push({ status: 'error', message: (e as Error).message } as ExpoPushTicket);
        }
      }
    }

    const accepted = tickets.filter((t) => t.status === 'ok').length;
    return { attempted: messages.length, accepted, rejected: messages.length - accepted, tickets };
  },
};
