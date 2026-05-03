import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AnchorWebhookEvent, AnchorWebhookEventType } from './types';

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

const KNOWN_TYPES: ReadonlySet<AnchorWebhookEventType> = new Set([
  'transfer.completed',
  'transfer.failed',
  'virtual_account.credited',
  'kyc.approved',
  'kyc.rejected',
]);

export function parseAndVerifyWebhook(
  rawBody: string,
  signatureHex: string,
  secret: string,
): AnchorWebhookEvent {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!safeEqualHex(expected, signatureHex)) {
    throw new WebhookSignatureError('signature mismatch');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e) {
    throw new Error(`webhook JSON parse failed: ${(e as Error).message}`);
  }
  if (!isObject(parsed)) throw new Error('webhook payload not an object');
  const { id, type, createdAt, data } = parsed as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof type !== 'string' ||
    data === undefined
  ) {
    throw new Error('webhook payload missing required fields');
  }
  if (!KNOWN_TYPES.has(type as AnchorWebhookEventType)) {
    throw new Error(`unknown webhook type: ${type}`);
  }
  return { id, type: type as AnchorWebhookEventType, createdAt, data };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
