import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { catalogService } from '../../../src/modules/marketplace/catalog.service';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(truncateAll);

async function seedRetailer(
  name = 'Retailer',
  onboardingStatus: 'applied' | 'kyb_pending' | 'approved' | 'suspended' = 'approved',
) {
  const row = await retailersRepo.insert(testDb, {
    businessName: name,
    payoutBankCode: factories.bankCode(),
    payoutAccountNumber: factories.bankAccount(),
    onboardingStatus,
  });
  return row.id;
}

describe('catalogService.createItem', () => {
  it('creates an active item for an approved retailer', async () => {
    const retailerId = await seedRetailer();
    const item = await catalogService.createItem(testDb, {
      retailerId,
      name: 'Jollof Rice',
      priceKobo: kobo(150_000n),
      section: 'Food',
      description: 'Smoky party jollof',
      photoUrl: 'https://example.com/jollof.jpg',
      durationMinutes: 15,
    });
    expect(item.id).toBeTruthy();
    expect(item.retailerId).toBe(retailerId);
    expect(item.priceKobo).toBe(150_000n);
    expect(item.section).toBe('Food');
    expect(item.status).toBe('active');
    expect(item.description).toBe('Smoky party jollof');
    expect(item.photoUrl).toBe('https://example.com/jollof.jpg');
    expect(item.durationMinutes).toBe(15);
  });

  it('defaults nullable optional fields to null', async () => {
    const retailerId = await seedRetailer();
    const item = await catalogService.createItem(testDb, {
      retailerId,
      name: 'Water',
      priceKobo: kobo(20_000n),
      section: 'Drinks',
    });
    expect(item.description).toBeNull();
    expect(item.photoUrl).toBeNull();
    expect(item.durationMinutes).toBeNull();
  });

  it('rejects an unknown retailer with NotFoundError', async () => {
    await expect(
      catalogService.createItem(testDb, {
        retailerId: factories.userId(),
        name: 'Ghost',
        priceKobo: kobo(1_000n),
        section: 'Food',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-approved retailer with ForbiddenError', async () => {
    const retailerId = await seedRetailer('Pending Co', 'kyb_pending');
    await expect(
      catalogService.createItem(testDb, {
        retailerId,
        name: 'Too early',
        priceKobo: kobo(1_000n),
        section: 'Food',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a suspended retailer with ForbiddenError', async () => {
    const retailerId = await seedRetailer('Suspended Co', 'suspended');
    await expect(
      catalogService.createItem(testDb, {
        retailerId,
        name: 'Blocked',
        priceKobo: kobo(1_000n),
        section: 'Food',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a zero price with ConflictError', async () => {
    const retailerId = await seedRetailer();
    await expect(
      catalogService.createItem(testDb, {
        retailerId,
        name: 'Free lunch',
        priceKobo: kobo(0n),
        section: 'Food',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a negative price with ConflictError', async () => {
    const retailerId = await seedRetailer();
    await expect(
      catalogService.createItem(testDb, {
        retailerId,
        name: 'Impossible',
        priceKobo: kobo(-1n),
        section: 'Food',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  describe('listBySection / listByRetailer', () => {
    it('listBySection returns only active items in the section, across retailers', async () => {
      const r1 = await seedRetailer('R1');
      const r2 = await seedRetailer('R2');
      const a = await catalogService.createItem(testDb, {
        retailerId: r1,
        name: 'Food1',
        priceKobo: kobo(1_000n),
        section: 'Food',
      });
      const b = await catalogService.createItem(testDb, {
        retailerId: r2,
        name: 'Food2',
        priceKobo: kobo(2_000n),
        section: 'Food',
      });
      // Different section — excluded.
      await catalogService.createItem(testDb, {
        retailerId: r1,
        name: 'Drink',
        priceKobo: kobo(3_000n),
        section: 'Drinks',
      });
      const list = await catalogService.listBySection(testDb, 'Food');
      expect(new Set(list.map((i) => i.id))).toEqual(new Set([a.id, b.id]));
    });

    it('listByRetailer returns the retailer own items, scoped to that retailer', async () => {
      const r1 = await seedRetailer('R1');
      const r2 = await seedRetailer('R2');
      const a = await catalogService.createItem(testDb, {
        retailerId: r1,
        name: 'A',
        priceKobo: kobo(1_000n),
        section: 'Food',
      });
      await catalogService.createItem(testDb, {
        retailerId: r2,
        name: 'Other',
        priceKobo: kobo(2_000n),
        section: 'Food',
      });
      const list = await catalogService.listByRetailer(testDb, r1);
      expect(list.map((i) => i.id)).toEqual([a.id]);
    });
  });
});
