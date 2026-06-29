import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { db } from '../db/client';
import { auditLog } from '../db/schema';
import type {
  AnchorKycApprovedData,
  AnchorKycRejectedData,
  AnchorTransferEventData,
  AnchorVirtualAccountCreditedData,
} from '../integrations/anchor/types';
import { WebhookSignatureError, parseAndVerifyWebhook } from '../integrations/anchor/webhook';
import { kobo } from '../lib/kobo';
import { logger } from '../lib/logger';
import { usersRepo } from '../modules/identity/users.repo';
import { reversalService } from '../modules/transactions/reversal.service';
import { settlementService } from '../modules/transactions/settlement.service';
import { topupService } from '../modules/transactions/topup.service';
import { transactionsRepo } from '../modules/wallet/transactions.repo';

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

  // Claim + dispatch ATOMICALLY in one transaction. The partial unique index on
  // (subject_id) WHERE subject_kind='anchor_webhook' dedupes concurrent/replayed
  // deliveries (the loser's insert returns no row → skip dispatch). If a handler
  // throws, the whole transaction — including the dedupe claim — rolls back, so
  // we return 5xx and Anchor redelivers (no silently-dropped events). Handlers
  // are idempotent (status / idempotency-key guards), so retries are safe.
  // "No matching txn/user" is not an error: it commits the claim and acks 200.
  let deduped = false;
  try {
    await db.transaction(async (txx) => {
      const tx = txx as unknown as PostgresJsDatabase;
      const claimed = await tx
        .insert(auditLog)
        .values({
          actorKind: 'partner',
          action: `anchor.webhook.${event.type}`,
          subjectKind: 'anchor_webhook',
          subjectId,
          payloadJson: event as unknown as object,
        })
        .onConflictDoNothing({
          target: auditLog.subjectId,
          where: sql`subject_kind = 'anchor_webhook'`,
        })
        .returning({ id: auditLog.id });
      if (claimed.length === 0) {
        deduped = true;
        return;
      }

      if (event.type === 'transfer.completed') {
        const data = event.data as AnchorTransferEventData;
        const txn = await transactionsRepo.findByIdempotencyKey(tx, data.reference);
        if (txn) {
          await settlementService.finalise(tx, {
            transactionId: txn.id,
            nibssSessionId: data.nibssSessionId ?? null,
            settledAt: new Date(event.createdAt),
          });
        } else {
          logger.warn({ reference: data.reference }, 'transfer.completed: no matching txn');
        }
      } else if (event.type === 'transfer.failed') {
        const data = event.data as AnchorTransferEventData;
        const txn = await transactionsRepo.findByIdempotencyKey(tx, data.reference);
        if (txn) {
          await reversalService.reverse(tx, {
            transactionId: txn.id,
            reason: data.failureReason ?? null,
            failedAt: new Date(event.createdAt),
          });
        } else {
          logger.warn({ reference: data.reference }, 'transfer.failed: no matching txn');
        }
      } else if (event.type === 'virtual_account.credited') {
        const data = event.data as AnchorVirtualAccountCreditedData;
        await topupService.handle(tx, {
          virtualAccountId: data.virtualAccountId,
          amountKobo: kobo(BigInt(data.amountKobo as unknown as string)),
          nibssSessionId: data.nibssSessionId,
          senderBankCode: data.senderBankCode,
          senderAccountNumber: data.senderAccountNumber,
          senderAccountName: data.senderAccountName,
          receivedAt: new Date(event.createdAt),
        });
      } else if (event.type === 'kyc.approved') {
        const data = event.data as AnchorKycApprovedData;
        const ourTier = data.newKycLevel === 'TIER_3' ? '3' : '2';
        const user = await usersRepo.findByAnchorCustomerId(tx, data.customerId);
        if (user) {
          await usersRepo.setKycTier(tx, user.id, ourTier);
        } else {
          logger.warn({ customerId: data.customerId }, 'kyc.approved: no matching user');
        }
      } else if (event.type === 'kyc.rejected') {
        const data = event.data as AnchorKycRejectedData;
        logger.warn({ customerId: data.customerId, reason: data.reason }, 'kyc.rejected');
      } else {
        logger.info({ type: event.type }, 'anchor webhook: unhandled event type');
      }
    });
  } catch (e) {
    // Transient/infra failure → claim rolled back; 5xx so Anchor retries.
    logger.error(
      { err: (e as Error).message, type: event.type },
      'anchor webhook handler failed — will retry',
    );
    return c.json({ error: 'handler_failed' }, 500);
  }

  return c.json({ status: 'ok', deduped }, 200);
});
