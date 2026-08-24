import { type RawFetch, postJson } from './auth-api';
import type { AuthedClient } from './household-api';

export type RetailerOnboardingStatus = 'applied' | 'kyb_pending' | 'approved' | 'suspended';

export type RetailerProfile = {
  id: string;
  businessName: string;
  contactPhone: string | null;
  onboardingStatus: RetailerOnboardingStatus;
  payoutBankCode: string;
  payoutAccountNumber: string;
  /** KYB has been SUBMITTED — not that it passed. `approvedAt` is what says it passed. */
  kybSubmitted: boolean;
  approvedAt: string | null;
};

export type RetailerItem = {
  id: string;
  name: string;
  /** bigint kobo as a string — never a JS number, this is money. */
  priceKobo: string;
  section: string;
  description: string | null;
  photoUrl: string | null;
  durationMinutes: number | null;
  status: 'active' | 'inactive';
  createdAt: string;
};

export type RetailerDeal = {
  id: string;
  catalogItemId: string | null;
  type: string;
  discountBps: number | null;
  discountKobo: string | null;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'paused' | 'ended';
};

export type RetailerRedemption = {
  id: string;
  code: string;
  catalogItemId: string;
  grossKobo: string;
  discountedKobo: string;
  status: string;
  payoutStatus: string | null;
  redeemedAt: string | null;
  createdAt: string;
};

export type RetailerEarnings = {
  summary: {
    redeemedCount: number;
    grossKobo: string;
    commissionKobo: string;
    netKobo: string;
    paidKobo: string;
    pendingKobo: string;
  };
  history: Array<{
    redemptionId: string;
    code: string;
    netKobo: string;
    grossKobo: string;
    commissionKobo: string;
    payoutStatus: string | null;
    redeemedAt: string | null;
  }>;
};

export type RetailerSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  retailer: { id: string; businessName: string; onboardingStatus: RetailerOnboardingStatus };
};

export type ItemInput = {
  name: string;
  /** Decimal naira string, e.g. "4820.50". Converted to kobo once, server-side. */
  priceNaira: string;
  section: string;
  description?: string | null;
  photoUrl?: string | null;
  durationMinutes?: number | null;
};

export type DealInput = {
  catalogItemId?: string | null;
  discountBps?: number | null;
  discountNaira?: string | null;
  startsAt: string;
  endsAt: string;
};

export type Page = { limit?: number; offset?: number };

const qs = (p: Page): string => {
  const s = new URLSearchParams();
  if (p.limit !== undefined) s.set('limit', String(p.limit));
  if (p.offset !== undefined) s.set('offset', String(p.offset));
  const out = s.toString();
  return out ? `?${out}` : '';
};

/**
 * The retailer portal's whole server surface.
 *
 * Note what is absent: no method takes a retailer id. The server resolves the retailer from the
 * session, so there is nothing here a caller could point at another business — the SDK cannot
 * express the request that would attempt it.
 *
 * Money is `string` throughout, in kobo. Parsing it to a JS number anywhere in a client is a bug
 * waiting for a large enough total.
 */
/**
 * Portal sign-in.
 *
 * Separate from `RetailerApi` because these are the only two unauthenticated calls the portal
 * makes, and they must not travel through the authed client — that client requires a token store
 * and would try to refresh a session that does not exist yet. Mirrors `AuthApi`.
 */
export class RetailerAuthApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: RawFetch,
  ) {}

  requestOtp(phone: string): Promise<{ challengeId: string; expiresAt: string }> {
    return postJson(this.fetchImpl, `${this.baseUrl}/retailer/auth/otp/request`, { phone });
  }

  verifyOtp(input: { phone: string; code: string; nin?: string }): Promise<RetailerSession> {
    return postJson(this.fetchImpl, `${this.baseUrl}/retailer/auth/otp/verify`, input);
  }
}

export class RetailerApi {
  constructor(private readonly client: AuthedClient) {}

  // ── Profile, KYB, payout ────────────────────────────────────────────────────────────────────
  me(): Promise<{ retailer: RetailerProfile }> {
    return this.client.request('/retailer/me');
  }

  updateProfile(input: { businessName?: string; contactPhone?: string }): Promise<unknown> {
    return this.client.request('/retailer/me', { method: 'PATCH', jsonBody: input });
  }

  setPayout(input: { payoutBankCode: string; payoutAccountNumber: string }): Promise<unknown> {
    return this.client.request('/retailer/me/payout', { method: 'PUT', jsonBody: input });
  }

  submitKyb(input: { bvn: string; rcNumber?: string; email?: string }): Promise<{
    onboardingStatus: RetailerOnboardingStatus;
  }> {
    return this.client.request('/retailer/me/kyb', { method: 'POST', jsonBody: input });
  }

  // ── Storefront ──────────────────────────────────────────────────────────────────────────────
  listItems(): Promise<{ items: RetailerItem[] }> {
    return this.client.request('/retailer/items');
  }

  createItem(input: ItemInput): Promise<{ item: RetailerItem }> {
    return this.client.request('/retailer/items', { method: 'POST', jsonBody: input });
  }

  updateItem(
    id: string,
    input: Partial<ItemInput> & { status?: 'active' | 'inactive' },
  ): Promise<{ item: RetailerItem | null }> {
    return this.client.request(`/retailer/items/${id}`, { method: 'PATCH', jsonBody: input });
  }

  // ── Deals ───────────────────────────────────────────────────────────────────────────────────
  listDeals(): Promise<{ deals: RetailerDeal[] }> {
    return this.client.request('/retailer/deals');
  }

  createDeal(input: DealInput): Promise<{ deal: { id: string; status: string } }> {
    return this.client.request('/retailer/deals', { method: 'POST', jsonBody: input });
  }

  setDealStatus(id: string, status: 'active' | 'paused' | 'ended'): Promise<unknown> {
    return this.client.request(`/retailer/deals/${id}`, { method: 'PATCH', jsonBody: { status } });
  }

  // ── Redeem ──────────────────────────────────────────────────────────────────────────────────
  redeem(code: string): Promise<{
    payoutTransactionId: string;
    status: 'PENDING' | 'FAILED';
    payoutFailed: boolean;
  }> {
    return this.client.request('/retailer/redeem', { method: 'POST', jsonBody: { code } });
  }

  // ── Orders & earnings ───────────────────────────────────────────────────────────────────────
  listRedemptions(page: Page = {}): Promise<{ redemptions: RetailerRedemption[] }> {
    return this.client.request(`/retailer/redemptions${qs(page)}`);
  }

  earnings(page: Page = {}): Promise<RetailerEarnings> {
    return this.client.request(`/retailer/earnings${qs(page)}`);
  }
}
