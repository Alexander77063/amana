import { describe, expect, it, vi } from 'vitest';
import { PairingApi } from '../src/pairing-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('PairingApi.issue', () => {
  it('POSTs /pairing with householdId', async () => {
    const client = fakeClient(async () => ({
      pairingTokenId: 'pt1',
      code: 'ABC123',
      expiresAt: '2026-05-05T00:30:00Z',
    }));
    const api = new PairingApi(client);
    const r = await api.issue({ householdId: 'h1' });
    expect(r.code).toBe('ABC123');
    expect(client.request).toHaveBeenCalledWith('/pairing', {
      method: 'POST',
      jsonBody: { householdId: 'h1' },
    });
  });
});

describe('PairingApi.complete', () => {
  it('POSTs /pairing/complete with token', async () => {
    const client = fakeClient(async () => ({ subWalletId: 'sw-1' }));
    const api = new PairingApi(client);
    const r = await api.complete('my-pairing-token');
    expect(r.subWalletId).toBe('sw-1');
    expect(client.request).toHaveBeenCalledWith('/pairing/complete', {
      method: 'POST',
      jsonBody: { token: 'my-pairing-token' },
    });
  });
});
