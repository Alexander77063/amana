import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('AnchorAdapter.phoneLookup', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('GETs /nibss/phone-lookup with the phone number', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bankCode: '999',
          accountNumber: '8011112222',
          accountName: 'MUSA ABDULLAHI',
          phoneNumber: '+2348011112222',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const r = await adapter.phoneLookup({ phoneNumber: '+2348011112222' });
    expect(r.accountName).toBe('MUSA ABDULLAHI');
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/nibss/phone-lookup');
    expect(url).toContain(encodeURIComponent('+2348011112222'));
  });
});
