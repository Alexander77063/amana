import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { catalogItems, retailers } from '../../db/schema';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import type { CategoryRuleConfig, MerchantRuleConfig } from '../rules/types';
import { dealsService } from './deals.service';

type DbOrTx = PostgresJsDatabase;

export type BrowseItem = {
  id: string;
  name: string;
  section: string;
  category: string;
  description: string | null;
  photoUrl: string | null;
  durationMinutes: number | null;
  retailerId: string;
  retailerName: string;
  /** The list price. Shown struck through only when a deal is actually reducing it. */
  grossKobo: string;
  /** What the buyer will actually pay. This is the number to render as the price. */
  effectiveKobo: string;
  dealId: string | null;
};

/**
 * What a buyer may see.
 *
 * §8 is explicit that an agent "only ever sees what they're already allowed to buy", and that
 * offers are never proactively upsold to them. This is a guardrail, not a preference — so the
 * filter is derived from the **same active rule set the purchase path enforces**, rather than
 * from a second list that could drift out of agreement with it. If browse shows it, buying it
 * will not be refused for a reason browse could have known.
 *
 * Passing no sub-wallet gives the unfiltered marketplace — the principal's view, since a
 * principal's own spending is not bound by the rules they wrote for someone else.
 */
export const browseService = {
  async sections(db: DbOrTx, subWalletId: string | null): Promise<string[]> {
    const allowed = await allowedFilter(db, subWalletId);
    if (allowed.nothing) return [];

    const rows = await db
      .selectDistinct({ section: catalogItems.section, category: catalogItems.category })
      .from(catalogItems)
      .innerJoin(retailers, eq(retailers.id, catalogItems.retailerId))
      .where(and(eq(catalogItems.status, 'active'), eq(retailers.onboardingStatus, 'approved')));

    const names = new Set<string>();
    for (const r of rows) {
      if (allowed.category(r.category)) names.add(r.section);
    }
    return [...names].sort();
  },

  async items(
    db: DbOrTx,
    input: { subWalletId: string | null; section?: string | null; now?: Date },
  ): Promise<BrowseItem[]> {
    const allowed = await allowedFilter(db, input.subWalletId);
    if (allowed.nothing) return [];
    const now = input.now ?? new Date();

    const where = [eq(catalogItems.status, 'active'), eq(retailers.onboardingStatus, 'approved')];
    if (input.section) where.push(eq(catalogItems.section, input.section));
    if (allowed.retailerIds) {
      // An empty approved list means the principal has approved nobody; `inArray` with an empty
      // set would be invalid SQL, and `nothing` above has already returned for that case.
      where.push(inArray(catalogItems.retailerId, allowed.retailerIds));
    }

    const rows = await db
      .select({
        id: catalogItems.id,
        name: catalogItems.name,
        section: catalogItems.section,
        category: catalogItems.category,
        description: catalogItems.description,
        photoUrl: catalogItems.photoUrl,
        durationMinutes: catalogItems.durationMinutes,
        retailerId: catalogItems.retailerId,
        retailerName: retailers.businessName,
      })
      .from(catalogItems)
      .innerJoin(retailers, eq(retailers.id, catalogItems.retailerId))
      .where(and(...where))
      .orderBy(desc(catalogItems.createdAt));

    const visible = rows.filter((r) => allowed.category(r.category));

    // Price every row the way the purchase path will price it. Rendering the list price where a
    // deal applies would quote a buyer a number they will not be charged.
    return Promise.all(
      visible.map(async (r) => {
        const { grossKobo, discountedKobo, dealId } = await dealsService.effectivePriceKobo(
          db,
          r.id,
          now,
        );
        return {
          ...r,
          grossKobo: (grossKobo as bigint).toString(),
          effectiveKobo: (discountedKobo as bigint).toString(),
          dealId: dealId ?? null,
        };
      }),
    );
  },
};

/**
 * Turn the sub-wallet's active rules into a display filter.
 *
 * Reads only `category` and `merchant`: those are the rules that determine whether an item is
 * buyable *at all*. A limit or a time window can stop a particular purchase now and allow it an
 * hour later, so hiding items for those would make the catalogue flicker and would hide things
 * the agent legitimately may buy.
 */
async function allowedFilter(
  db: DbOrTx,
  subWalletId: string | null,
): Promise<{
  nothing: boolean;
  category: (c: string) => boolean;
  retailerIds: string[] | null;
}> {
  if (!subWalletId) return { nothing: false, category: () => true, retailerIds: null };

  const ruleSet = await fetchActiveRuleSet(db, subWalletId);
  if (!ruleSet) return { nothing: false, category: () => true, retailerIds: null };

  const categoryRule = ruleSet.rules.find((r) => r.kind === 'category');
  const merchantRule = ruleSet.rules.find((r) => r.kind === 'merchant');

  const cfg = categoryRule?.config as CategoryRuleConfig | undefined;
  const category = (c: string): boolean => {
    if (!cfg) return true;
    return cfg.mode === 'allowlist' ? cfg.categories.includes(c) : !cfg.categories.includes(c);
  };

  const retailerIds = merchantRule
    ? ((merchantRule.config as MerchantRuleConfig).retailerIds ?? [])
    : null;

  // A merchant rule with an empty list denies everything, so there is nothing to show. Answering
  // with an empty catalogue is the honest rendering of "your parent has approved no shops yet".
  return { nothing: retailerIds !== null && retailerIds.length === 0, category, retailerIds };
}
