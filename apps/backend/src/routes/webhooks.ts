import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { auditLog } from '../db/schema';
import { WebhookSignatureError, parseAndVerifyWebhook } from '../integrations/anchor/webhook';
import { logger } from '../lib/logger';

const HEADER = 'x-anchor-signature';

/** Anchor event IDs aren't UUIDs; derive a stable UUID-shaped subject_id from the event id. */
function eventSubjectId(eventId: string): string {
  const hex = createHash('sha256').update(`anchor-evt:${eventId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const webhooksRoute = new Hono().post('/anchor', async (c) => {
  // Read secret at request time so tests can mutate process.env between calls.
  const secret = process.env.ANCHOR_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'webhook_secret_not_configured' }, 503);
  }

  const sig = c.req.header(HEADER) ?? '';
  const raw = await c.req.text();

  let event: ReturnType<typeof parseAndVerifyWebhook>;
  try {
    event = parseAndVerifyWebhook(raw, sig, secret);
  } catch (e) {
    if (e instanceof WebhookSignatureError) {
      logger.warn({ err: (e as Error).message }, 'anchor webhook: bad signature');
      return c.json({ error: 'invalid_signature' }, 401);
    }
    logger.warn({ err: (e as Error).message }, 'anchor webhook: parse failed');
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const subjectId = eventSubjectId(event.id);

  // Idempotent on event.id: skip if we've already recorded it.
  const existing = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM audit_log WHERE subject_id = ${subjectId}::uuid
  `);
  if (existing[0]?.count !== '0') {
    return c.json({ status: 'ok', deduped: true }, 200);
  }

  await db.insert(auditLog).values({
    actorKind: 'partner',
    action: `anchor.webhook.${event.type}`,
    subjectKind: 'anchor_webhook',
    subjectId,
    payloadJson: event as unknown as object,
  });

  return c.json({ status: 'ok' }, 200);
});
