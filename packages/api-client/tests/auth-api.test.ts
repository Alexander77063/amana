import { describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../src/auth-api';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('AuthApi.requestOtp', () => {
  it('POSTs to /auth/otp/request and returns the parsed body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ok({ challengeId: 'c1', expiresAt: '2026-05-05T00:05:00Z' }));
    const api = new AuthApi('https://api.x', fetchImpl);
    const r = await api.requestOtp({ phone: '+2348012345678', purpose: 'login' });
    expect(r.challengeId).toBe('c1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x/auth/otp/request',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
  });

  it('throws ApiError on 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ error: 'invalid_phone' }, 400));
    const api = new AuthApi('https://api.x', fetchImpl);
    await expect(api.requestOtp({ phone: 'bad', purpose: 'login' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'invalid_phone',
    });
  });
});

describe('AuthApi.verifyOtp', () => {
  it('returns LoginResponse on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        accessToken: 'a.b.c',
        refreshToken: 'r1',
        accessExpiresAt: '2026-05-05T00:05:00Z',
        refreshExpiresAt: '2026-06-04T00:00:00Z',
        user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '1' },
      }),
    );
    const api = new AuthApi('https://api.x', fetchImpl);
    const r = await api.verifyOtp({ phone: '+234801', code: '123456', nin: '1', bvn: '2' });
    expect(r.user.role).toBe('principal');
    expect(r.accessToken).toBe('a.b.c');
  });
});

describe('AuthApi.me', () => {
  it('GETs /me with bearer header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ok({ id: 'u1', role: 'principal', phone: '+234801', kycTier: '1', status: 'active' }),
      );
    const api = new AuthApi('https://api.x', fetchImpl);
    const u = await api.me('access-token');
    expect(u.id).toBe('u1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('throws ApiError on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ error: 'session_revoked' }, 401));
    const api = new AuthApi('https://api.x', fetchImpl);
    await expect(api.me('stale')).rejects.toMatchObject({ status: 401, code: 'session_revoked' });
  });
});

describe('AuthApi network errors', () => {
  it('wraps fetch failure in ApiError(network_error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const api = new AuthApi('https://api.x', fetchImpl);
    await expect(api.requestOtp({ phone: '+234', purpose: 'login' })).rejects.toMatchObject({
      code: 'network_error',
      status: 0,
    });
  });
});
