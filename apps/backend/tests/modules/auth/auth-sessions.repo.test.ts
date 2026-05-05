import { beforeEach, describe, expect, it } from 'vitest';
import { authSessionsRepo } from '../../../src/modules/auth/auth-sessions.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('authSessionsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert + findById', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const s = await authSessionsRepo.insert(testDb, {
      userId: u.id,
      refreshTokenHash: 'h1',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const f = await authSessionsRepo.findById(testDb, s.id);
    expect(f?.userId).toBe(u.id);
  });

  it('listActive excludes revoked + expired', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const active = await authSessionsRepo.insert(testDb, {
      userId: u.id,
      refreshTokenHash: 'a',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const expired = await authSessionsRepo.insert(testDb, {
      userId: u.id,
      refreshTokenHash: 'b',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await authSessionsRepo.insert(testDb, {
      userId: u.id,
      refreshTokenHash: 'c',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    await authSessionsRepo.revoke(testDb, revoked.id, new Date());
    const list = await authSessionsRepo.listActive(testDb, u.id, new Date());
    expect(list.map((r) => r.id)).toEqual([active.id]);
    expect(list.find((r) => r.id === expired.id)).toBeUndefined();
  });

  it('rotate revokes old + inserts new in single transaction', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const old = await authSessionsRepo.insert(testDb, {
      userId: u.id,
      refreshTokenHash: 'old',
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const fresh = await authSessionsRepo.rotate(
      testDb,
      old.id,
      { userId: u.id, refreshTokenHash: 'new', expiresAt: new Date(Date.now() + 1_000_000) },
      new Date(),
    );
    const oldNow = await authSessionsRepo.findById(testDb, old.id);
    expect(oldNow?.revokedAt).not.toBeNull();
    expect(fresh.refreshTokenHash).toBe('new');
  });
});
