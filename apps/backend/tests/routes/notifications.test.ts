import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../src/modules/notifications/notifications.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { bearerHeaders } from '../helpers/bearer';
import { testDb, truncateAll } from '../helpers/test-db';

describe('GET /me/notifications', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns my notifications, most-recent first', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await notificationsRepo.insert(testDb, {
      recipientUserId: u.id,
      kind: 'txn_settled',
      channel: 'in_app',
      status: 'sent',
      dedupeKey: 'a',
      payload: {},
    });
    await notificationsRepo.insert(testDb, {
      recipientUserId: u.id,
      kind: 'bump_requested',
      channel: 'in_app',
      status: 'sent',
      dedupeKey: 'b',
      payload: {},
    });
    const app = createServer();
    const headers = await bearerHeaders(u);
    const res = await app.request('/me/notifications', { headers });
    const body = (await res.json()) as { notifications: { dedupeKey: string }[] };
    expect(body.notifications).toHaveLength(2);
  });
});
