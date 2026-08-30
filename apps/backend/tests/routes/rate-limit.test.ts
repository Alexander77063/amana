import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/env';
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

  it('429s admin sign-in once the per-IP limit is exceeded', async () => {
    // This limiter is load-bearing for a decision made elsewhere: `admin-identity.service` does
    // NOT audit the refusals that happen before Google has verified an identity (unknown state,
    // failed exchange), on the explicit grounds that this bounds them instead. Without it,
    // `/admin/auth/callback` is an unauthenticated endpoint that an anonymous caller can drive as
    // hard as they like — a state lookup and an outbound Google call each time.
    //
    // It is also the only bound on `/admin/auth/*` at all: `adminSession()` does not guard the
    // door people come through.
    const app = createServer();
    const limit = env.RATE_LIMIT_AUTH_PER_IP;

    for (let i = 0; i < limit; i++) {
      const res = await app.request('/admin/auth/start');
      expect(res.status).toBe(302);
    }
    const limited = await app.request('/admin/auth/start');
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
