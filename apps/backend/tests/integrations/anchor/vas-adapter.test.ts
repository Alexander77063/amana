import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

function jsonResponse(body: unknown, status = 202) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AnchorAdapter VAS', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('payBill POSTs /bills with a FLAT body, amountKobo serialised as a string', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'bill_1', status: 'PENDING', commissionKobo: '200' }));
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const key = factories.idempotencyKey();
    const res = await adapter.payBill(
      {
        type: 'Airtime',
        provider: 'mtn',
        phoneNumber: '+2348010000000',
        amountKobo: 10_000n, // ₦100
        reference: key,
        accountId: 'anchor-acct',
      },
      key,
    );
    expect(res.status).toBe('PENDING');
    expect(res.id).toBe('bill_1');
    expect(res.commissionKobo).toBe(200n);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.x/bills');
    expect(init.body as string).toContain('"amountKobo":"10000"');
    expect(init.body as string).toContain('"type":"Airtime"');
    expect(init.body as string).toContain(`"reference":"${key}"`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(key);
  });

  it('listBillers GETs the category-filtered billers endpoint', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'b1', name: 'MTN', slug: 'mtn' }] }, 200));
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const billers = await adapter.listBillers('airtime');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.x/bills/billers?category=airtime');
    expect(billers[0].slug).toBe('mtn');
  });
});
