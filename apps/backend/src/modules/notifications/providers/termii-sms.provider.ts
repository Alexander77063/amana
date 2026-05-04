import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users } from '../../../db/schema';
import { env } from '../../../env';
import { logger } from '../../../lib/logger';
import { TermiiClient } from '../../../integrations/termii';
import type { NotificationIntent, RenderedNotification } from '../types';

const client = env.TERMII_API_KEY ? new TermiiClient(env.TERMII_BASE_URL) : null;

export type SmsSendResult =
  | { kind: 'sent'; messageId: string }
  | { kind: 'skipped_no_key' }
  | { kind: 'skipped_no_phone' }
  | { kind: 'failed'; error: string };

export const termiiSmsProvider = {
  async send(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    rendered: RenderedNotification,
  ): Promise<SmsSendResult> {
    if (!client || !env.TERMII_API_KEY) {
      logger.warn({ kind: intent.kind, recipientUserId: intent.recipientUserId },
        'termii: no API key configured, skipping SMS send');
      return { kind: 'skipped_no_key' };
    }
    const [user] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, intent.recipientUserId))
      .limit(1);
    if (!user?.phone) return { kind: 'skipped_no_phone' };

    try {
      const res = await client.sendSms({
        to: user.phone,
        from: env.TERMII_SENDER_ID,
        sms: `${rendered.title}: ${rendered.body}`,
        type: 'plain',
        channel: 'generic',
        apiKey: env.TERMII_API_KEY,
      });
      return { kind: 'sent', messageId: res.message_id };
    } catch (e) {
      return { kind: 'failed', error: (e as Error).message };
    }
  },
};
