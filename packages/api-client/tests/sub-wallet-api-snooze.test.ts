import { describe, expect, it, vi } from 'vitest';
import { SubWalletApi } from '../src/sub-wallet-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('SubWalletApi.snooze', () => {
  it('PUTs /sub-wallets/:id/snooze with future ISO', async () => {
    const client = fakeClient(async () => ({ snoozedUntil: '2026-05-08T18:00:00Z' }));
    const api = new SubWalletApi(client as unknown as never);
    const r = await api.snooze('sw-1', '2026-05-08T18:00:00Z');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw-1/snooze', {
      method: 'PUT',
      jsonBody: { until: '2026-05-08T18:00:00Z' },
    });
    expect(r.snoozedUntil).toBe('2026-05-08T18:00:00Z');
  });

  it('PUTs with until: null for indefinite mute', async () => {
    const client = fakeClient(async () => ({ snoozedUntil: null }));
    const api = new SubWalletApi(client as unknown as never);
    const r = await api.snooze('sw-1', null);
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw-1/snooze', {
      method: 'PUT',
      jsonBody: { until: null },
    });
    expect(r.snoozedUntil).toBeNull();
  });
});

describe('SubWalletApi.unsnooze', () => {
  it('DELETEs /sub-wallets/:id/snooze', async () => {
    const client = fakeClient(async () => ({ snoozedUntil: null }));
    const api = new SubWalletApi(client as unknown as never);
    const r = await api.unsnooze('sw-1');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw-1/snooze', {
      method: 'DELETE',
    });
    expect(r.snoozedUntil).toBeNull();
  });
});
