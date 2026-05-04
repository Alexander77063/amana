import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { notificationsRepo } from './notifications.repo';
import { prefsService } from './prefs.service';
import { expoPushProvider } from './providers/expo-push.provider';
import { inAppProvider } from './providers/in-app.provider';
import { termiiSmsProvider } from './providers/termii-sms.provider';
import * as templates from './templates';
import type {
  DispatchResult,
  NotificationChannel,
  NotificationIntent,
  NotificationStatus,
  RenderedNotification,
} from './types';

const CHANNELS: NotificationChannel[] = ['push', 'in_app', 'sms'];

/** Recursively convert BigInt values to strings so payloads are JSONB-safe. */
function sanitizePayload(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>;
}

function render(intent: NotificationIntent): RenderedNotification {
  const ctx = intent.payload as Record<string, unknown>;
  switch (intent.kind) {
    case 'bump_requested':   return templates.bumpRequested(ctx as Parameters<typeof templates.bumpRequested>[0]);
    case 'bump_decided':     return templates.bumpDecided(ctx as Parameters<typeof templates.bumpDecided>[0]);
    case 'txn_settled':      return templates.txnSettled(ctx as Parameters<typeof templates.txnSettled>[0]);
    case 'txn_failed':       return templates.txnFailed(ctx as Parameters<typeof templates.txnFailed>[0]);
    case 'anomaly_alert':    return templates.anomalyAlert(ctx as Parameters<typeof templates.anomalyAlert>[0]);
    case 'refund_received':  return templates.refundReceived(ctx as Parameters<typeof templates.refundReceived>[0]);
  }
}

export const notificationService = {
  async dispatch(db: PostgresJsDatabase, intent: NotificationIntent): Promise<DispatchResult> {
    const rendered = render(intent);
    const rows: DispatchResult['rows'] = [];
    // Pre-sanitize payload once — BigInts become strings for JSONB storage.
    const safePayload = sanitizePayload(intent.payload);

    for (const channel of CHANNELS) {
      const decision = await prefsService.shouldSend(db, intent, channel);
      if (decision !== 'send') {
        const status: NotificationStatus = 'skipped';
        const row = await notificationsRepo.insert(db, {
          recipientUserId: intent.recipientUserId,
          kind: intent.kind,
          channel,
          status,
          dedupeKey: intent.dedupeKey,
          payload: { ...safePayload, _decision: decision },
        });
        rows.push({ notificationId: row.id, channel, status });
        continue;
      }

      // Dedupe: if we've already SENT (or marked read) on this channel for this dedupeKey, skip.
      const existing = await notificationsRepo.findByDedupeKey(db, intent.recipientUserId, channel, intent.dedupeKey);
      if (existing && (existing.status === 'sent' || existing.status === 'read')) {
        rows.push({ notificationId: existing.id, channel, status: existing.status as NotificationStatus });
        continue;
      }

      try {
        if (channel === 'in_app') {
          const r = await inAppProvider.send(db, intent, rendered);
          rows.push({ notificationId: r.notificationId, channel, status: 'sent' });
        } else if (channel === 'push') {
          const r = await expoPushProvider.send(db, intent, rendered);
          const status: NotificationStatus = r.accepted > 0 ? 'sent' : (r.attempted === 0 ? 'skipped' : 'failed');
          const row = await notificationsRepo.insert(db, {
            recipientUserId: intent.recipientUserId,
            kind: intent.kind,
            channel,
            status,
            dedupeKey: intent.dedupeKey,
            payload: { ...safePayload, _expoTickets: r.tickets },
            providerReceipt: r.tickets.find((t) => t.status === 'ok' && 'id' in t)
              ? (r.tickets.find((t) => t.status === 'ok' && 'id' in t) as { id: string }).id
              : null,
          });
          rows.push({ notificationId: row.id, channel, status });
        } else if (channel === 'sms') {
          const r = await termiiSmsProvider.send(db, intent, rendered);
          const status: NotificationStatus = r.kind === 'sent' ? 'sent' : (r.kind === 'failed' ? 'failed' : 'skipped');
          const row = await notificationsRepo.insert(db, {
            recipientUserId: intent.recipientUserId,
            kind: intent.kind,
            channel,
            status,
            dedupeKey: intent.dedupeKey,
            payload: { ...safePayload, _smsResult: r },
            providerReceipt: r.kind === 'sent' ? r.messageId : null,
            errorMessage: r.kind === 'failed' ? r.error : null,
          });
          rows.push({ notificationId: row.id, channel, status });
        }
      } catch (e) {
        logger.error({ err: (e as Error).message, channel, kind: intent.kind }, 'notification dispatch failed');
        const row = await notificationsRepo.insert(db, {
          recipientUserId: intent.recipientUserId,
          kind: intent.kind,
          channel,
          status: 'failed',
          dedupeKey: intent.dedupeKey,
          payload: safePayload,
          errorMessage: (e as Error).message,
        });
        rows.push({ notificationId: row.id, channel, status: 'failed' });
      }
    }

    return { intent, rows };
  },
};
