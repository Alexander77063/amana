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
  async listBySection(db: DbOrTx, section: string): Promise<CatalogItemRow[]> {
    return db
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.section, section), eq(catalogItems.status, 'active')))
      .orderBy(desc(catalogItems.createdAt));
  },
};
