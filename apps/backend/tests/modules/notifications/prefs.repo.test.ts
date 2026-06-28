import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { prefsRepo } from '../../../src/modules/notifications/prefs.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

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

describe('prefsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('upsert updates the existing row on (user, kind, channel) conflict', async () => {
    const userId = await aUser();
    const first = await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'real_time',
    });
    const second = await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'silent',
    });
    expect(second.id).toBe(first.id);
    expect(second.preference).toBe('silent');
    const list = await prefsRepo.listByUser(testDb, userId);
    expect(list).toHaveLength(1);
  });

  it('persists thresholdKobo as a string and clears it when null', async () => {
    const userId = await aUser();
    const withThreshold = await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'threshold',
      thresholdKobo: 500_000n,
    });
    expect(withThreshold.thresholdKobo).toBe('500000');
    const cleared = await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'real_time',
      thresholdKobo: null,
    });
    expect(cleared.thresholdKobo).toBeNull();
  });

  it('findOne returns the matching preference and undefined otherwise', async () => {
    const userId = await aUser();
    await prefsRepo.upsert(testDb, {
      userId,
      kind: 'bump_requested',
      channel: 'push',
      preference: 'real_time',
    });
    const found = await prefsRepo.findOne(testDb, userId, 'bump_requested', 'push');
    expect(found?.preference).toBe('real_time');
    const missing = await prefsRepo.findOne(testDb, userId, 'bump_requested', 'in_app');
    expect(missing).toBeUndefined();
  });

  it('listByUser scopes rows to the given user', async () => {
    const a = await aUser();
    const b = await aUser();
    await prefsRepo.upsert(testDb, {
      userId: a,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'silent',
    });
    await prefsRepo.upsert(testDb, {
      userId: a,
      kind: 'txn_failed',
      channel: 'sms',
      preference: 'real_time',
    });
    await prefsRepo.upsert(testDb, {
      userId: b,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'digest',
    });
    expect(await prefsRepo.listByUser(testDb, a)).toHaveLength(2);
    expect(await prefsRepo.listByUser(testDb, b)).toHaveLength(1);
  });
});
