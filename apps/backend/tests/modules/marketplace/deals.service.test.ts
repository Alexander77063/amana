import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { catalogItemsRepo } from '../../../src/modules/marketplace/catalog-items.repo';
import { dealsService } from '../../../src/modules/marketplace/deals.service';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(truncateAll);

const NOW = new Date('2026-07-04T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const past = (ms: number) => new Date(NOW.getTime() - ms);
const future = (ms: number) => new Date(NOW.getTime() + ms);

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

async function seedItem(retailerId: string, priceKobo = 200_000n, name = 'Item') {
  const row = await catalogItemsRepo.insert(testDb, {
    retailerId,
    name,
    priceKobo: kobo(priceKobo),
    section: 'Food',
  });
  return row.id;
}

describe('dealsService.createDeal', () => {
  it('creates an item-scoped bps deal', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId);
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountBps: 1000,
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    expect(deal.id).toBeTruthy();
    expect(deal.catalogItemId).toBe(itemId);
    expect(deal.discountBps).toBe(1000);
    expect(deal.discountKobo).toBeNull();
    expect(deal.type).toBe('markdown');
    expect(deal.status).toBe('active');
  });

  it('creates a retailer-wide fixed-kobo deal (catalogItemId omitted)', async () => {
    const retailerId = await seedRetailer();
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      discountKobo: kobo(5_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    expect(deal.catalogItemId).toBeNull();
    expect(deal.discountKobo).toBe(5_000n);
    expect(deal.discountBps).toBeNull();
  });

  it('rejects when neither discount form is set', async () => {
    const retailerId = await seedRetailer();
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects when both discount forms are set', async () => {
    const retailerId = await seedRetailer();
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        discountBps: 1000,
        discountKobo: kobo(5_000n),
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('treats discountBps: 0 as "set" (rejects it alongside a discountKobo as both-set)', async () => {
    const retailerId = await seedRetailer();
    // Regression guard: 0 is falsy but must count as a provided value.
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        discountBps: 0,
        discountKobo: kobo(5_000n),
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects an unknown retailer with NotFoundError', async () => {
    await expect(
      dealsService.createDeal(testDb, {
        retailerId: factories.userId(),
        discountBps: 1000,
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-approved retailer with ForbiddenError', async () => {
    const retailerId = await seedRetailer('Pending', 'kyb_pending');
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        discountBps: 1000,
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects an unknown catalog item with NotFoundError', async () => {
    const retailerId = await seedRetailer();
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        catalogItemId: factories.userId(),
        discountBps: 1000,
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an item that belongs to a different retailer with ConflictError', async () => {
    const retailerId = await seedRetailer('R1');
    const otherRetailerId = await seedRetailer('R2');
    const otherItemId = await seedItem(otherRetailerId);
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        catalogItemId: otherItemId,
        discountBps: 1000,
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects endsAt <= startsAt with ConflictError', async () => {
    const retailerId = await seedRetailer();
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        discountBps: 1000,
        startsAt: future(DAY),
        endsAt: past(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        discountBps: 1000,
        startsAt: NOW,
        endsAt: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a fixed discount exceeding the item price with ConflictError', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 10_000n);
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountKobo: kobo(10_001n),
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows a fixed discount equal to the item price', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 10_000n);
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountKobo: kobo(10_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    expect(deal.discountKobo).toBe(10_000n);
  });

  it('rejects a bps discount exceeding 100% (>10000 bps) on an item with ConflictError', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 10_000n);
    await expect(
      dealsService.createDeal(testDb, {
        retailerId,
        catalogItemId: itemId,
        discountBps: 10_001,
        startsAt: past(DAY),
        endsAt: future(DAY),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('dealsService.effectivePriceKobo', () => {
  it('no active deal → discounted = gross, dealId null', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 200_000n);
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.grossKobo).toBe(200_000n);
    expect(priced.discountedKobo).toBe(200_000n);
    expect(priced.dealId).toBeNull();
  });

  it('applies a bps markdown (floored)', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 12_345n);
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountBps: 1000, // 10% → floor(12345 * 1000 / 10000) = floor(1234.5) = 1234
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.grossKobo).toBe(12_345n);
    expect(priced.discountedKobo).toBe(12_345n - 1_234n);
    expect(priced.dealId).toBe(deal.id);
  });

  it('applies a fixed-kobo markdown', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 20_000n);
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountKobo: kobo(5_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(15_000n);
    expect(priced.dealId).toBe(deal.id);
  });

  it('ignores an expired deal (endsAt in the past)', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 20_000n);
    await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountKobo: kobo(5_000n),
      startsAt: past(2 * DAY),
      endsAt: past(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(20_000n);
    expect(priced.dealId).toBeNull();
  });

  it('ignores a paused deal', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 20_000n);
    // createDeal always inserts active; pause it directly via the repo path is not exposed,
    // so create it active then rely on findActiveForItem's status filter by inserting paused
    // through the repo. Use the repo to seed a paused deal.
    const { dealsRepo } = await import('../../../src/modules/marketplace/deals.repo');
    await dealsRepo.insert(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountKobo: kobo(5_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
      status: 'paused',
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(20_000n);
    expect(priced.dealId).toBeNull();
  });

  it('ignores an out-of-window (not-yet-started) deal', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 20_000n);
    await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountKobo: kobo(5_000n),
      startsAt: future(DAY),
      endsAt: future(2 * DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(20_000n);
    expect(priced.dealId).toBeNull();
  });

  it('applies a retailer-wide (catalogItemId null) deal', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 20_000n);
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      discountBps: 2500, // 25% → 5000 off
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(15_000n);
    expect(priced.dealId).toBe(deal.id);
  });

  it('picks the best of multiple active deals (largest resulting discount)', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 20_000n);
    // Item-specific 10% → 2000 off.
    await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountBps: 1000,
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    // Retailer-wide fixed 7000 off → the winner.
    const best = await dealsService.createDeal(testDb, {
      retailerId,
      discountKobo: kobo(7_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(13_000n);
    expect(priced.dealId).toBe(best.id);
  });

  it('never makes the price negative: discount clamps at gross', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 10_000n);
    // A retailer-wide fixed discount larger than this item's price (allowed: not item-scoped).
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      discountKobo: kobo(50_000n),
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(0n);
    expect(priced.dealId).toBe(deal.id);
  });

  it('never exceeds gross for a full 100% bps deal', async () => {
    const retailerId = await seedRetailer();
    const itemId = await seedItem(retailerId, 10_000n);
    const deal = await dealsService.createDeal(testDb, {
      retailerId,
      catalogItemId: itemId,
      discountBps: 10_000, // 100%
      startsAt: past(DAY),
      endsAt: future(DAY),
    });
    const priced = await dealsService.effectivePriceKobo(testDb, itemId, NOW);
    expect(priced.discountedKobo).toBe(0n);
    expect(priced.dealId).toBe(deal.id);
  });

  it('throws NotFoundError for an unknown item', async () => {
    await expect(
      dealsService.effectivePriceKobo(testDb, factories.userId(), NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
