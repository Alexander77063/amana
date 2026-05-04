import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../../helpers/test-db';
import { factories } from '../../../helpers/factories';
import { inAppProvider } from '../../../../src/modules/notifications/providers/in-app.provider';
import { notificationsRepo } from '../../../../src/modules/notifications/notifications.repo';
import { usersRepo } from '../../../../src/modules/identity/users.repo';

describe('inAppProvider.send', () => {
  beforeEach(async () => { await truncateAll(); });

  it('inserts a notifications row with status=sent and stores rendered content', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const result = await inAppProvider.send(testDb, {
      kind: 'txn_settled', recipientUserId: u.id, dedupeKey: 'txn:t1', payload: {},
    }, {
      title: 'Payment sent', body: '₦5,000 to M settled.',
      data: { kind: 'txn_settled', transactionId: 't1' },
    });
    const row = await notificationsRepo.findByDedupeKey(testDb, u.id, 'in_app', 'txn:t1');
    expect(row?.id).toBe(result.notificationId);
    expect(row?.status).toBe('sent');
    expect((row?.payloadJson as { title: string }).title).toBe('Payment sent');
  });
});
