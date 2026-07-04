import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deals } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type DealType = 'markdown';

export type DealStatus = 'active' | 'paused' | 'ended';

export type DealRow = typeof deals.$inferSelect;

export type NewDeal = {
  retailerId: string;
  /** Null = retailer-wide (applies to every item the retailer sells). */
  catalogItemId?: string | null;
  type?: DealType;
  discountBps?: number | null;
  discountKobo?: Kobo | null;
  startsAt: Date;
  endsAt: Date;
  status?: DealStatus;
};

export const dealsRepo = {
  async insert(db: DbOrTx, input: NewDeal): Promise<DealRow> {
    const [row] = await db
      .insert(deals)
      .values({
        retailerId: input.retailerId,
        catalogItemId: input.catalogItemId ?? null,
        ...(input.type !== undefined && { type: input.type }),
        discountBps: input.discountBps ?? null,
        discountKobo: input.discountKobo ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...(input.status !== undefined && { status: input.status }),
      })
      .returning();
    if (!row) throw new Error('deals.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<DealRow | undefined> {
    const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
    return row;
  },

  /**
   * Active deals for the given retailer whose window covers `now` and which apply to `catalogItemId`
   * — either item-specific (`catalog_item_id = catalogItemId`) or retailer-wide (`catalog_item_id`
   * IS NULL). Retailer-scoped, so another retailer's retailer-wide deals never leak in. Newest first.
   * Best-deal selection is the pricing service's job (SP2 Task 4), not this repo.
   */
  async findActiveForItem(
    db: DbOrTx,
    catalogItemId: string,
    retailerId: string,
    now: Date,
  ): Promise<DealRow[]> {
    return db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.retailerId, retailerId),
          eq(deals.status, 'active'),
          lte(deals.startsAt, now),
          gte(deals.endsAt, now),
          or(eq(deals.catalogItemId, catalogItemId), isNull(deals.catalogItemId)),
        ),
      )
      .orderBy(desc(deals.createdAt));
  },
};
