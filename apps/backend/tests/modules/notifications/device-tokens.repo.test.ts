import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { deviceTokensRepo } from '../../../src/modules/notifications/device-tokens.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('deviceTokensRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  async function aUser(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    return u.id;
  }

  it('register inserts a new row on first call', async () => {
    const userId = await aUser();
    const row = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[abc]', platform: 'android',
    });
    expect(row.expoPushToken).toBe('ExponentPushToken[abc]');
    expect(row.platform).toBe('android');
  });

  it('register upserts on conflict (refreshes lastSeenAt)', async () => {
    const userId = await aUser();
    const first = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[abc]', platform: 'android',
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[abc]', platform: 'android', deviceLabel: 'Pixel 7',
    });
    expect(second.id).toBe(first.id); // same row
    expect(second.deviceLabel).toBe('Pixel 7');
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it('listByUser returns tokens in lastSeen DESC', async () => {
    const userId = await aUser();
    await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[a]', platform: 'android',
    });
    await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[b]', platform: 'ios',
    });
    const list = await deviceTokensRepo.listByUser(testDb, userId);
    expect(list).toHaveLength(2);
  });

  it('deleteById removes only the matching row for the user', async () => {
    const userId = await aUser();
    const otherUserId = await aUser();
    const row = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[mine]', platform: 'android',
    });
    const wrongUserDelete = await deviceTokensRepo.deleteById(testDb, row.id, otherUserId);
    expect(wrongUserDelete).toBe(false);
    const okDelete = await deviceTokensRepo.deleteById(testDb, row.id, userId);
    expect(okDelete).toBe(true);
  });
});
