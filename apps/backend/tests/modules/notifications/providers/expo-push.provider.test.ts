import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../../helpers/test-db';
import { factories } from '../../../helpers/factories';
import { expoPushProvider } from '../../../../src/modules/notifications/providers/expo-push.provider';
import { deviceTokensRepo } from '../../../../src/modules/notifications/device-tokens.repo';
import { usersRepo } from '../../../../src/modules/identity/users.repo';

vi.mock('expo-server-sdk', () => {
  const sendPushNotificationsAsync = vi.fn().mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
  const chunkPushNotifications = (msgs: unknown[]) => [msgs];
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync,
    chunkPushNotifications,
  }));
  // Static method on the class — matches how the provider calls Expo.isExpoPushToken(...)
  ExpoMock.isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

// Vitest hoists vi.mock; need a static reference for the assertion.
import { Expo } from 'expo-server-sdk';

describe('expoPushProvider.send', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns 0/0/0 when user has no registered tokens', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const r = await expoPushProvider.send(testDb, {
      kind: 'txn_settled', recipientUserId: u.id, dedupeKey: 'd', payload: {},
    }, { title: 'x', body: 'y', data: {} });
    expect(r.attempted).toBe(0);
  });

  it('sends to all of a user\'s registered tokens', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    await deviceTokensRepo.register(testDb, {
      userId: u.id, expoPushToken: 'ExponentPushToken[a]', platform: 'android',
    });
    await deviceTokensRepo.register(testDb, {
      userId: u.id, expoPushToken: 'ExponentPushToken[b]', platform: 'ios',
    });
    const r = await expoPushProvider.send(testDb, {
      kind: 'txn_settled', recipientUserId: u.id, dedupeKey: 'd', payload: {},
    }, { title: 'Payment sent', body: '₦100 to M settled.', data: { kind: 'txn_settled' } });
    expect(r.attempted).toBe(2);
    expect(r.accepted).toBe(1); // mock returns one OK ticket
  });
});

// Touch Expo to keep the mock import live (avoids tree-shake warnings).
void Expo;
