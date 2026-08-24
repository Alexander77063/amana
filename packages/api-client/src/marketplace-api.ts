import type { AuthedClient } from './household-api';

export type MarketplaceItem = {
  id: string;
  name: string;
  /** The retailer's own merchandising label. */
  section: string;
  /** The spend category a parent's lock matches on. */
  category: string;
  description: string | null;
  photoUrl: string | null;
  durationMinutes: number | null;
  retailerId: string;
  retailerName: string;
  /** List price, in kobo. Only worth showing when a deal is actually reducing it. */
  grossKobo: string;
  /** What the buyer will pay, in kobo. THIS is the price to render. */
  effectiveKobo: string;
  dealId: string | null;
};

export type Voucher = {
  id: string;
  code: string;
  qrToken: string;
  grossKobo: string;
  discountedKobo: string;
  status: string;
  expiresAt: string;
};

/**
 * The buyer side of the marketplace.
 *
 * An agent's browse scope is always their own sub-wallet — the server ignores any id they send,
 * so passing one cannot widen what they see. `subWalletId` is here for a PRINCIPAL previewing
 * what one of their agents can buy.
 */
export class MarketplaceApi {
  constructor(private readonly client: AuthedClient) {}

  sections(subWalletId?: string): Promise<{ sections: string[] }> {
    return this.client.request(
      `/marketplace/sections${subWalletId ? `?subWalletId=${subWalletId}` : ''}`,
    );
  }

  items(opts: { subWalletId?: string; section?: string } = {}): Promise<{
    items: MarketplaceItem[];
  }> {
    const q = new URLSearchParams();
    if (opts.subWalletId) q.set('subWalletId', opts.subWalletId);
    if (opts.section) q.set('section', opts.section);
    const s = q.toString();
    return this.client.request(`/marketplace/items${s ? `?${s}` : ''}`);
  }

  /** Which retailers a sub-wallet may buy from. `null` means no merchant rule — unrestricted. */
  approvedMerchants(subWalletId?: string): Promise<{ approvedRetailerIds: string[] | null }> {
    return this.client.request(
      `/marketplace/merchants${subWalletId ? `?subWalletId=${subWalletId}` : ''}`,
    );
  }

  /**
   * The control fusion, from the principal's side: this edits the sub-wallet's RULE SET. It is
   * not a marketplace-only permission — the same engine that enforces limits and category locks
   * enforces this.
   */
  approveMerchant(input: { subWalletId: string; retailerId: string }): Promise<{
    retailerIds: string[];
  }> {
    return this.client.request('/marketplace/merchants/approve', {
      method: 'POST',
      jsonBody: input,
    });
  }

  revokeMerchant(input: { subWalletId: string; retailerId: string }): Promise<{
    retailerIds: string[];
  }> {
    return this.client.request('/marketplace/merchants/revoke', {
      method: 'POST',
      jsonBody: input,
    });
  }

  /** No price is sent: the server prices from the catalogue, closing the discount-spoof vector. */
  purchase(input: {
    subWalletId?: string | null;
    catalogItemId: string;
    idempotencyKey: string;
  }): Promise<{ voucher: Voucher }> {
    return this.client.request('/marketplace/purchase', { method: 'POST', jsonBody: input });
  }

  vouchers(): Promise<{ vouchers: Voucher[] }> {
    return this.client.request('/marketplace/vouchers');
  }
}
