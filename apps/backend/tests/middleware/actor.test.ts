import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { actor, type Actor } from '../../src/middleware/actor';

describe('actor middleware', () => {
  it('parses x-actor-user-id + x-actor-role into ctx', async () => {
    const app = new Hono().use(actor()).get('/', (c) => {
      const a = c.get('actor') as Actor;
      return c.json({ id: a.userId, role: a.role });
    });
    const res = await app.request('/', {
      headers: { 'x-actor-user-id': 'u1', 'x-actor-role': 'principal' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1', role: 'principal' });
  });

  it('returns 401 when headers missing', async () => {
    const app = new Hono().use(actor()).get('/', (c) => c.text('ok'));
    const res = await app.request('/');
    expect(res.status).toBe(401);
  });

  it('returns 401 when role is not principal or agent', async () => {
    const app = new Hono().use(actor()).get('/', (c) => c.text('ok'));
    const res = await app.request('/', {
      headers: { 'x-actor-user-id': 'u1', 'x-actor-role': 'admin' },
    });
    expect(res.status).toBe(401);
  });
});
