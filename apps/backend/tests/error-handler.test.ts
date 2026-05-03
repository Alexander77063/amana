import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler';
import { requestId } from '../src/middleware/request-id';

describe('errorHandler', () => {
  it('returns 500 with error code and request id', async () => {
    const app = new Hono();
    app.use(requestId());
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.onError(errorHandler);
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; requestId: string };
    expect(body.error).toBe('internal_error');
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
