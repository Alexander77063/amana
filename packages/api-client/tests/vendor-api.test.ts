import { describe, expect, it, vi } from 'vitest';
import { VendorApi } from '../src/vendor-api';

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
