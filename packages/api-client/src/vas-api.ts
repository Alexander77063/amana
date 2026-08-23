import type { AuthedClient } from './household-api';

export type VasCategory = 'airtime' | 'data' | 'electricity' | 'cabletv';

export type VasBiller = { id: string; name: string; slug: string };

export type VasProduct = {
  id: string;
  name: string;
  slug: string;
  /** Fixed-price bundles carry an amount; open-value top-ups leave it null. */
  amountKobo: string | null;
};

export type VasCustomer = { valid: boolean; customerName: string; accountNumber: string };

export type VasPurchase = {
  id: string;
  category: VasCategory;
  provider: string;
  productSlug: string | null;
  recipientKind: 'phone' | 'meter' | 'smartcard';
  recipient: string;
  customerName: string | null;
  amountKobo: string;
  commissionKobo: string;
  status: string;
  /** Prepaid electricity token, once the biller returns one. */
  token: string | null;
  anchorBillId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type VasPurchaseInput = {
  subWalletId: string | null;
  category: VasCategory;
  provider: string;
  productSlug?: string | null;
  recipient: string;
  /** Kobo as a string — never a JSON number, which would lose precision on large values. */
  amountKobo: string;
  idempotencyKey: string;
};

export type VasBeneficiary = {
  id: string;
  kind: 'phone' | 'meter' | 'smartcard';
  value: string;
  label: string;
  status: string;
};

export class VasApi {
  constructor(private readonly client: AuthedClient) {}

  listBillers(category: VasCategory): Promise<{ billers: VasBiller[] }> {
    return this.client.request<{ billers: VasBiller[] }>(
      `/vas/billers?category=${encodeURIComponent(category)}`,
    );
  }

  listProducts(billerId: string): Promise<{ products: VasProduct[] }> {
    return this.client.request<{ products: VasProduct[] }>(
      `/vas/billers/${encodeURIComponent(billerId)}/products`,
    );
  }

  /** Electricity and cable resolve the account holder before any money moves. */
  validate(provider: string, account: string): Promise<{ customer: VasCustomer }> {
    return this.client.request<{ customer: VasCustomer }>(
      `/vas/validate?provider=${encodeURIComponent(provider)}&account=${encodeURIComponent(account)}`,
    );
  }

  purchase(input: VasPurchaseInput): Promise<{ purchase: VasPurchase }> {
    return this.client.request<{ purchase: VasPurchase }>('/vas/purchase', {
      method: 'POST',
      jsonBody: input,
    });
  }

  listPurchases(): Promise<{ purchases: VasPurchase[] }> {
    return this.client.request<{ purchases: VasPurchase[] }>('/vas/purchases');
  }

  listBeneficiaries(subWalletId: string): Promise<{ beneficiaries: VasBeneficiary[] }> {
    return this.client.request<{ beneficiaries: VasBeneficiary[] }>(
      `/vas/beneficiaries?subWalletId=${encodeURIComponent(subWalletId)}`,
    );
  }
}
