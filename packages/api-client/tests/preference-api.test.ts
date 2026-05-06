import { describe, expect, it, vi } from 'vitest';
import { PreferenceApi } from '../src/preference-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('PreferenceApi.listForMe', () => {
  it('GETs /me/notification-preferences', async () => {
    const client = fakeClient(async () => ({ preferences: [] }));
    const api = new PreferenceApi(client);
    await api.listForMe();
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences');
  });

  it('returns the parsed list', async () => {
    const client = fakeClient(async () => ({
      preferences: [
        {
          userId: 'u1',
          kind: 'bump_requested',
          channel: 'push',
          preference: 'real_time',
          thresholdKobo: null,
          updatedAt: '2026-05-06T00:00:00Z',
        },
      ],
    }));
    const api = new PreferenceApi(client);
    const r = await api.listForMe();
    expect(r.preferences).toHaveLength(1);
    expect(r.preferences[0]?.preference).toBe('real_time');
  });
});

describe('PreferenceApi.upsert', () => {
  it('PUTs /me/notification-preferences with real_time body', async () => {
    const client = fakeClient(async () => ({
      preference: {
        userId: 'u1',
        kind: 'bump_requested',
        channel: 'push',
        preference: 'real_time',
        thresholdKobo: null,
        updatedAt: '2026-05-06T00:00:00Z',
      },
    }));
    const api = new PreferenceApi(client);
    const r = await api.upsert({
      kind: 'bump_requested',
      channel: 'push',
      preference: 'real_time',
    });
    expect(r.preference.preference).toBe('real_time');
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: { kind: 'bump_requested', channel: 'push', preference: 'real_time' },
    });
  });

  it('PUTs threshold preference with thresholdKobo', async () => {
    const client = fakeClient(async () => ({
      preference: {
        userId: 'u1',
        kind: 'txn_settled',
        channel: 'push',
        preference: 'threshold',
        thresholdKobo: '500000',
        updatedAt: '2026-05-06T00:00:00Z',
      },
    }));
    const api = new PreferenceApi(client);
    await api.upsert({
      kind: 'txn_settled',
      channel: 'push',
      preference: 'threshold',
      thresholdKobo: '500000',
    });
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: {
        kind: 'txn_settled',
        channel: 'push',
        preference: 'threshold',
        thresholdKobo: '500000',
      },
    });
  });

  it('PUTs silent preference and clears thresholdKobo by passing null', async () => {
    const client = fakeClient(async () => ({
      preference: {
        userId: 'u1',
        kind: 'txn_settled',
        channel: 'sms',
        preference: 'silent',
        thresholdKobo: null,
        updatedAt: '2026-05-06T00:00:00Z',
      },
    }));
    const api = new PreferenceApi(client);
    await api.upsert({
      kind: 'txn_settled',
      channel: 'sms',
      preference: 'silent',
      thresholdKobo: null,
    });
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: {
        kind: 'txn_settled',
        channel: 'sms',
        preference: 'silent',
        thresholdKobo: null,
      },
    });
  });
});
