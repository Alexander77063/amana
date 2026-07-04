import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { catalogItemsRepo } from '../../../src/modules/marketplace/catalog-items.repo';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(truncateAll);

async function seedRetailer(name = 'Retailer') {
  const row = await retailersRepo.insert(testDb, {
    businessName: name,
    payoutBankCode: factories.bankCode(),
    payoutAccountNumber: factories.bankAccount(),
  });
  return row.id;
}

describe('catalogItemsRepo', () => {
  it('insert returns the row with defaults (active) and nullable fields null', async () => {
    const retailerId = await seedRetailer();
    const row = await catalogItemsRepo.insert(testDb, {
      retailerId,
      name: 'Jollof Rice',
      priceKobo: kobo(150_000n),
      section: 'Food',
    });
    expect(row.id).toBeTruthy();
    expect(row.retailerId).toBe(retailerId);
    expect(row.priceKobo).toBe(150_000n);
    expect(row.status).toBe('active');
    expect(row.description).toBeNull();
    expect(row.photoUrl).toBeNull();
    expect(row.durationMinutes).toBeNull();
  });

  it('insert honours optional fields + explicit status', async () => {
    const retailerId = await seedRetailer();
    const row = await catalogItemsRepo.insert(testDb, {
      retailerId,
      name: 'Haircut',
      priceKobo: kobo(300_000n),
      section: 'Grooming',
      description: 'A fresh cut',
      photoUrl: 'https://example.com/cut.jpg',
      durationMinutes: 30,
      status: 'inactive',
    });
    expect(row.description).toBe('A fresh cut');
    expect(row.photoUrl).toBe('https://example.com/cut.jpg');
    expect(row.durationMinutes).toBe(30);
    expect(row.status).toBe('inactive');
  });

  it('findById returns the row, or undefined for unknown id', async () => {
    const retailerId = await seedRetailer();
    const row = await catalogItemsRepo.insert(testDb, {
      retailerId,
      name: 'Item',
      priceKobo: kobo(1_000n),
      section: 'Food',
    });
    expect((await catalogItemsRepo.findById(testDb, row.id))?.id).toBe(row.id);
    expect(await catalogItemsRepo.findById(testDb, factories.userId())).toBeUndefined();
  });

  it('listByRetailer returns all of a retailer items (incl inactive), scoped to that retailer', async () => {
    const r1 = await seedRetailer('R1');
    const r2 = await seedRetailer('R2');
    const a = await catalogItemsRepo.insert(testDb, {
      retailerId: r1,
      name: 'A',
      priceKobo: kobo(1_000n),
      section: 'Food',
    });
    const b = await catalogItemsRepo.insert(testDb, {
      retailerId: r1,
      name: 'B',
      priceKobo: kobo(2_000n),
      section: 'Drinks',
      status: 'inactive',
    });
    await catalogItemsRepo.insert(testDb, {
      retailerId: r2,
      name: 'Other',
      priceKobo: kobo(3_000n),
      section: 'Food',
    });

    const list = await catalogItemsRepo.listByRetailer(testDb, r1);
    expect(new Set(list.map((i) => i.id))).toEqual(new Set([a.id, b.id]));
  });

  it('listBySection returns only active items in that section, across retailers', async () => {
    const r1 = await seedRetailer('R1');
    const r2 = await seedRetailer('R2');
    const food1 = await catalogItemsRepo.insert(testDb, {
      retailerId: r1,
      name: 'Food1',
      priceKobo: kobo(1_000n),
      section: 'Food',
    });
    const food2 = await catalogItemsRepo.insert(testDb, {
      retailerId: r2,
      name: 'Food2',
      priceKobo: kobo(2_000n),
      section: 'Food',
    });
    // Inactive in same section — excluded.
    await catalogItemsRepo.insert(testDb, {
      retailerId: r1,
      name: 'FoodOff',
      priceKobo: kobo(3_000n),
      section: 'Food',
      status: 'inactive',
    });
    // Active but different section — excluded.
    await catalogItemsRepo.insert(testDb, {
      retailerId: r1,
      name: 'Drink',
      priceKobo: kobo(4_000n),
      section: 'Drinks',
    });

    const list = await catalogItemsRepo.listBySection(testDb, 'Food');
    expect(new Set(list.map((i) => i.id))).toEqual(new Set([food1.id, food2.id]));
  });
});
