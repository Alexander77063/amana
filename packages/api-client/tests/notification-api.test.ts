import { describe, expect, it, vi } from 'vitest';
import { NotificationApi } from '../src/notification-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('NotificationApi.listForMe', () => {
  it('GETs /me/notifications', async () => {
    const client = fakeClient(async () => ({ notifications: [] }));
    const api = new NotificationApi(client);
    await api.listForMe();
    expect(client.request).toHaveBeenCalledWith('/me/notifications');
  });

  it('returns the parsed list', async () => {
    const client = fakeClient(async () => ({
      notifications: [
        {
          id: 'n1',
          recipientUserId: 'u1',
          kind: 'bump_requested',
          channel: 'in_app',
          status: 'sent',
          dedupeKey: 'bump:b1',
          payloadJson: { bumpRequestId: 'b1' },
          createdAt: '2026-05-06T00:00:00Z',
          updatedAt: '2026-05-06T00:00:00Z',
        },
      ],
    }));
    const api = new NotificationApi(client);
    const r = await api.listForMe();
    expect(r.notifications[0]?.id).toBe('n1');
    expect(r.notifications[0]?.kind).toBe('bump_requested');
  });
});

describe('NotificationApi.markRead', () => {
  it('POSTs /me/notifications/:id/read', async () => {
    const client = fakeClient(async () => ({ marked: true }));
    const api = new NotificationApi(client);
    const r = await api.markRead('n1');
    expect(r.marked).toBe(true);
    expect(client.request).toHaveBeenCalledWith('/me/notifications/n1/read', {
      method: 'POST',
    });
  });
});
