import { describe, expect, it, vi } from 'vitest';
import { phoneLookupService } from '../../../src/modules/vendors/phone-lookup.service';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { isErr, isOk } from '../../../src/lib/result';
import { testDb } from '../../helpers/test-db';

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('phoneLookupService.lookup', () => {
  it('maps Anchor success → ResolvedVendor with source=phone_lookup', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        bankCode: '999', accountNumber: '8011112222',
        accountName: 'MUSA ABDULLAHI', phoneNumber: '+2348011112222',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await phoneLookupService.lookup(makeAdapter(fetchSpy), {
      phoneNumber: '+2348011112222',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.source).toBe('phone_lookup');
      expect(result.value.accountName).toBe('MUSA ABDULLAHI');
    }
  });

  it('returns NOT_FOUND on Anchor 404', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    const result = await phoneLookupService.lookup(makeAdapter(fetchSpy), {
      phoneNumber: '+2348099999999',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed phone number with BAD_INPUT', async () => {
    const fetchSpy = vi.fn();
    const result = await phoneLookupService.lookup(makeAdapter(fetchSpy), {
      phoneNumber: 'not-a-phone',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('BAD_INPUT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
