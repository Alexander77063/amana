import { describe, expect, it, vi } from 'vitest';
import { DeviceApi } from '../src/device-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('DeviceApi.register', () => {
  it('POSTs /devices with token + platform', async () => {
    const client = fakeClient(async () => ({ id: 'd1' }));
    const api = new DeviceApi(client);
    const r = await api.register({
      expoPushToken: 'ExponentPushToken[abc]',
      platform: 'ios',
    });
    expect(r.id).toBe('d1');
    expect(client.request).toHaveBeenCalledWith('/devices', {
      method: 'POST',
      jsonBody: { expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' },
    });
  });

  it('forwards optional deviceLabel', async () => {
    const client = fakeClient(async () => ({ id: 'd1' }));
    const api = new DeviceApi(client);
    await api.register({
      expoPushToken: 'ExponentPushToken[abc]',
      platform: 'android',
      deviceLabel: 'Pixel 8',
    });
    expect(client.request).toHaveBeenCalledWith('/devices', {
      method: 'POST',
      jsonBody: {
        expoPushToken: 'ExponentPushToken[abc]',
        platform: 'android',
        deviceLabel: 'Pixel 8',
      },
    });
  });
});

describe('DeviceApi.unregister', () => {
  it('DELETEs /devices/:id', async () => {
    const client = fakeClient(async () => ({ deleted: true }));
    const api = new DeviceApi(client);
    const r = await api.unregister('d1');
    expect(r.deleted).toBe(true);
    expect(client.request).toHaveBeenCalledWith('/devices/d1', {
      method: 'DELETE',
    });
  });
});
