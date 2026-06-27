import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyFieldKey,
  clientIp,
  rateLimit,
  resetRateLimitStore,
} from '../../src/middleware/rate-limit';

function appWith(mw: ReturnType<typeof rateLimit>): Hono {
  const app = new Hono();
  app.use('/t', mw);
  app.get('/t', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  afterEach(() => resetRateLimitStore());

  it('allows up to the limit, then responds 429 with Retry-After', async () => {
    const app = appWith(
      rateLimit({ limit: 3, windowSeconds: 60, keyPrefix: 'k', key: () => 'same' }),
    );
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/t')).status).toBe(200);
    }
    const res = await app.request('/t');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('exposes X-RateLimit-* headers with a decreasing remaining count', async () => {
    const app = appWith(rateLimit({ limit: 2, windowSeconds: 60, keyPrefix: 'h', key: () => 'x' }));
    const first = await app.request('/t');
    expect(first.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(first.headers.get('X-RateLimit-Remaining')).toBe('1');
    const second = await app.request('/t');
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('isolates buckets by key', async () => {
    let who = 'a';
    const app = appWith(
      rateLimit({ limit: 1, windowSeconds: 60, keyPrefix: 'iso', key: () => who }),
    );
    expect((await app.request('/t')).status).toBe(200);
    expect((await app.request('/t')).status).toBe(429);
    who = 'b';
    expect((await app.request('/t')).status).toBe(200);
  });

  it('isolates buckets by keyPrefix even for an identical key', async () => {
    const key = () => 'same';
    const app = new Hono();
    app.use('/a', rateLimit({ limit: 1, windowSeconds: 60, keyPrefix: 'pa', key }));
    app.use('/b', rateLimit({ limit: 1, windowSeconds: 60, keyPrefix: 'pb', key }));
    app.get('/a', (c) => c.text('a'));
    app.get('/b', (c) => c.text('b'));
    expect((await app.request('/a')).status).toBe(200);
    expect((await app.request('/b')).status).toBe(200);
    expect((await app.request('/a')).status).toBe(429);
  });

  it('fails open when the key function returns null', async () => {
    const app = appWith(
      rateLimit({ limit: 1, windowSeconds: 60, keyPrefix: 'no', key: () => null }),
    );
    expect((await app.request('/t')).status).toBe(200);
    expect((await app.request('/t')).status).toBe(200);
  });

  it('resets the counter once the window has elapsed', async () => {
    // windowSeconds: 0 → the bucket expires immediately, so every call re-opens it.
    const app = appWith(rateLimit({ limit: 1, windowSeconds: 0, keyPrefix: 'w', key: () => 'z' }));
    expect((await app.request('/t')).status).toBe(200);
    expect((await app.request('/t')).status).toBe(200);
  });

  it('resetRateLimitStore clears all counters', async () => {
    const app = appWith(rateLimit({ limit: 1, windowSeconds: 60, keyPrefix: 'r', key: () => 'z' }));
    expect((await app.request('/t')).status).toBe(200);
    expect((await app.request('/t')).status).toBe(429);
    resetRateLimitStore();
    expect((await app.request('/t')).status).toBe(200);
  });
});

describe('clientIp', () => {
  async function capture(headers: Record<string, string>): Promise<string> {
    let ip = '';
    const app = new Hono();
    app.get('/ip', (c) => {
      ip = clientIp(c);
      return c.text('ok');
    });
    await app.request('/ip', { headers });
    return ip;
  }

  it('prefers fly-client-ip', async () => {
    expect(await capture({ 'fly-client-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })).toBe(
      '1.2.3.4',
    );
  });

  it('falls back to the first hop of x-forwarded-for', async () => {
    expect(await capture({ 'x-forwarded-for': '5.5.5.5, 6.6.6.6' })).toBe('5.5.5.5');
  });

  it('falls back to x-real-ip', async () => {
    expect(await capture({ 'x-real-ip': '7.7.7.7' })).toBe('7.7.7.7');
  });

  it('returns the shared sentinel when no source header is present', async () => {
    expect(await capture({})).toBe('unknown');
  });
});

describe('bodyFieldKey', () => {
  async function extract(field: string, body: string): Promise<string | null> {
    const key = bodyFieldKey(field);
    let value: string | null = 'unset';
    const app = new Hono();
    app.post('/b', async (c) => {
      value = await key(c);
      return c.text('ok');
    });
    await app.request('/b', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    return value;
  }

  it('extracts a string field from the JSON body', async () => {
    expect(await extract('phone', JSON.stringify({ phone: '+2348012345678' }))).toBe(
      '+2348012345678',
    );
  });

  it('returns null when the field is missing', async () => {
    expect(await extract('phone', JSON.stringify({ other: 'x' }))).toBeNull();
  });

  it('returns null on an unparseable body', async () => {
    expect(await extract('phone', 'not-json{')).toBeNull();
  });
});
