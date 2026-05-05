import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /devices', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('registers a token and returns the id', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const app = createServer();
    const headers = await bearerHeaders(u);
    const res = await app.request('/devices', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[abc]',
        platform: 'android',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('401 without bearer', async () => {
    const app = createServer();
    const res = await app.request('/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_bearer' });
  });

  it("DELETE /devices/:id returns 404 for someone else's token", async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const other = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const app = createServer();
    const uHeaders = await bearerHeaders(u);
    const otherHeaders = await bearerHeaders(other);
    const create = await app.request('/devices', {
      method: 'POST',
      headers: uHeaders,
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }),
    });
    const { id } = (await create.json()) as { id: string };

    const del = await app.request(`/devices/${id}`, {
      method: 'DELETE',
      headers: otherHeaders,
    });
    expect(del.status).toBe(404);
  });
});
