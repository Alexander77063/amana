import type { Context, MiddlewareHandler } from 'hono';

/**
 * In-memory fixed-window rate limiter.
 *
 * Scope note: the store is per-process. On Fly the `app` group may run multiple
 * machines, so limits are enforced per-instance, not globally. That is an
 * acceptable first line of defence for SMS-cost / brute-force abuse on the auth
 * surface; the store is intentionally pluggable (a single Map behind this
 * module) so a Redis-backed implementation can replace it without touching
 * call sites. Keep the factory signature stable if you swap the backend.
 */

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

// Opportunistic sweep so the Map cannot grow unbounded under sustained unique
// keys (e.g. IP rotation). Runs every SWEEP_EVERY recorded hits — cheap, and
// avoids a long-lived timer that would keep the process alive / leak in tests.
const SWEEP_EVERY = 1000;
let hitsSinceSweep = 0;

function sweep(now: number): void {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

/** Test/maintenance hook — drop all counters. Wired into `truncateAll()`. */
export function resetRateLimitStore(): void {
  store.clear();
  hitsSinceSweep = 0;
}

/**
 * Best-effort client IP. Prefers Fly's trusted `Fly-Client-IP`, then the first
 * hop of `X-Forwarded-For`, then the `X-Real-IP` header. Falls back to a shared
 * sentinel when no source is present (e.g. in-process test requests) — callers
 * that need per-actor isolation should key on something stronger than IP.
 */
export function clientIp(c: Context): string {
  const fly = c.req.header('fly-client-ip');
  if (fly) return fly.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = c.req.header('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

export type RateLimitOptions = {
  /** Max requests allowed per window for a given key. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Namespacing prefix so independent limiters never share buckets. */
  keyPrefix: string;
  /**
   * Derives the rate-limit key from the request. May be async (e.g. to read the
   * JSON body). Returning `null` skips limiting for that request (fail-open).
   */
  key: (c: Context) => string | null | Promise<string | null>;
};

/**
 * Build a rate-limiting middleware. On limit breach responds 429 with a
 * `Retry-After` header and `{ error: 'rate_limited', retryAfterSeconds }`.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { limit, windowSeconds, keyPrefix, key } = options;
  const windowMs = windowSeconds * 1000;

  return async (c, next) => {
    const rawKey = await key(c);
    if (rawKey === null) return next();

    const now = Date.now();
    if (++hitsSinceSweep >= SWEEP_EVERY) {
      hitsSinceSweep = 0;
      sweep(now);
    }

    const storeKey = `${keyPrefix}:${rawKey}`;
    let bucket = store.get(storeKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(storeKey, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSeconds));

    if (bucket.count > limit) {
      c.header('Retry-After', String(resetSeconds));
      return c.json({ error: 'rate_limited', retryAfterSeconds: resetSeconds }, 429);
    }

    return next();
  };
}

/**
 * Key function that reads a string field from the JSON body (used to limit OTP
 * endpoints per phone). Body is cached by Hono, so the route handler re-reading
 * it is free. Returns `null` (fail-open) when the body is absent/unparseable —
 * the handler's own validation then returns a clean 400.
 */
export function bodyFieldKey(field: string): (c: Context) => Promise<string | null> {
  return async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body && typeof body === 'object') {
      const value = (body as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  };
}
