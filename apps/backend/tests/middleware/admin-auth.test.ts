import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { adminAuth } from '../../src/middleware/admin-auth';

function appWith(key: string | undefined) {
  const app = new Hono();
  app.use('/admin/*', adminAuth(key));
  app.get('/admin/ok', (c) => c.json({ ok: true }));
  return app;
}

describe('adminAuth', () => {
  it('401s when no key is configured (fails closed, never open)', async () => {
    const res = await appWith(undefined).request('/admin/ok', {
      headers: { 'x-admin-api-key': 'anything' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'admin_unauthorized' });
  });

  it('401s on a wrong key of the same length', async () => {
    const res = await appWith('secret').request('/admin/ok', {
      headers: { 'x-admin-api-key': 'secres' },
    });
    expect(res.status).toBe(401);
  });

  it('401s on a wrong key of a different length', async () => {
    const res = await appWith('secret').request('/admin/ok', {
      headers: { 'x-admin-api-key': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  it('401s on a missing header', async () => {
    const res = await appWith('secret').request('/admin/ok');
    expect(res.status).toBe(401);
  });

  it('401s on an empty header value', async () => {
    const res = await appWith('secret').request('/admin/ok', {
      headers: { 'x-admin-api-key': '' },
    });
    expect(res.status).toBe(401);
  });

  it('passes on the correct key', async () => {
    const res = await appWith('secret').request('/admin/ok', {
      headers: { 'x-admin-api-key': 'secret' },
    });
    expect(res.status).toBe(200);
  });
});
