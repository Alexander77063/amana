import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { catalogItems } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type CatalogItemStatus = 'active' | 'inactive';

export type CatalogItemRow = typeof catalogItems.$inferSelect;

export type NewCatalogItem = {
  retailerId: string;
  name: string;
  priceKobo: Kobo;
  section: string;
  /**
   * Spend category from the closed @amana/types vocabulary — what a parent's category lock is
   * compared against. Distinct from `section`, which is the retailer's own free-text
   * merchandising label. Omitted means 'other', which an allowlist denies.
   */
  category?: string;
  description?: string | null;
  photoUrl?: string | null;
  durationMinutes?: number | null;
  status?: CatalogItemStatus;
};

export const catalogItemsRepo = {
  async insert(db: DbOrTx, input: NewCatalogItem): Promise<CatalogItemRow> {
    const [row] = await db
      .insert(catalogItems)
      .values({
        retailerId: input.retailerId,
        name: input.name,
        priceKobo: input.priceKobo,
        section: input.section,
        ...(input.category !== undefined && { category: input.category }),
        description: input.description ?? null,
        photoUrl: input.photoUrl ?? null,
        durationMinutes: input.durationMinutes ?? null,
        ...(input.status !== undefined && { status: input.status }),
      })
      .returning();
    if (!row) throw new Error('catalogItems.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<CatalogItemRow | undefined> {
    const [row] = await db.select().from(catalogItems).where(eq(catalogItems.id, id)).limit(1);
    return row;
  },

  /** Every item belonging to a retailer (active + inactive), newest first — the retailer's own catalog view. */
  async listByRetailer(db: DbOrTx, retailerId: string): Promise<CatalogItemRow[]> {
    return db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.retailerId, retailerId))
      .orderBy(desc(catalogItems.createdAt));
  },

  /** Active items in a section across all retailers, newest first — the buyer-facing section browse (SP5). */
  /** Edit an item in place. Price is bigint kobo; the caller validates it is positive. */
  async update(
    db: DbOrTx,
    id: string,
    patch: {
      name?: string;
      priceKobo?: Kobo;
      section?: string;
      category?: string;
      description?: string | null;
      photoUrl?: string | null;
      durationMinutes?: number | null;
    },
  ): Promise<CatalogItemRow | undefined> {
    const [row] = await db
      .update(catalogItems)
      .set(patch)
      .where(eq(catalogItems.id, id))
      .returning();
    return row;
  },

  /**
   * Take an item off sale, or put it back.
   *
   * Deliberately a status flip rather than a delete: redemptions reference catalog items by FK,
   * and a sold voucher must still be able to name what was bought long after the retailer stops
   * offering it.
   */
  async setStatus(
    db: DbOrTx,
    id: string,
    status: 'active' | 'inactive',
  ): Promise<CatalogItemRow | undefined> {
    const [row] = await db
      .update(catalogItems)
      .set({ status })
      .where(eq(catalogItems.id, id))
      .returning();
    return row;
  },

  async listBySection(db: DbOrTx, section: string): Promise<CatalogItemRow[]> {
    return db
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.section, section), eq(catalogItems.status, 'active')))
      .orderBy(desc(catalogItems.createdAt));
  },
};
