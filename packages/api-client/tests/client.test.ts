import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmanaApiClient } from '../src/client';
import { type TokenStore, createInMemoryTokenStore } from '../src/token-store';
import type { StoredAuth } from '../src/token-store';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const seedAuth = async (
  store: TokenStore,
  accessToken = 'A1',
  refreshToken = 'R1',
): Promise<StoredAuth> => {
  const auth: StoredAuth = {
    tokens: {
      accessToken,
      refreshToken,
      accessExpiresAt: '2026-05-05T00:05:00Z',
      refreshExpiresAt: '2026-06-04T00:00:00Z',
    },
    user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '1' },
  };
  await store.write(auth);
  return auth;
};

describe('AmanaApiClient.health', () => {
  it('returns parsed body on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ status: 'ok', version: '0.1.0' }));
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl });
    expect(await client.health()).toEqual({ status: 'ok', version: '0.1.0' });
  });
});

describe('AmanaApiClient.request', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let tokenStore: TokenStore;

  beforeEach(() => {
    fetchImpl = vi.fn();
    tokenStore = createInMemoryTokenStore();
  });

  it('adds bearer header from token store', async () => {
    await seedAuth(tokenStore, 'A1');
    fetchImpl.mockResolvedValueOnce(ok({ ok: true }));
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    await client.request('/me/notifications');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x/me/notifications',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer A1' }),
      }),
    );
  });

  it('on 401 refreshes once + retries with new bearer', async () => {
    await seedAuth(tokenStore, 'A1', 'R1');
    fetchImpl
      .mockResolvedValueOnce(ok({ error: 'session_expired' }, 401))
      .mockResolvedValueOnce(
        ok({
          accessToken: 'A2',
          refreshToken: 'R2',
          accessExpiresAt: '2026-05-05T00:10:00Z',
          refreshExpiresAt: '2026-06-04T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(ok({ ok: true }));

    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    const r = await client.request<{ ok: boolean }>('/me/notifications');
    expect(r.ok).toBe(true);
    const stored = await tokenStore.read();
    expect(stored?.tokens.accessToken).toBe('A2');

    const calls = fetchImpl.mock.calls;
    expect(calls.length).toBe(3);
    const lastInit = calls[2]?.[1] as { headers: { authorization: string } };
    expect(lastInit.headers.authorization).toBe('Bearer A2');
  });

  it('only refreshes once even on concurrent 401s (single-flight)', async () => {
    await seedAuth(tokenStore, 'A1', 'R1');
    let refreshCalls = 0;
    fetchImpl.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return ok({
          accessToken: `A2_${refreshCalls}`,
          refreshToken: `R2_${refreshCalls}`,
          accessExpiresAt: '2026-05-05T00:10:00Z',
          refreshExpiresAt: '2026-06-04T00:00:00Z',
        });
      }
      const stored = await tokenStore.read();
      if (stored?.tokens.accessToken === 'A1') return ok({ error: 'session_expired' }, 401);
      return ok({ ok: true });
    });
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    const [r1, r2] = await Promise.all([
      client.request<{ ok: boolean }>('/p/1'),
      client.request<{ ok: boolean }>('/p/2'),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('throws not_authed when no token in store', async () => {
    const client = new AmanaApiClient({
      baseUrl: 'https://api.x',
      fetchImpl,
      tokenStore: createInMemoryTokenStore(),
    });
    await expect(client.request('/anything')).rejects.toMatchObject({
      status: 401,
      code: 'not_authed',
    });
  });

  it('throws on second 401 (refresh did not unblock)', async () => {
    await seedAuth(tokenStore, 'A1', 'R1');
    fetchImpl
      .mockResolvedValueOnce(ok({ error: 'session_revoked' }, 401))
      .mockResolvedValueOnce(
        ok({
          accessToken: 'A2',
          refreshToken: 'R2',
          accessExpiresAt: '2026-05-05T00:10:00Z',
          refreshExpiresAt: '2026-06-04T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(ok({ error: 'session_revoked' }, 401));

    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
    await expect(client.request('/p')).rejects.toMatchObject({
      status: 401,
      code: 'session_revoked',
    });
  });
});
