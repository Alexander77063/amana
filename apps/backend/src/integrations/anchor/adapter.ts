import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { idempotencyKeys } from '../../db/schema';
import { CircuitBreaker, type CircuitBreakerConfig } from '../../lib/circuit-breaker';
import { type AnchorClient, AnchorHttpError } from './client';

const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000];
const DEFAULT_CIRCUIT: CircuitBreakerConfig = {
  failureRateThreshold: 0.5,
  windowMs: 60_000,
  openMs: 30_000,
  minSamples: 5,
};

export interface AdapterConfig {
  db: PostgresJsDatabase;
  client: AnchorClient;
  retryDelaysMs?: number[];
  circuitConfig?: CircuitBreakerConfig;
}

export class AnchorAdapter {
  readonly client: AnchorClient;
  protected readonly db: PostgresJsDatabase;
  protected readonly retryDelaysMs: number[];
  protected readonly breaker: CircuitBreaker;

  constructor(config: AdapterConfig) {
    this.db = config.db;
    this.client = config.client;
    this.retryDelaysMs = config.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.breaker = new CircuitBreaker(config.circuitConfig ?? DEFAULT_CIRCUIT);
  }

  async provisionVirtualAccount(
    input: { customerId: string; label: string },
    idempotencyKey: string,
  ): Promise<import('./types').AnchorVirtualAccount> {
    return this.execIdempotent('anchor.virtual_account', idempotencyKey, () =>
      this.client.post<import('./types').AnchorVirtualAccount>(
        '/virtual-accounts',
        { customerId: input.customerId, label: input.label },
        { idempotencyKey },
      ),
    );
  }

  async createCustomer(
    input: import('./types').AnchorCreateCustomerRequest,
    idempotencyKey: string,
  ): Promise<import('./types').AnchorCreateCustomerResponse> {
    return this.execIdempotent('anchor.customer', idempotencyKey, () =>
      this.client.post<import('./types').AnchorCreateCustomerResponse>('/customers', input, {
        idempotencyKey,
      }),
    );
  }

  /**
   * Business KYB for a marketplace retailer. Mirrors `createCustomer` (flat contract,
   * idempotency-cached) but under its own scope so a key reused across the personal and
   * business surfaces can never return the other's cached response.
   */
  async createBusinessCustomer(
    input: import('./types').AnchorCreateBusinessCustomerRequest,
    idempotencyKey: string,
  ): Promise<import('./types').AnchorCreateBusinessCustomerResponse> {
    return this.execIdempotent('anchor.business_customer', idempotencyKey, () =>
      this.client.post<import('./types').AnchorCreateBusinessCustomerResponse>(
        '/business-customers',
        input,
        { idempotencyKey },
      ),
    );
  }

  async requestKycUpgrade(
    input: import('./types').AnchorKycUpgradeRequest,
    idempotencyKey: string,
  ): Promise<import('./types').AnchorKycUpgradeResponse> {
    return this.execIdempotent('anchor.kyc_upgrade', idempotencyKey, () =>
      this.client.post<import('./types').AnchorKycUpgradeResponse>('/kyc-verifications', input, {
        idempotencyKey,
      }),
    );
  }

  async nameEnquiry(
    input: import('./types').AnchorNameEnquiryRequest,
  ): Promise<import('./types').AnchorNameEnquiryResponse> {
    const qs = `?bankCode=${encodeURIComponent(input.bankCode)}&accountNumber=${encodeURIComponent(input.accountNumber)}`;
    return this.breaker.exec(() =>
      this.executeWithRetry(() =>
        this.client.get<import('./types').AnchorNameEnquiryResponse>(`/nibss/name-enquiry${qs}`),
      ),
    );
  }

  async phoneLookup(
    input: import('./types').AnchorPhoneLookupRequest,
  ): Promise<import('./types').AnchorPhoneLookupResponse> {
    const qs = `?phoneNumber=${encodeURIComponent(input.phoneNumber)}`;
    return this.breaker.exec(() =>
      this.executeWithRetry(() =>
        this.client.get<import('./types').AnchorPhoneLookupResponse>(`/nibss/phone-lookup${qs}`),
      ),
    );
  }

  async findTransferByReference(
    reference: string,
  ): Promise<import('./types').AnchorTransferResponse | null> {
    const qs = `?reference=${encodeURIComponent(reference)}`;
    try {
      return await this.breaker.exec(() =>
        this.executeWithRetry(() =>
          this.client.get<import('./types').AnchorTransferResponse>(`/transfers/by-reference${qs}`),
        ),
      );
    } catch (e) {
      if (e instanceof AnchorHttpError && e.status === 404) {
        return null;
      }
      throw e;
    }
  }

