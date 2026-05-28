import { describe, expect, it, vi } from 'vitest';
import { runLogout } from './logout';

describe('runLogout', () => {
  function makeTokenStore(hasAuth: boolean) {
    return {
      read: vi.fn().mockResolvedValue(
        hasAuth
          ? { tokens: { accessToken: 'A1', refreshToken: 'R1', accessExpiresAt: '', refreshExpiresAt: '' }, user: { id: 'u1', role: 'principal', phone: '', kycTier: '1' } }
          : null
      ),
      write: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makeApi(logoutShouldFail = false) {
    return {
      auth: {
        logout: logoutShouldFail
          ? vi.fn().mockRejectedValue(new Error('network'))
          : vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as import('@amana/api-client').AmanaApiClient;
  }

  it('calls unregisterPush, revokes token, clears storage', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const store = makeTokenStore(true);
    const api = makeApi();

    await runLogout(api, store as never, unregister);

    expect(unregister).toHaveBeenCalledOnce();
    expect(api.auth.logout).toHaveBeenCalledWith('A1');
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it('clears storage even if revoke fails', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const store = makeTokenStore(true);
    const api = makeApi(true);

    await runLogout(api, store as never, unregister);

    expect(store.clear).toHaveBeenCalledOnce();
  });

  it('skips revoke if no stored auth', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const store = makeTokenStore(false);
    const api = makeApi();

    await runLogout(api, store as never, unregister);

    expect(api.auth.logout).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledOnce();
  });
});
