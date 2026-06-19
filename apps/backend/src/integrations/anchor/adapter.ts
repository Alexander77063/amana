import { eq } from 'drizzle-orm';
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

  async execIdempotent<R>(scope: string, key: string, fn: () => Promise<R>): Promise<R> {
    const cached = await this.lookupCached<R>(key);
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

  private async lookupCached<R>(key: string): Promise<R | undefined> {
    const [row] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
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
