import type { AuthedClient } from './household-api';

export type ResolvedVendorResponse = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents';
  suggestedAmountKobo: string | null;
};

export type RecentVendorResponse = {
  id: string;
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  lastUsedAt: string;
  firstSeenAt: string;
};

export class VendorApi {
  constructor(private readonly client: AuthedClient) {}

  nameEnquiry(
    bankCode: string,
    accountNumber: string,
    subWalletId: string,
  ): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ bankCode, accountNumber, subWalletId });
    return this.client.request<ResolvedVendorResponse>(`/vendors/name-enquiry?${params}`);
  }

  phoneLookup(phoneNumber: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ phoneNumber, subWalletId });
    return this.client.request<ResolvedVendorResponse>(`/vendors/phone-lookup?${params}`);
  }

  nqrDecode(payload: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    return this.client.request<ResolvedVendorResponse>('/vendors/nqr-decode', {
      method: 'POST',
      jsonBody: { payload, subWalletId },
    });
  }

  async recents(subWalletId: string): Promise<RecentVendorResponse[]> {
    const r = await this.client.request<{ recents: RecentVendorResponse[] }>(
      `/vendors/recents?subWalletId=${encodeURIComponent(subWalletId)}`,
    );
    return r.recents;
  }
}
