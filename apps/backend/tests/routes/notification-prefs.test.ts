import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedPrincipal() {
  return usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
}

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
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/notification-preferences', {
      method: 'PUT',
      headers,
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
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/notification-preferences', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ kind: 'bogus', channel: 'push', preference: 'real_time' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /me/quiet-hours', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns defaults when no row exists', async () => {
    const u = await seedPrincipal();
    const app = createServer();
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/quiet-hours', { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, startMinute: 1320, endMinute: 420 });
  });

  it('returns the persisted row when one exists (even if disabled)', async () => {
    const u = await seedPrincipal();
    const app = createServer();
    const headers = await bearerHeaders(u);
    await app.request('/me/quiet-hours', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, startMinute: 60, endMinute: 120 }),
    });
    const res = await app.request('/me/quiet-hours', { headers });
    expect(await res.json()).toEqual({ enabled: false, startMinute: 60, endMinute: 120 });
  });
});

describe('PUT /me/quiet-hours', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('200 happy path', async () => {
    const u = await seedPrincipal();
    const app = createServer();
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/quiet-hours', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, startMinute: 1320, endMinute: 420 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, startMinute: 1320, endMinute: 420 });
  });

  it('400 on startMinute === endMinute', async () => {
    const u = await seedPrincipal();
    const app = createServer();
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/quiet-hours', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, startMinute: 600, endMinute: 600 }),
    });
    expect(res.status).toBe(400);
  });

  it('400 on out-of-range minute', async () => {
    const u = await seedPrincipal();
    const app = createServer();
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/quiet-hours', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, startMinute: 0, endMinute: 1440 }),
    });
    expect(res.status).toBe(400);
  });
});
