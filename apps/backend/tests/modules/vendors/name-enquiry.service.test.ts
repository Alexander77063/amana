import { describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient, AnchorHttpError } from '../../../src/integrations/anchor/client';
import { isErr, isOk } from '../../../src/lib/result';
import { nameEnquiryService } from '../../../src/modules/vendors/name-enquiry.service';
import { testDb } from '../../helpers/test-db';

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('nameEnquiryService.lookup', () => {
  it('maps Anchor success → ResolvedVendor with source=name_enquiry', async () => {
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
    const result = await nameEnquiryService.lookup(makeAdapter(fetchSpy), {
      bankCode: '058',
      accountNumber: '0123456789',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('name_enquiry');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
      expect(result.value.suggestedAmountKobo).toBeNull();
    }
  });

  it('returns NOT_FOUND on Anchor 404', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"not_found"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await nameEnquiryService.lookup(makeAdapter(fetchSpy), {
      bankCode: '058',
      accountNumber: '9999999999',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns PARTNER_DOWN on Anchor 5xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"down"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await nameEnquiryService.lookup(makeAdapter(fetchSpy), {
      bankCode: '058',
      accountNumber: '0123456789',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('PARTNER_DOWN');
  });
});
