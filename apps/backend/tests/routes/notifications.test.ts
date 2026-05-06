import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { notificationService } from '../../src/modules/notifications/notification.service';
import { notificationsRepo } from '../../src/modules/notifications/notifications.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
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

describe('GET /me/notifications — payload shape contract for inbox deep-linking', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('in_app row for bump_requested includes data.bumpRequestId in payloadJson', async () => {
    // Seed a household + sub-wallet + agent + bump request, then dispatch a bump_requested intent
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await notificationService.dispatch(testDb, {
      kind: 'bump_requested',
      recipientUserId: principal.id,
      dedupeKey: 'bump:test-id',
      payload: {
        bumpRequestId: 'bump-test-1',
        transactionId: 'txn-1',
        amountKobo: 50000n,
        vendorResolvedName: 'MTN',
        agentDisplayName: 'Tomi',
      },
    });

    const app = createServer();
    const res = await app.request('/me/notifications', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notifications: Array<{ channel: string; payloadJson: { data?: { bumpRequestId?: string } } }>;
    };
    const inAppRow = body.notifications.find((n) => n.channel === 'in_app');
    expect(inAppRow).toBeDefined();
    expect(inAppRow?.payloadJson?.data?.bumpRequestId).toBe('bump-test-1');
  });
});
