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

  it('normalizes a mistyped code before the query, so lower case and I/L/O still hit', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'WINDOW SHOP',
      promotedHouseholdCount: 5,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    // Contains both a 1 and a 0, so the I/L -> 1 and O -> 0 folds are actually exercised.
    const stored = 'AMNV-10K2H-9PZ0R';
    const claimed = await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'food',
      publicCode: stored,
      now: NOW,
    });
    if (!claimed) throw new Error('claim failed');
    expect(claimed.publicCode).toBe(stored); // the stored form is the minted, upper-case one

    // Postgres `=` on text is case- and byte-sensitive, so the ONLY way any of these come back is
    // if the value was folded before it reached the query. That is the before-the-DB proof.
    for (const typed of [
      'amnv-10k2h-9pz0r', // read off a shop window, typed in lower case
      'AMNV-I0K2H-9PZ0R', // I mistaken for 1
      'AMNV-L0K2H-9PZ0R', // L mistaken for 1
      'AMNV-1OK2H-9PZOR', // O mistaken for 0, twice
      'amnv-ilo2h-9pz0r'.replace('ilo2h', 'i0k2h'), // lower case AND a glyph fold together
    ]) {
      const found = await vendorsRepo.findByPublicCode(testDb, typed);
      expect(found?.id).toBe(v.id);
    }

    // U is excluded from the alphabet with no digit to fold into, so it is simply not a code
    // character and must miss rather than being coerced into something that hits.
    expect(await vendorsRepo.findByPublicCode(testDb, 'AMNV-U0K2H-9PZ0R')).toBeUndefined();
    // And normalization must not turn a genuinely unknown code into a hit.
    expect(await vendorsRepo.findByPublicCode(testDb, 'amnv-zzzzz-zzzzz')).toBeUndefined();
  });
});
