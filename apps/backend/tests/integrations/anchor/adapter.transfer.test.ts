import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('AnchorAdapter.transfer', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('POSTs to /transfers with bigint amount serialised as string', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tr-1',
          status: 'PENDING',
          reference: 'k-1',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const key = factories.idempotencyKey();
    const out = await adapter.transfer(
      {
        amountKobo: 520000n,
        fromAccountId: 'va-1',
        toBankCode: '058',
        toAccountNumber: '0123456789',
        narration: 'AMN/AGT/abc12/hh-1',
        reference: key,
      },
      key,
    );
    expect(out.status).toBe('PENDING');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain('"amountKobo":"520000"');
    expect(init.body as string).toContain(`"reference":"${key}"`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(key);
  });
});
