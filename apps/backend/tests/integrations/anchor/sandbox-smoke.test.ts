import { describe, expect, it } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { testDb } from '../../helpers/test-db';

const KEY = process.env.ANCHOR_API_KEY;
const URL = process.env.ANCHOR_API_BASE_URL ?? 'https://api.sandbox.getanchor.co';

const maybeSkip = KEY ? describe : describe.skip;

maybeSkip('Anchor sandbox smoke (live; requires ANCHOR_API_KEY)', () => {
  it('name enquiry against a known sandbox account succeeds', async () => {
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: URL, apiKey: KEY }),
    });
    const r = await adapter.nameEnquiry({ bankCode: '058', accountNumber: '0000000001' });
    expect(r.accountName.length).toBeGreaterThan(0);
  });
});
