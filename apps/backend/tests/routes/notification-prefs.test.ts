import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('PUT /me/notification-preferences', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('upserts a preference', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/me/notification-preferences', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id,
        'x-actor-role': 'principal',
      },
      body: JSON.stringify({
        kind: 'txn_settled',
        channel: 'push',
        preference: 'threshold',
        thresholdKobo: '100000',
      }),
    });
    expect(res.status).toBe(200);
  });

  it('400 on invalid enum value', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/me/notification-preferences', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id,
        'x-actor-role': 'principal',
      },
      body: JSON.stringify({ kind: 'bogus', channel: 'push', preference: 'real_time' }),
    });
    expect(res.status).toBe(400);
  });
});
