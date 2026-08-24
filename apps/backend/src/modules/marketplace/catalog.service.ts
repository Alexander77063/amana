import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import type { Kobo } from '../../lib/kobo';
import { type CatalogItemRow, catalogItemsRepo } from './catalog-items.repo';
import { retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

export type CreateCatalogItemInput = {
  retailerId: string;
  name: string;
  /** Gross list price in bigint kobo — must be strictly positive. */
  priceKobo: Kobo;
  section: string;
  /** Spend category from the closed @amana/types vocabulary — what a parent's lock matches. */
  category?: string;
  description?: string | null;
  photoUrl?: string | null;
  durationMinutes?: number | null;
};

export const catalogService = {
  /**
   * Create a catalog item for an **approved** retailer. The retailer must exist (→ NotFoundError)
   * and be live-approved (→ ForbiddenError for applied/kyb_pending/suspended); the gross price must
   * be strictly positive (→ ConflictError). No money moves — this is pure catalog data.
   */
  async createItem(db: DbOrTx, input: CreateCatalogItemInput): Promise<CatalogItemRow> {
    const retailer = await retailersRepo.findById(db, input.retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${input.retailerId} not found`);
    if (retailer.onboardingStatus !== 'approved') {
      throw new ForbiddenError(
        `retailer ${input.retailerId} is not approved (status=${retailer.onboardingStatus})`,
      );
    }
    if (!((input.priceKobo as bigint) > 0n)) {
      throw new ConflictError(`priceKobo must be > 0 (got ${input.priceKobo})`);
    }

    return catalogItemsRepo.insert(db, {
      retailerId: input.retailerId,
      name: input.name,
      priceKobo: input.priceKobo,
      section: input.section,
      ...(input.category !== undefined && { category: input.category }),
      description: input.description ?? null,
      photoUrl: input.photoUrl ?? null,
      durationMinutes: input.durationMinutes ?? null,
    });
  },

  /** Active items in a section across all retailers — the buyer-facing section browse (SP5). */
  async listBySection(db: DbOrTx, section: string): Promise<CatalogItemRow[]> {
    return catalogItemsRepo.listBySection(db, section);
  },

  /** Every item belonging to a retailer (active + inactive) — the retailer's own catalog view. */
  async listByRetailer(db: DbOrTx, retailerId: string): Promise<CatalogItemRow[]> {
    return catalogItemsRepo.listByRetailer(db, retailerId);
  },
};
