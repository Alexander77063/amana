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
