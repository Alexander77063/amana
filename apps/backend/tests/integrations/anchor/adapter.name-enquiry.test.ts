import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('AnchorAdapter.nameEnquiry', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('GETs /nibss/name-enquiry with bankCode + accountNumber', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bankCode: '058',
          accountNumber: '0123456789',
          accountName: 'MUSA ABDULLAHI',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const r = await adapter.nameEnquiry({ bankCode: '058', accountNumber: '0123456789' });
    expect(r.accountName).toBe('MUSA ABDULLAHI');
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.x/nibss/name-enquiry?bankCode=058&accountNumber=0123456789');
  });
});
