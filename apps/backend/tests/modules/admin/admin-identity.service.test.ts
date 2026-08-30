// apps/backend/tests/modules/admin/admin-identity.service.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../../src/env';
import { adminIdentityService } from '../../../src/modules/admin/admin-identity.service';
import { adminUsersRepo } from '../../../src/modules/admin/admin-users.repo';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('adminIdentityService.ensureBootstrapOwner', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('seeds the configured owner, marked as provisioned from config', async () => {
    await adminIdentityService.ensureBootstrapOwner(testDb);

    const owner = await adminUsersRepo.findByEmail(testDb, env.ADMIN_BOOTSTRAP_OWNER_EMAIL);
    expect(owner).not.toBeNull();
    expect(owner?.email).toBe(env.ADMIN_BOOTSTRAP_OWNER_EMAIL);
    // Invariant 6: the seed is the only way an admin exists before Task 2's onboarding, and the
    // row says so in the data — an admin provisioned any other way must stay distinguishable.
    expect(owner?.provisioningSource).toBe('config');
    expect(owner?.status).toBe('active');
    // Identity only in Task 1. The Google subject is bound on first sign-in, not at seed time.
    expect(owner?.googleSubject).toBeNull();
  });

  it('is idempotent — running twice leaves exactly one owner', async () => {
    await adminIdentityService.ensureBootstrapOwner(testDb);
    await adminIdentityService.ensureBootstrapOwner(testDb);

    const all = await adminUsersRepo.listAll(testDb);
    expect(all).toHaveLength(1);
  });
});
