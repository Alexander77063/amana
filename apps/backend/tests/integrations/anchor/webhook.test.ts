import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WebhookSignatureError,
  parseAndVerifyWebhook,
} from '../../../src/integrations/anchor/webhook';

const SECRET = 'whsec_test';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('parseAndVerifyWebhook', () => {
  it('parses a correctly-signed webhook event', () => {
    const body = JSON.stringify({
      id: 'evt-1',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: { transferId: 't-1', reference: 'k-1', status: 'COMPLETED', nibssSessionId: '12345' },
    });
    const sig = sign(body);
    const result = parseAndVerifyWebhook(body, sig, SECRET);
    expect(result.type).toBe('transfer.completed');
    expect(result.id).toBe('evt-1');
  });

  it('throws WebhookSignatureError on bad signature', () => {
    const body = JSON.stringify({
      id: 'evt-2',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: {},
    });
    expect(() => parseAndVerifyWebhook(body, 'wrong-sig', SECRET)).toThrow(WebhookSignatureError);
  });

  it('throws WebhookSignatureError on tampered body', () => {
    const body = JSON.stringify({
      id: 'evt-3',
      type: 'transfer.completed',
      createdAt: '2026-05-03T00:00:00Z',
      data: {},
    });
    const sig = sign(body);
    const tampered = body.replace('evt-3', 'evt-4');
    expect(() => parseAndVerifyWebhook(tampered, sig, SECRET)).toThrow(WebhookSignatureError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseAndVerifyWebhook('not-json', sign('not-json'), SECRET)).toThrow(/JSON|parse/);
  });

  it('rejects events missing required fields (id, type, createdAt, data)', () => {
    const body = JSON.stringify({ type: 'transfer.completed' });
    const sig = sign(body);
    expect(() => parseAndVerifyWebhook(body, sig, SECRET)).toThrow(/required|missing/i);
  });
});
