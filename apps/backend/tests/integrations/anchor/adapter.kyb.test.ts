import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { idempotencyKeys } from '../../../src/db/schema';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { parseAndVerifyWebhook } from '../../../src/integrations/anchor/webhook';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

function adapterWith(fetchSpy: ReturnType<typeof vi.fn>) {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
}

function okResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AnchorAdapter.createBusinessCustomer', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('POSTs the flat body to /business-customers with the idempotency key', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        okResponse({ id: 'biz-1', businessName: 'Ada Salon', kybStatus: 'PENDING' }),
      );
    const adapter = adapterWith(fetchSpy);
    const key = factories.idempotencyKey();

    const out = await adapter.createBusinessCustomer(
      {
        businessName: 'Ada Salon',
        bvn: '22222222222',
        rcNumber: 'RC12345',
        email: 'ada@salon.ng',
      },
      key,
    );

    expect(out).toEqual({ id: 'biz-1', businessName: 'Ada Salon', kybStatus: 'PENDING' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/business-customers');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      businessName: 'Ada Salon',
      bvn: '22222222222',
      rcNumber: 'RC12345',
      email: 'ada@salon.ng',
    });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(key);
  });

  it('caches under its own scope and replays without a second HTTP call', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        okResponse({ id: 'biz-2', businessName: 'Bola Foods', kybStatus: 'PENDING' }),
      );
    const adapter = adapterWith(fetchSpy);
    const key = factories.idempotencyKey();
    const input = { businessName: 'Bola Foods', bvn: '22222222222' };

    const first = await adapter.createBusinessCustomer(input, key);
    const second = await adapter.createBusinessCustomer(input, key);

    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const rows = await testDb
      .select()
      .from(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.scope, 'anchor.business_customer'), eq(idempotencyKeys.key, key)),
      );
    expect(rows).toHaveLength(1);
  });
});

describe('anchor webhook kyb.* events', () => {
  const secret = 'whsec-test';

  function sign(body: string) {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  it('accepts kyb.approved', () => {
    const body = JSON.stringify({
      id: 'evt-1',
      type: 'kyb.approved',
      createdAt: '2026-07-06T00:00:00Z',
      data: { businessCustomerId: 'biz-1' },
    });
    const evt = parseAndVerifyWebhook(body, sign(body), secret);
    expect(evt.type).toBe('kyb.approved');
  });

  it('accepts kyb.rejected', () => {
    const body = JSON.stringify({
      id: 'evt-2',
      type: 'kyb.rejected',
      createdAt: '2026-07-06T00:00:00Z',
      data: { businessCustomerId: 'biz-1', reason: 'RC number mismatch' },
    });
    const evt = parseAndVerifyWebhook(body, sign(body), secret);
    expect(evt.type).toBe('kyb.rejected');
  });
});
