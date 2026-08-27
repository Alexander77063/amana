import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler';
import { requestId } from '../../src/middleware/request-id';
import { HSTS_VALUE, securityHeaders } from '../../src/middleware/security-headers';
import { createServer } from '../../src/server';

const HEADER = 'strict-transport-security';

/**
 * Item 1 of the vendor-code pre-distribution gate (docs/runbook/go-live-checklist.md §6).
 *
 * "Every response, not just `/v`" is the requirement, and the interesting half of it is the
 * responses nobody writes a happy-path test for: 404s, thrown errors, and 401s. A header set only
 * on the success path would pass a casual check of `/v/:code` and still leave the first hit to
 * `pay.amana.ng` unprotected whenever it landed on anything else.
 */
describe('securityHeaders', () => {
  function appWith(register: (app: Hono) => void): Hono {
    const app = new Hono();
    app.use(securityHeaders());
    app.use(requestId());
    register(app);
    app.onError(errorHandler);
    return app;
  }

  it('serves the exact header the preload list requires', async () => {
    const app = appWith((a) => a.get('/ok', (c) => c.text('ok')));
    const res = await app.request('/ok');
    expect(res.headers.get(HEADER)).toBe('max-age=63072000; includeSubDomains; preload');
  });

  it('the exported constant is what is served', async () => {
    const app = appWith((a) => a.get('/ok', (c) => c.text('ok')));
    const res = await app.request('/ok');
    expect(res.headers.get(HEADER)).toBe(HSTS_VALUE);
  });

  // A route that was never registered never reaches a handler, so a header set inside one is
  // absent here. This is the case a sticker actually produces when the code is mistyped.
  it('is present on a 404 for an unregistered route', async () => {
    const app = appWith((a) => a.get('/ok', (c) => c.text('ok')));
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get(HEADER)).toBe(HSTS_VALUE);
  });

  // errorHandler builds a BRAND-NEW Response. Anything merely staged on the context before the
  // throw can be lost, so this pins that the header survives onto the replacement.
  it('is present on a 500 produced by a thrown error', async () => {
    const app = appWith((a) =>
      a.get('/boom', () => {
        throw new Error('kaboom');
      }),
    );
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(res.headers.get(HEADER)).toBe(HSTS_VALUE);
  });

  it('is present on a 401 short-circuited before the handler', async () => {
    const app = appWith((a) => {
      a.use('/guarded', async (c) => c.json({ error: 'unauthorized' }, 401));
      a.get('/guarded', (c) => c.text('never reached'));
    });
    const res = await app.request('/guarded');
    expect(res.status).toBe(401);
    expect(res.headers.get(HEADER)).toBe(HSTS_VALUE);
  });

  it('does not clobber other response headers', async () => {
    const app = appWith((a) => a.get('/ok', (c) => c.text('ok')));
    const res = await app.request('/ok');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  // The wiring, not just the middleware: a middleware nothing mounts protects nothing.
  it('the real server serves it on /health', async () => {
    const res = await createServer().request('/health');
    expect(res.headers.get(HEADER)).toBe(HSTS_VALUE);
  });

  it('the real server serves it on the public vendor page path', async () => {
    // Any `/v/...` response will do — the point is the header, not the body.
    const res = await createServer().request('/v/AMNV-00000-00000');
    expect(res.headers.get(HEADER)).toBe(HSTS_VALUE);
  });
});
