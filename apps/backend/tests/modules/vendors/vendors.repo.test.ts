import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('promotes an account once and reports the second attempt as a no-op', async () => {
    const input = {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 5,
      now: NOW,
    };

    const first = await vendorsRepo.promoteIfAbsent(testDb, input);
    expect(first?.status).toBe('observed');
    expect(first?.promotedHouseholdCount).toBe(5);

    const second = await vendorsRepo.promoteIfAbsent(testDb, {
      ...input,
      promotedHouseholdCount: 9,
    });
    expect(second).toBeNull();

    const found = await vendorsRepo.findByAccount(testDb, input.bankCode, input.accountNumber);
    expect(found?.promotedHouseholdCount).toBe(5); // the first promotion stands
  });

  it('sets an observed category with its supporting household count', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOP',
      promotedHouseholdCount: 8,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    expect(await vendorsRepo.setObservedCategory(testDb, v.id, 'food', 9)).toBe(true);
    const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(after?.category).toBe('food');
    expect(after?.categoryHouseholdCount).toBe(9);
    expect(after?.categorySource).toBe('observed');
  });

  it('refuses to overwrite a claimed category', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOP',
      promotedHouseholdCount: 8,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    // Simulate SP-V2 having claimed this vendor.
    await testDb.execute(
      sql`UPDATE vendors SET category = 'pharmacy', category_source = 'claimed' WHERE id = ${v.id}`,
    );

    expect(await vendorsRepo.setObservedCategory(testDb, v.id, 'food', 20)).toBe(false);
    const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(after?.category).toBe('pharmacy');
    expect(after?.categorySource).toBe('claimed');
  });

  it('lists only vendors whose category source matches', async () => {
    const a = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'A',
      promotedHouseholdCount: 5,
      now: NOW,
    });
    if (!a) throw new Error('promotion failed');
    const b = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'B',
      promotedHouseholdCount: 5,
      now: NOW,
    });
    if (!b) throw new Error('promotion failed');
    await testDb.execute(sql`UPDATE vendors SET category_source = 'claimed' WHERE id = ${b.id}`);

    const observed = await vendorsRepo.listByCategorySource(testDb, 'observed');
    expect(observed.map((v) => v.id)).toEqual([a.id]);
  });

  it('finds a claimed vendor by its public code', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'CODED SHOP',
      promotedHouseholdCount: 5,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const claimed = await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'food',
      publicCode: 'AMNV-1AB2C-3DE4F',
      now: NOW,
    });
    if (!claimed) throw new Error('claim failed');

    const found = await vendorsRepo.findByPublicCode(testDb, 'AMNV-1AB2C-3DE4F');
    expect(found?.id).toBe(v.id);
    expect(await vendorsRepo.findByPublicCode(testDb, 'AMNV-ZZZZZ-ZZZZZ')).toBeUndefined();
  });

  it('refuses a null, undefined or blank code before it ever reaches the database', async () => {
    // public_code is nullable AND unique, so Postgres permits any number of NULL rows. An
    // unguarded lookup carrying NULL matches nothing and LOOKS correct — the dangerous kind of
    // safe. This observed vendor is exactly such a row: it must never come back.
    const observed = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'UNCLAIMED SHOP',
      promotedHouseholdCount: 5,
      now: NOW,
    });
    if (!observed) throw new Error('promotion failed');
    expect(observed.publicCode).toBeNull();

    const select = vi.spyOn(testDb, 'select');
    for (const bad of [null, undefined, '', '   ']) {
      expect(await vendorsRepo.findByPublicCode(testDb, bad as unknown as string)).toBeUndefined();
    }
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });
});