  async transfer(
    input: import('./types').AnchorTransferRequest,
    idempotencyKey: string,
  ): Promise<import('./types').AnchorTransferResponse> {
    return this.execIdempotent('anchor.transfer', idempotencyKey, () =>
      this.client.post<import('./types').AnchorTransferResponse>('/transfers', input, {
        idempotencyKey,
      }),
    );
  }

  async listBillers(category: string): Promise<import('./types').AnchorBiller[]> {
    const res = await this.breaker.exec(() =>
      this.executeWithRetry(() =>
        this.client.get<{ data: Array<{ id: string; name: string; slug: string }> }>(
          `/bills/billers?category=${encodeURIComponent(category)}`,
        ),
      ),
    );
    return res.data.map((b) => ({ id: b.id, name: b.name, slug: b.slug }));
  }

  async listProducts(billerId: string): Promise<import('./types').AnchorBillProduct[]> {
    const res = await this.breaker.exec(() =>
      this.executeWithRetry(() =>
        this.client.get<{
          data: Array<{ id: string; name: string; slug: string; amountKobo?: string | null }>;
        }>(`/bills/billers/${encodeURIComponent(billerId)}/products`),
      ),
    );
    return res.data.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      amountKobo: p.amountKobo != null ? BigInt(p.amountKobo) : null,
    }));
  }

  async validateCustomer(
    providerSlug: string,
    accountNumber: string,
  ): Promise<import('./types').AnchorCustomerValidation> {
    return this.breaker.exec(() =>
      this.executeWithRetry(() =>
        this.client.get<import('./types').AnchorCustomerValidation>(
          `/bills/customer-validation/${encodeURIComponent(providerSlug)}/${encodeURIComponent(accountNumber)}`,
        ),
      ),
    );
  }

  async payBill(
    input: import('./types').AnchorBillRequest,
    idempotencyKey: string,
  ): Promise<import('./types').AnchorBillResponse> {
    // Request is a verbatim flat pass-through (amountKobo bigint → kobo-string via
    // bigintReplacer), mirroring `transfer`. The response is mapped OUTSIDE
    // execIdempotent: the flat contract returns commissionKobo as a JSON string, and a
    // bigint cannot be cached into the idempotency_keys jsonb column — so we cache the
    // raw string response and coerce to bigint here (consistent on cache hit and miss).
    const raw = await this.execIdempotent('anchor.bill', idempotencyKey, () =>
      this.client.post<{
        id: string;
        status: import('./types').AnchorBillResponse['status'];
        commissionKobo?: string | number | null;
        token?: string | null;
        failureReason?: string | null;
      }>('/bills', input, { idempotencyKey }),
    );
    return {
      id: raw.id,
      status: raw.status,
      commissionKobo: raw.commissionKobo != null ? BigInt(raw.commissionKobo) : 0n,
      token: raw.token ?? null,
      failureReason: raw.failureReason ?? null,
    };
  }

  async execIdempotent<R>(scope: string, key: string, fn: () => Promise<R>): Promise<R> {
    const cached = await this.lookupCached<R>(scope, key);
    if (cached !== undefined) return cached;

    return this.breaker.exec(async () => {
      const result = await this.executeWithRetry(fn);
      await this.cacheResponse(key, scope, result);
      return result;
    });
  }

  protected async executeWithRetry<R>(fn: () => Promise<R>): Promise<R> {
    let lastErr: unknown;
    for (let i = 0; i <= this.retryDelaysMs.length; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e)) throw e;
        const delay = this.retryDelaysMs[i];
        if (delay === undefined) throw e;
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  private async lookupCached<R>(scope: string, key: string): Promise<R | undefined> {
    // Match on (scope, key) — a key reused across scopes must never return
    // another scope's cached response.
    const [row] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);
    return row?.responseJson as R | undefined;
  }

  private async cacheResponse(key: string, scope: string, response: unknown): Promise<void> {
    await this.db
      .insert(idempotencyKeys)
      .values({ key, scope, responseJson: response as object })
      .onConflictDoNothing({ target: idempotencyKeys.key });
  }
}

function isRetryable(e: unknown): boolean {
  if (e instanceof AnchorHttpError) return e.status >= 500;
  if (e instanceof Error && (e.name === 'TypeError' || e.name === 'AbortError')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
