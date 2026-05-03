import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';

describe('AnchorAdapter.requestKycUpgrade', () => {
  beforeEach(async () => { await truncateAll(); });

  it('POSTs to /kyc-verifications with customerId + targetTier + documents', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ customerId: 'cust-1', status: 'PENDING' }), {
        status: 202, headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const key = factories.idempotencyKey();
    const out = await adapter.requestKycUpgrade(
      {
        customerId: 'cust-1',
        targetTier: 'TIER_3',
        documents: [{ kind: 'PROOF_OF_ADDRESS', url: 'https://x/poa.pdf' }],
      },
      key,
    );
    expect(out.status).toBe('PENDING');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain('"targetTier":"TIER_3"');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(key);
  });
});
