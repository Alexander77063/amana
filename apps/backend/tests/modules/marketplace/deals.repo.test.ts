import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { catalogItemsRepo } from '../../../src/modules/marketplace/catalog-items.repo';
import { dealsRepo } from '../../../src/modules/marketplace/deals.repo';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(truncateAll);

const NOW = new Date('2026-07-04T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const past = (ms: number) => new Date(NOW.getTime() - ms);
const future = (ms: number) => new Date(NOW.getTime() + ms);

async function seedRetailer(name = 'Retailer') {
  const row = await retailersRepo.insert(testDb, {
    businessName: name,
    payoutBankCode: factories.bankCode(),
    payoutAccountNumber: factories.bankAccount(),
  });
  return row.id;
}

async function seedItem(retailerId: string, name = 'Item') {
  const row = await catalogItemsRepo.insert(testDb, {
    retailerId,
    name,
    priceKobo: kobo(200_000n),
    section: 'Food',
  });
  return row.id;
}

describe('dealsRepo', () => {
  it('insert returns the row with defaults (markdown, active) and nullable fields null', async () => {
    const retailerId = await seedRetailer();
    const row = await dealsRepo.insert(testDb, {
      retailerId,
      discountBps: 1000,
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    expect(row.id).toBeTruthy();
    expect(row.type).toBe('markdown');
    expect(row.status).toBe('active');
    expect(row.catalogItemId).toBeNull();
    expect(row.discountBps).toBe(1000);
    expect(row.discountKobo).toBeNull();
  });

  it('insert honours catalogItemId, discountKobo, and explicit status', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId);
    const row = await dealsRepo.insert(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountKobo: kobo(5_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
      status: 'paused',
    });
    expect(row.catalogItemId).toBe(itemId);
    expect(row.discountKobo).toBe(5_000n);
    expect(row.status).toBe('paused');
  });

  it('findById returns the row, or undefined for unknown id', async () => {
    const retailerId = await seedRetailer();
    const row = await dealsRepo.insert(testDb, {
      retailerId,
      discountBps: 500,
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    expect((await dealsRepo.findById(testDb, row.id))?.id).toBe(row.id);
    expect(await dealsRepo.findById(testDb, factories.userId())).toBeUndefined();
  });

  describe('findActiveForItem', () => {
    it('includes item-specific + retailer-wide deals; excludes everything else', async () => {
      const retailerId = await seedRetailer('R1');
      const otherRetailerId = await seedRetailer('R2');
      const itemId = await seedItem(retailerId, 'Target');
      const otherItemId = await seedItem(retailerId, 'Other');

      // Included: item-specific, in-window, active.
      const itemDeal = await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountBps: 1000,
        startsAt: past(DAY),
        endsAt: future(DAY),
      });
      // Included: retailer-wide (null item), in-window, active.
      const wideDeal = await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: null,
        discountKobo: kobo(2_000n),
        startsAt: past(DAY),
        endsAt: future(DAY),
      });

      // Excluded: targets a different item.
      await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: otherItemId,
        discountBps: 500,
        startsAt: past(DAY),
        endsAt: future(DAY),
      });
      // Excluded: expired (endsAt in the past).
      await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountBps: 500,
        startsAt: past(2 * DAY),
        endsAt: past(DAY),
      });
      // Excluded: not yet started (startsAt in the future).
      await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountBps: 500,
        startsAt: future(DAY),
        endsAt: future(2 * DAY),
      });
      // Excluded: paused.
      await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountBps: 500,
        startsAt: past(DAY),
        endsAt: future(DAY),
        status: 'paused',
      });
      // Excluded: ended.
      await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: null,
        discountBps: 500,
        startsAt: past(DAY),
        endsAt: future(DAY),
        status: 'ended',
      });
      // Excluded: retailer-wide but for a DIFFERENT retailer.
      await dealsRepo.insert(testDb, {
        retailerId: otherRetailerId,
        catalogItemId: null,
        discountBps: 500,
        startsAt: past(DAY),
        endsAt: future(DAY),
      });

      const found = await dealsRepo.findActiveForItem(testDb, itemId, retailerId, NOW);
      expect(new Set(found.map((d) => d.id))).toEqual(new Set([itemDeal.id, wideDeal.id]));
    });

    it('returns empty when no deal covers the moment', async () => {
      const retailerId = await seedRetailer();
      const itemId = await seedItem(retailerId);
      await dealsRepo.insert(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountBps: 1000,
        startsAt: past(2 * DAY),
        endsAt: past(DAY),
      });
      const found = await dealsRepo.findActiveForItem(testDb, itemId, retailerId, NOW);
      expect(found).toEqual([]);
    });
  });
});
