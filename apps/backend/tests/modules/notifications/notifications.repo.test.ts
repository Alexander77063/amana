import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('notificationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function aUser(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    return u.id;
  }

  it('insert + findByDedupeKey roundtrips', async () => {
    const userId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId,
      kind: 'bump_requested',
      channel: 'push',
      status: 'sent',
      dedupeKey: 'bump:abc',
      payload: { transactionId: 't1' },
    });
    const found = await notificationsRepo.findByDedupeKey(testDb, userId, 'push', 'bump:abc');
    expect(found?.id).toBe(row.id);
  });

  it('markRead transitions sent → read for the matching user', async () => {
    const userId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId,
      kind: 'txn_settled',
      channel: 'in_app',
      status: 'sent',
      dedupeKey: 'txn:t1',
      payload: {},
    });
    expect(await notificationsRepo.markRead(testDb, row.id, userId)).toBe(true);
    const fresh = await notificationsRepo.findByDedupeKey(testDb, userId, 'in_app', 'txn:t1');
    expect(fresh?.status).toBe('read');
  });

  it('markRead returns false if user does not own the row', async () => {
    const userId = await aUser();
    const otherUserId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId,
      kind: 'txn_settled',
      channel: 'in_app',
      status: 'sent',
      dedupeKey: 'txn:t2',
      payload: {},
    });
    expect(await notificationsRepo.markRead(testDb, row.id, otherUserId)).toBe(false);
  });

  it('setStatus updates fields atomically', async () => {
    const userId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId,
      kind: 'txn_failed',
      channel: 'sms',
      status: 'pending',
      dedupeKey: 'txn:t3',
      payload: {},
    });
    await notificationsRepo.setStatus(testDb, row.id, 'sent', { providerReceipt: 'tm-1' });
    const fresh = await notificationsRepo.findByDedupeKey(testDb, userId, 'sms', 'txn:t3');
    expect(fresh?.status).toBe('sent');
    expect(fresh?.providerReceipt).toBe('tm-1');
  });
});
