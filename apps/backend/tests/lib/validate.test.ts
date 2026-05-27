import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody } from '../../src/lib/validate';

describe('parseBody', () => {
  function makeApp(schema: z.ZodType) {
    const app = new Hono();
    app.post('/test', async (c) => {
      const result = await parseBody(c, schema);
      if (result instanceof Response) return result;
      return c.json({ received: result }, 200);
    });
    return app;
  }

  it('returns parsed data on valid body', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const app = makeApp(schema);
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex', age: 30 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toEqual({ name: 'Alex', age: 30 });
  });

  it('returns 400 with validation_error on missing required field', async () => {
    const schema = z.object({ name: z.string() });
    const app = makeApp(schema);
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: true }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('validation_error');
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it('returns 400 on non-JSON body', async () => {
    const schema = z.object({ name: z.string() });
    const app = makeApp(schema);
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('validation_error');
  });
});
