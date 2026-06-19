import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('usersRepo.setAnchorCustomerId', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('persists anchor_customer_id on the user row', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });

    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-abc');

    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.anchorCustomerId).toBe('anchor-cust-abc');
  });
});

describe('usersRepo.findByAnchorCustomerId', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns user matching the anchor customer id', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-xyz');

    const found = await usersRepo.findByAnchorCustomerId(testDb, 'anchor-cust-xyz');
    expect(found?.id).toBe(user.id);
  });

  it('returns null when no user has that anchor customer id', async () => {
    const found = await usersRepo.findByAnchorCustomerId(testDb, 'nonexistent');
    expect(found).toBeNull();
  });
});
