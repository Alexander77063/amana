import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmanaApiClient } from '../src/client';
import { ApiError } from '../src/errors';
import { type TokenStore, createInMemoryTokenStore } from '../src/token-store';
import { VendorApi, isRetryableVendorCodeError } from '../src/vendor-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

const mockVendor = {
  bankCode: '058',
  accountNumber: '0123456789',
  accountName: 'Mama Tola',
  source: 'name_enquiry',
  suggestedAmountKobo: null,
};

describe('VendorApi.nameEnquiry', () => {
  it('GETs /vendors/name-enquiry with correct query params', async () => {
    const client = fakeClient(async () => mockVendor);
    const api = new VendorApi(client);
    const r = await api.nameEnquiry('058', '0123456789', 'sw1');
    expect(r.accountName).toBe('Mama Tola');
    expect(client.request).toHaveBeenCalledWith(
      '/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=sw1',
    );
  });
});

describe('VendorApi.phoneLookup', () => {
  it('GETs /vendors/phone-lookup with phone + subWalletId', async () => {
    const client = fakeClient(async () => mockVendor);
    const api = new VendorApi(client);
    const r = await api.phoneLookup('+2348012345678', 'sw1');
    expect(r.bankCode).toBe('058');
    expect(client.request).toHaveBeenCalledWith(
      '/vendors/phone-lookup?phoneNumber=%2B2348012345678&subWalletId=sw1',
    );
  });
});

describe('VendorApi.nqrDecode', () => {
  it('POSTs /vendors/nqr-decode', async () => {
    const client = fakeClient(async () => mockVendor);
    const api = new VendorApi(client);
    await api.nqrDecode('QR_PAYLOAD', 'sw1');
    expect(client.request).toHaveBeenCalledWith('/vendors/nqr-decode', {
      method: 'POST',
      jsonBody: { payload: 'QR_PAYLOAD', subWalletId: 'sw1' },
    });
  });
});

describe('VendorApi.recents', () => {
  it('GETs /vendors/recents for subWalletId', async () => {
    const client = fakeClient(async () => ({ recents: [{ id: 'r1', accountName: 'A' }] }));
    const api = new VendorApi(client);
    const r = await api.recents('sw1');
    expect(r).toHaveLength(1);
    expect(client.request).toHaveBeenCalledWith('/vendors/recents?subWalletId=sw1');
  });
});

const codedVendor = {
  bankCode: '058',
  accountNumber: '0123456789',
  accountName: 'MAMA PUT KITCHEN',
  source: 'vendor_code',
  suggestedAmountKobo: null,
  vendorId: 'v-1',
  category: 'food',
};

describe('VendorApi.vendorCode', () => {
  it('GETs the code endpoint with the sub-wallet as a query param', async () => {
    const client = fakeClient(async () => codedVendor);
    const api = new VendorApi(client);
    const r = await api.vendorCode('AMNV-7QK2H-9PZ0R', 'sw-1');

    expect(client.request).toHaveBeenCalledWith('/vendors/code/AMNV-7QK2H-9PZ0R?subWalletId=sw-1');
    expect(r.vendorId).toBe('v-1');
    expect(r.category).toBe('food');
    expect(r.source).toBe('vendor_code');
  });

  it('percent-encodes the sub-wallet id', async () => {
    const client = fakeClient(async () => codedVendor);
    const api = new VendorApi(client);
    await api.vendorCode('AMNV-7QK2H-9PZ0R', 'sw/1');
    expect(client.request).toHaveBeenCalledWith(
      '/vendors/code/AMNV-7QK2H-9PZ0R?subWalletId=sw%2F1',
    );
  });

  /**
   * Normalization is the backend schema's job and only the backend schema's job: `VendorCodeParams`
   * trims, matches case-insensitively, and `normalizeCrockford` folds I/L→1 and O→0 inside
   * `findByPublicCode`. A second fold here would be a copy that drifts, so the user's string goes
   * through verbatim — and, because it goes through verbatim, it has to be escaped.
   *
   * A clean `AMNV-7QK2H-9PZ0R` cannot show either property: it survives `encodeURIComponent`
   * unchanged and survives a stray `.trim().toUpperCase()` unchanged. This one is deliberately
   * dirty so both mutations are visible.
   */
  it('passes the raw code through untouched, escaping rather than normalizing it', async () => {
    const client = fakeClient(async () => codedVendor);
    const api = new VendorApi(client);
    await api.vendorCode(' amnv-7qk2h-9pz0r ', 'sw-1');
    expect(client.request).toHaveBeenCalledWith(
      '/vendors/code/%20amnv-7qk2h-9pz0r%20?subWalletId=sw-1',
    );
  });
});

