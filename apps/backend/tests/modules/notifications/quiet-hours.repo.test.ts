import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { quietHoursRepo } from '../../../src/modules/notifications/quiet-hours.repo';
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

describe('quietHoursRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('get', () => {
    it('returns null when no row exists', async () => {
      const userId = await aUser();
      expect(await quietHoursRepo.get(testDb, userId)).toBeNull();
    });

    it('returns the persisted row when one exists', async () => {
      const userId = await aUser();
      await quietHoursRepo.upsert(testDb, userId, {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });
      const r = await quietHoursRepo.get(testDb, userId);
      expect(r).toEqual({ enabled: true, startMinute: 1320, endMinute: 420 });
    });
  });

  describe('upsert', () => {
    it('inserts a new row on first call', async () => {
      const userId = await aUser();
      await quietHoursRepo.upsert(testDb, userId, { enabled: false, startMinute: 0, endMinute: 1 });
      expect((await quietHoursRepo.get(testDb, userId))?.enabled).toBe(false);
    });

    it('updates the existing row on subsequent calls', async () => {
      const userId = await aUser();
      await quietHoursRepo.upsert(testDb, userId, { enabled: false, startMinute: 0, endMinute: 1 });
      await quietHoursRepo.upsert(testDb, userId, {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });
      const r = await quietHoursRepo.get(testDb, userId);
      expect(r).toEqual({ enabled: true, startMinute: 1320, endMinute: 420 });
    });
  });
});
