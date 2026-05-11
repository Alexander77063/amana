import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors';
import { MeApi } from '../src/me-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('MeApi.getSubWallet', () => {
  it('GETs /me/sub-wallet and returns subWallet + principal', async () => {
    const payload = {
      subWallet: { id: 'sw1', name: 'Driver', masterWalletId: 'mw1' },
      principal: { userId: 'u1', phone: '+2348011111111' },
    };
    const client = fakeClient(async () => payload);
    const api = new MeApi(client);
    const r = await api.getSubWallet();
    expect(r.subWallet.id).toBe('sw1');
    expect(r.principal.phone).toBe('+2348011111111');
    expect(client.request).toHaveBeenCalledWith('/me/sub-wallet');
  });

  it('propagates ApiError 404 when not paired', async () => {
    const client = fakeClient(async () => {
      throw new ApiError('not_paired', 404, 'not_paired', null);
    });
    const api = new MeApi(client);
    await expect(api.getSubWallet()).rejects.toThrow(ApiError);
  });
});
