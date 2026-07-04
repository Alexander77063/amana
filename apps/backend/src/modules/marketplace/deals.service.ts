import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { type Kobo, kobo } from '../../lib/kobo';
import { catalogItemsRepo } from './catalog-items.repo';
import { type DealRow, dealsRepo } from './deals.repo';
import { retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

/** Basis-point denominator: 10000 bps = 100%. */
const BPS_DENOMINATOR = 10_000n;

export type CreateDealInput = {
  retailerId: string;
  /** Null / omitted = retailer-wide (applies to every item the retailer sells). */
  catalogItemId?: string | null;
  /** Exactly one of discountBps / discountKobo must be set. */
  discountBps?: number | null;
  discountKobo?: Kobo | null;
  startsAt: Date;
  endsAt: Date;
};

export type EffectivePrice = {
  grossKobo: Kobo;
  discountedKobo: Kobo;
  dealId: string | null;
};

/**
 * The markdown a single deal applies to `gross` (bigint kobo, floored, never rounded up):
 * a fixed `discountKobo`, or `floor(gross * discountBps / 10000)`.
 */
function dealDiscount(
  spec: { discountBps: number | null; discountKobo: bigint | null },
  gross: bigint,
): bigint {
  if (spec.discountKobo !== null) return spec.discountKobo;
  if (spec.discountBps !== null) return (gross * BigInt(spec.discountBps)) / BPS_DENOMINATOR;
  return 0n;
}

export const dealsService = {
  /**
   * Create a markdown deal for an **approved** retailer. Validates: exactly one discount form set
   * (→ ConflictError); retailer exists (→ NotFoundError) and approved (→ ForbiddenError); when
   * item-scoped, the item exists (→ NotFoundError) and belongs to the retailer (→ ConflictError);
   * `endsAt > startsAt` (→ ConflictError); and when item-scoped, the discount does not exceed the
   * item's gross price (→ ConflictError). No money moves.
   */
  async createDeal(db: DbOrTx, input: CreateDealInput): Promise<DealRow> {
    // Exactly-one discount form. Use explicit null checks — `discountBps: 0` / `discountKobo: 0n`
    // are falsy but count as "provided".
    const hasBps = input.discountBps != null;
    const hasKobo = input.discountKobo != null;
    if (hasBps === hasKobo) {
      throw new ConflictError('exactly one of discountBps / discountKobo must be set');
    }

    const retailer = await retailersRepo.findById(db, input.retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${input.retailerId} not found`);
    if (retailer.onboardingStatus !== 'approved') {
      throw new ForbiddenError(
        `retailer ${input.retailerId} is not approved (status=${retailer.onboardingStatus})`,
      );
    }

    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      throw new ConflictError('endsAt must be after startsAt');
    }

    const catalogItemId = input.catalogItemId ?? null;
    if (catalogItemId !== null) {
      const item = await catalogItemsRepo.findById(db, catalogItemId);
      if (!item) throw new NotFoundError(`catalog item ${catalogItemId} not found`);
      if (item.retailerId !== input.retailerId) {
        throw new ConflictError(
          `catalog item ${catalogItemId} does not belong to retailer ${input.retailerId}`,
        );
      }
      // Item-scoped: the markdown must not exceed the item's gross price.
      const discount = dealDiscount(
        {
          discountBps: input.discountBps ?? null,
          discountKobo: input.discountKobo ?? null,
        },
        item.priceKobo,
      );
      if (discount > (item.priceKobo as bigint)) {
        throw new ConflictError(
          `discount ${discount} exceeds item price ${item.priceKobo} for item ${catalogItemId}`,
        );
      }
    }

    return dealsRepo.insert(db, {
      retailerId: input.retailerId,
      catalogItemId,
      discountBps: input.discountBps ?? null,
      discountKobo: input.discountKobo ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
  },

  /**
   * The price a buyer would pay for `catalogItemId` at `now`: gross list price marked down by the
   * best active deal (the one yielding the largest discount). Each deal's discount is clamped to
   * gross before comparison, so the discounted price is never negative and never exceeds gross. No
   * active deal → discounted = gross, dealId null. SP5's purchase flow calls this to price a buy.
   */
  async effectivePriceKobo(db: DbOrTx, catalogItemId: string, now: Date): Promise<EffectivePrice> {
    const item = await catalogItemsRepo.findById(db, catalogItemId);
    if (!item) throw new NotFoundError(`catalog item ${catalogItemId} not found`);
    const gross = item.priceKobo as bigint;

    const active = await dealsRepo.findActiveForItem(db, catalogItemId, item.retailerId, now);

    let bestDiscount = 0n;
    let bestDealId: string | null = null;
    for (const deal of active) {
      const raw = dealDiscount(deal, gross);
      // Clamp per-deal to gross before comparing so "largest resulting discount" can never drive
      // the price below zero.
      const clamped = raw > gross ? gross : raw;
      if (clamped > bestDiscount) {
        bestDiscount = clamped;
        bestDealId = deal.id;
      }
    }

    return {
      grossKobo: kobo(gross),
      discountedKobo: kobo(gross - bestDiscount),
      dealId: bestDealId,
    };
  },
};
