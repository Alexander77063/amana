import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorCategoryResolver } from '../../../src/modules/vendors/vendor-category-resolver.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorCategoryResolver.resolve', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns null for a null account', async () => {
    expect(await vendorCategoryResolver.resolve(testDb, null, null)).toBeNull();
    expect(await vendorCategoryResolver.resolve(testDb, '058', null)).toBeNull();
  });

  it('returns null for an account that is not in the registry', async () => {
    const r = await vendorCategoryResolver.resolve(
      testDb,
      factories.bankCode(),
      factories.bankAccount(),
    );
    expect(r).toBeNull();
  });

  it('reports an observed category as NOT enforceable', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode,
      accountNumber,
      displayName: 'SHOP',
      promotedHouseholdCount: 9,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.setObservedCategory(testDb, v.id, 'food', 9);

    const r = await vendorCategoryResolver.resolve(testDb, bankCode, accountNumber);
    expect(r).toEqual({
      vendorId: v.id,
      category: 'food',
      categorySource: 'observed',
      enforceable: false,
    });
  });

  it('reports a claimed category as enforceable', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode,
      accountNumber,
      displayName: 'SHOP',
      promotedHouseholdCount: 9,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await testDb.execute(
      sql`UPDATE vendors SET category = 'transport', category_source = 'claimed' WHERE id = ${v.id}`,
    );

    const r = await vendorCategoryResolver.resolve(testDb, bankCode, accountNumber);
    expect(r?.enforceable).toBe(true);
    expect(r?.category).toBe('transport');
  });

  it('a suspended claimed vendor is NOT enforceable, but still returns its category', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode,
      accountNumber,
      displayName: 'SHOP',
      promotedHouseholdCount: 9,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await testDb.execute(
      sql`UPDATE vendors SET category = 'transport', category_source = 'claimed', status = 'suspended' WHERE id = ${v.id}`,
    );

    const r = await vendorCategoryResolver.resolve(testDb, bankCode, accountNumber);
    expect(r?.enforceable).toBe(false);
    // Suspension strips the AUTHORITY to drive a decision, not the SIGNAL: the shadow-mode
    // divergence logging in `lifecycleService.evaluate` still needs `category` and `vendorId` to
    // keep recording what the registry believed. A null return here would silently kill that
    // visibility for exactly the vendor an operator most wants to keep watching.
    expect(r?.category).toBe('transport');
    expect(r?.vendorId).toBe(v.id);
  });

  it('a claimed, non-suspended vendor stays enforceable (guard against over-correction)', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode,
      accountNumber,
      displayName: 'SHOP',
      promotedHouseholdCount: 9,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await testDb.execute(
      sql`UPDATE vendors SET category = 'transport', category_source = 'claimed', status = 'claimed' WHERE id = ${v.id}`,
    );

    const r = await vendorCategoryResolver.resolve(testDb, bankCode, accountNumber);
    expect(r?.enforceable).toBe(true);
  });

  it('returns null rather than throwing when the lookup fails', async () => {
    const spy = vi.spyOn(vendorsRepo, 'findByAccount').mockRejectedValue(new Error('db down'));
    const r = await vendorCategoryResolver.resolve(
      testDb,
      factories.bankCode(),
      factories.bankAccount(),
    );
    expect(r).toBeNull();
    spy.mockRestore();
  });
});
