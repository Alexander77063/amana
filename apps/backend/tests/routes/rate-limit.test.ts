import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/server';
import { truncateAll } from '../helpers/test-db';

// Verifies the limiters are actually wired through createServer (not just the
// middleware in isolation). truncateAll resets the in-memory store per test.
describe('rate limiting (wired through createServer)', () => {
  beforeEach(async () => {
    await truncateAll();
    // biome-ignore lint/performance/noDelete: take the OTP no-key skip path
    delete process.env.TERMII_API_KEY;
  });

  it('429s OTP requests once the per-phone limit (default 5) is exceeded', async () => {
    const app = createServer();
    const headers = { 'content-type': 'application/json' };
    const body = JSON.stringify({ phone: '+2348011112222', purpose: 'login' });

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/auth/otp/request', { method: 'POST', headers, body });
      expect(res.status).toBe(200);
    }
    const limited = await app.request('/auth/otp/request', { method: 'POST', headers, body });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe('rate_limited');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('keys OTP requests independently per phone', async () => {
    const app = createServer();
    const headers = { 'content-type': 'application/json' };
    for (let i = 0; i < 6; i++) {
      await app.request('/auth/otp/request', {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: '+2348011112222', purpose: 'login' }),
      });
    }
    // A different phone has its own bucket and is unaffected.
    const other = await app.request('/auth/otp/request', {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: '+2348093334444', purpose: 'login' }),
    });
    expect(other.status).toBe(200);
  });
});
