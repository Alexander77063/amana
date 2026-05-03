export interface CircuitBreakerConfig {
  /** Fraction of failures (0..1) that trips the breaker once minSamples reached. */
  failureRateThreshold: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** How long to stay open before half-opening. */
  openMs: number;
  /** Minimum samples required in window before the breaker can open. */
  minSamples: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(public readonly retryAt: number) {
    super(`circuit open until ${new Date(retryAt).toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

interface Sample {
  ts: number;
  ok: boolean;
}

export class CircuitBreaker {
  private samples: Sample[] = [];
  private openedAt: number | null = null;

  constructor(private readonly config: CircuitBreakerConfig) {}

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    if (Date.now() - this.openedAt >= this.config.openMs) return 'half-open';
    return 'open';
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open') {
      throw new CircuitOpenError((this.openedAt ?? 0) + this.config.openMs);
    }
    try {
      const result = await fn();
      this.record(true);
      if (state === 'half-open') {
        this.openedAt = null;
        this.samples = [];
      }
      return result;
    } catch (e) {
      this.record(false);
      this.maybeOpen();
      throw e;
    }
  }

  private record(ok: boolean): void {
    const now = Date.now();
    this.samples.push({ ts: now, ok });
    const cutoff = now - this.config.windowMs;
    this.samples = this.samples.filter((s) => s.ts >= cutoff);
  }

  private maybeOpen(): void {
    if (this.samples.length < this.config.minSamples) return;
    const failures = this.samples.filter((s) => !s.ok).length;
    const rate = failures / this.samples.length;
    if (rate > this.config.failureRateThreshold) {
      this.openedAt = Date.now();
    }
  }
}
