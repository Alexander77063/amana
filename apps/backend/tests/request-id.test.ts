import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requestId } from '../src/middleware/request-id';

describe('request-id middleware', () => {
  it('generates a UUID when no incoming header is present', async () => {
    const app = new Hono().use(requestId()).get('/', (c) => c.text(c.get('requestId') as string));
    const res = await app.request('/');
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(await res.text()).toBe(id);
  });

  it('echoes an incoming x-request-id header', async () => {
    const app = new Hono().use(requestId()).get('/', (c) => c.text(c.get('requestId') as string));
    const res = await app.request('/', { headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('abc-123');
    expect(await res.text()).toBe('abc-123');
  });
});