/**
 * The status ladder `GET /vendors/code/:code` returns, asserted end-to-end through the real
 * `AmanaApiClient` rather than a stub — the stub bypasses `request()` entirely and so can say
 * nothing about how a non-2xx becomes an `ApiError`.
 *
 * The confirm screen branches on these, and the branch that matters is retryable vs terminal:
 * 502 and 503 mean "we could not get an answer, ask again"; 404, 410 and 409 mean "the answer is
 * no" and will never become yes. Each case also pins `fetchImpl` at exactly ONE call, because the
 * client's only automatic retry today is the 401 → refresh → replay path. If anyone widens that
 * to 5xx — the default retry set in axios-retry and most fetch wrappers covers 502/503 — these
 * die, which is the point: a silent retry of a terminal status is what this pin exists to stop.
 */
describe('GET /vendors/code/:code status ladder', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let tokenStore: TokenStore;

  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(async () => {
    fetchImpl = vi.fn();
    tokenStore = createInMemoryTokenStore();
    await tokenStore.write({
      tokens: {
        accessToken: 'A1',
        refreshToken: 'R1',
        accessExpiresAt: '2026-09-10T10:05:00Z',
        refreshExpiresAt: '2026-10-10T10:00:00Z',
      },
      user: { id: 'u1', role: 'agent', phone: '+2348012345678', kycTier: '1' },
    });
  });

  const call = () => {
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    return client.vendor.vendorCode('AMNV-7QK2H-9PZ0R', 'sw-1');
  };

  // Body shapes are not uniform, and the differences are real: the resolver's own failures are
  // SCREAMING_CASE codes with no `detail` (the upstream's identity is not the payer's business),
  // while the framework layers around it answer in snake_case.
  const ladder: Array<{ status: number; body: unknown; code: string; retryable: boolean }> = [
    { status: 404, body: { error: 'NOT_FOUND' }, code: 'NOT_FOUND', retryable: false },
    {
      status: 410,
      body: { error: 'VENDOR_SUSPENDED' },
      code: 'VENDOR_SUSPENDED',
      retryable: false,
    },
    {
      status: 409,
      body: { error: 'VENDOR_ACCOUNT_GONE' },
      code: 'VENDOR_ACCOUNT_GONE',
      retryable: false,
    },
    {
      status: 502,
      body: { error: 'VENDOR_ENQUIRY_FAILED' },
      code: 'VENDOR_ENQUIRY_FAILED',
      retryable: true,
    },
    { status: 503, body: { error: 'PARTNER_DOWN' }, code: 'PARTNER_DOWN', retryable: true },
    {
      status: 400,
      body: { error: 'validation_error', issues: [] },
      code: 'validation_error',
      retryable: false,
    },
    { status: 403, body: { error: 'forbidden' }, code: 'forbidden', retryable: false },
    {
      status: 429,
      body: { error: 'rate_limited', retryAfterSeconds: 30 },
      code: 'rate_limited',
      retryable: true,
    },
  ];

  for (const rung of ladder) {
    it(`throws ApiError ${rung.status}/${rung.code} without retrying`, async () => {
      fetchImpl.mockResolvedValue(json(rung.body, rung.status));

      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(rung.status);
      expect((err as ApiError).code).toBe(rung.code);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(isRetryableVendorCodeError(err)).toBe(rung.retryable);
    });
  }

  it('resolves the registry identity on 200', async () => {
    fetchImpl.mockResolvedValue(json(codedVendor, 200));
    const r = await call();
    expect(r).toEqual(codedVendor);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x/vendors/code/AMNV-7QK2H-9PZ0R?subWalletId=sw-1',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer A1' }),
      }),
    );
  });
});

describe('isRetryableVendorCodeError', () => {
  it('treats a dropped connection as retryable — no answer is not a negative answer', () => {
    expect(isRetryableVendorCodeError(ApiError.network(new Error('socket hang up')))).toBe(true);
  });

  it('is false for anything that is not an ApiError', () => {
    expect(isRetryableVendorCodeError(new Error('boom'))).toBe(false);
    expect(isRetryableVendorCodeError(undefined)).toBe(false);
  });
});
