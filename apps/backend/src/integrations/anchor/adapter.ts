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
    return this.execBreaker(() =>
      this.executeWithRetry(() =>
        this.client.get<import('./types').AnchorNameEnquiryResponse>(`/nibss/name-enquiry${qs}`),
      ),
    );
  }

  async phoneLookup(
    input: import('./types').AnchorPhoneLookupRequest,
  ): Promise<import('./types').AnchorPhoneLookupResponse> {
    const qs = `?phoneNumber=${encodeURIComponent(input.phoneNumber)}`;
    return this.execBreaker(() =>
      this.executeWithRetry(() =>
        this.client.get<import('./types').AnchorPhoneLookupResponse>(`/nibss/phone-lookup${qs}`),
      ),
    );
  }

  /**
   * Returns `null` when Anchor has never seen the reference — the "unknown" arm of the recon
   * sweep, not an error.
   *
   * The `try/catch` here used to sit OUTSIDE `breaker.exec`, which meant the breaker had already
   * recorded a failure (and possibly opened) by the time the 404 was converted to `null`. It
   * protected this method's return value and nothing else. Since `reconciliationService.sweep`
   * polls this for every stuck in-flight spend — transfers Anchor may legitimately never have
   * received — the platform was tripping its own global Anchor breaker on a five-minute timer,
   * with no attacker involved. `execBreaker` now keeps the 404 off the breaker at the source, so
   * the catch is purely about the `null` contract.
   */
  async findTransferByReference(
    reference: string,
  ): Promise<import('./types').AnchorTransferResponse | null> {
    const qs = `?reference=${encodeURIComponent(reference)}`;
    try {
      return await this.execBreaker(() =>
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
    const res = await this.execBreaker(() =>
      this.executeWithRetry(() =>
        this.client.get<{ data: Array<{ id: string; name: string; slug: string }> }>(
          `/bills/billers?category=${encodeURIComponent(category)}`,
        ),
      ),
    );
    return res.data.map((b) => ({ id: b.id, name: b.name, slug: b.slug }));
  }

  async listProducts(billerId: string): Promise<import('./types').AnchorBillProduct[]> {
    const res = await this.execBreaker(() =>
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
    return this.execBreaker(() =>
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

    const result = await this.execBreaker(() => this.executeWithRetry(fn));
    // Caching sits OUTSIDE the breaker deliberately. It is a write to OUR Postgres; a failure
    // there says nothing about Anchor's health, and counting it as an Anchor failure would let a
    // local DB blip open the breaker on every remaining Anchor call. The caller still sees the
    // error either way.
    await this.cacheResponse(key, scope, result);
    return result;
  }

  /**
   * The single gate every Anchor call passes through, and the only place the breaker is touched.
   *
   * A circuit breaker exists to answer one question: is the partner unwell? A 4xx is evidence of
   * the opposite — Anchor was reachable, processed the request, and answered that our INPUT was
   * wrong. Recording that as a failure made the breaker input-controlled: five
   * `GET /vendors/name-enquiry` calls with a garbage account number are five Anchor 404s (never
   * retried, since `isRetryable` is `status >= 500`), which is `minSamples` reached at a failure
   * rate of 1.0 — the global breaker open for 30s across every Anchor call, real transfers
   * included, repeatable forever from one ordinary account.
   *
   * `breaker.exec` records a failure on ANY throw, so the classification cannot be a `catch`
   * around the outside — by then the sample is already recorded. It has to stop the throw from
   * crossing the breaker boundary at all: a 4xx RETURNS normally (recording a success) and is
   * rethrown out here, so the caller still sees an untouched `AnchorHttpError`. 5xx and network
   * failures throw straight through and the breaker sees them, exactly as before.
   *
   * 429 is the deliberate exception. It is a 4xx, but it is not caller-input-controlled — no
   * single request's payload produces it; our AGGREGATE volume does. That is precisely the
   * load-shedding case a breaker is for, so it stays a failure and is allowed to trip the
   * breaker. (It is not retried either — `isRetryable` is `status >= 500` — so the coherent
   * story is "shed load at the breaker". Honouring `Retry-After` would be a separate change.)
   *
   * 408 needs no branch: `fetch` surfaces timeouts as `AbortError`/`TypeError`, which are already
   * classified as network failures.
   */
  protected async execBreaker<T>(fn: () => Promise<T>): Promise<T> {
    const outcome = await this.breaker.exec(
      async (): Promise<{ ok: true; value: T } | { ok: false; error: AnchorHttpError }> => {
        try {
          return { ok: true, value: await fn() };
        } catch (e) {
          if (e instanceof AnchorHttpError && isPartnerHealthy4xx(e.status)) {
            return { ok: false, error: e };
          }
          throw e;
        }
      },
    );
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
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

/**
 * True when the status proves the partner is HEALTHY and rejecting our input — the class that must
 * never count against the circuit breaker. See `AnchorAdapter.execBreaker` for why 429 is carved
 * out of the 4xx range.
 */
export function isPartnerHealthy4xx(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

function isRetryable(e: unknown): boolean {
  if (e instanceof AnchorHttpError) return e.status >= 500;
  if (e instanceof Error && (e.name === 'TypeError' || e.name === 'AbortError')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
