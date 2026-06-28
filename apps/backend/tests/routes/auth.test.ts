import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as codes from '../../src/modules/auth/codes';
import { sessionService } from '../../src/modules/auth/session.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /auth/otp/request', () => {
  beforeEach(async () => {
    await truncateAll();
    // biome-ignore lint/performance/noDelete: unsetting env var so the otp service takes its no-key skip path
    delete process.env.TERMII_API_KEY;
  });

  it('returns challengeId for a valid phone', async () => {
    const app = createServer();
    const res = await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', purpose: 'login' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeId: string; expiresAt: string };
    expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('400 on invalid phone format', async () => {
    const app = createServer();
    const res = await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '0801', purpose: 'login' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/otp/verify (principal signup)', () => {
  beforeEach(async () => {
    await truncateAll();
    // biome-ignore lint/performance/noDelete: unsetting env var so the otp service takes its no-key skip path
    delete process.env.TERMII_API_KEY;
  });

  it('signs up new principal and returns tokens', async () => {
    const spy = vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    const app = createServer();
    await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', purpose: 'login' }),
    });
    spy.mockRestore();

    const res = await app.request('/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: '+2348012345678',
        code: '123456',
        nin: '12345678901',
        bvn: '12345678901',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; user: { role: string } };
    expect(body.accessToken).toMatch(/\./);
    expect(body.user.role).toBe('principal');
  });

  it('401 invalid_code on bad otp (no challenge/wrong-code oracle)', async () => {
    const app = createServer();
    await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', purpose: 'login' }),
    });
    const res = await app.request('/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2348012345678', code: '000000' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
    // A phone with no outstanding challenge returns the SAME generic error.
    const noChallenge = await app.request('/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+2349099999999', code: '000000' }),
    });
    expect(await noChallenge.json()).toEqual({ error: 'invalid_code' });
  });
});

describe('POST /auth/refresh', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rotates and returns new tokens', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const first = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: first.refreshToken,
        userId: u.id,
        role: 'principal',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    expect(body.refreshToken).not.toBe(first.refreshToken);
  });

  it('401 invalid on bogus refresh', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: 'bogus',
        userId: u.id,
        role: 'principal',
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('revokes the session, subsequent /me returns 401', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const tokens = await sessionService.issue(testDb, { userId: u.id, role: 'principal' });
    const app = createServer();
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(200);
    const me = await app.request('/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.status).toBe(401);
  });
});
