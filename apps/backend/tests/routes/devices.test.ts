import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { usersRepo } from '../../src/modules/identity/users.repo';

describe('POST /devices', () => {
  beforeEach(async () => { await truncateAll(); });

  it('registers a token and returns the id', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/devices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id, 'x-actor-role': 'agent',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[abc]', platform: 'android',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('401 without actor headers', async () => {
    const app = createServer();
    const res = await app.request('/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }),
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /devices/:id returns 404 for someone else\'s token', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const other = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const create = await app.request('/devices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id, 'x-actor-role': 'agent',
      },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }),
    });
    const { id } = await create.json() as { id: string };

    const del = await app.request(`/devices/${id}`, {
      method: 'DELETE',
      headers: { 'x-actor-user-id': other.id, 'x-actor-role': 'agent' },
    });
    expect(del.status).toBe(404);
  });
});
