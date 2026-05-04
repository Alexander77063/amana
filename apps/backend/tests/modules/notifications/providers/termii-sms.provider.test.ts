import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usersRepo } from '../../../../src/modules/identity/users.repo';
import { termiiSmsProvider } from '../../../../src/modules/notifications/providers/termii-sms.provider';
import { factories } from '../../../helpers/factories';
import { testDb, truncateAll } from '../../../helpers/test-db';

describe('termiiSmsProvider.send', () => {
  beforeEach(async () => {
    await truncateAll();
    // biome-ignore lint/performance/noDelete: unsetting env var so the provider takes its no-key skip path
    delete process.env.TERMII_API_KEY;
  });

  it('skips when TERMII_API_KEY is not set (default in test env)', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const r = await termiiSmsProvider.send(
      testDb,
      {
        kind: 'bump_requested',
        recipientUserId: u.id,
        dedupeKey: 'd',
        payload: {},
      },
      { title: 'Approve a bump?', body: 'Driver wants ₦5,000 at M.', data: {} },
    );
    expect(r.kind).toBe('skipped_no_key');
  });

  // Live SMS smoke is covered by Sub-plan 8 with a real TERMII_API_KEY.
});
