import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';

describe('AnchorAdapter.provisionVirtualAccount', () => {
  beforeEach(async () => { await truncateAll(); });

  it('POSTs to /virtual-accounts with customerId + idempotency key', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'va-1', bankCode: '058', accountNumber: '1234567890',
        accountName: 'AMANA / ADEGBOLA HH', customerId: 'cust-1', status: 'ACTIVE',
      }), { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1, 1, 1],
    });
    const key = factories.idempotencyKey();
    const va = await adapter.provisionVirtualAccount({ customerId: 'cust-1', label: 'AMANA / ADEGBOLA HH' }, key);
    expect(va.accountNumber).toBe('1234567890');
    expect(va.bankCode).toBe('058');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(key);
  });
});
