import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { idempotencyKeys } from '../../db/schema';
import { CircuitBreaker, type CircuitBreakerConfig } from '../../lib/circuit-breaker';
import { AnchorClient, AnchorHttpError } from './client';

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
