import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { retailers } from '../../src/db/schema';
import { kobo } from '../../src/lib/kobo';
import { catalogItemsRepo } from '../../src/modules/marketplace/catalog-items.repo';
import type { CatalogItemRow } from '../../src/modules/marketplace/catalog-items.repo';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import type { RetailerRow } from '../../src/modules/marketplace/retailers.repo';
import { factories } from './factories';

/**
 * A real approved retailer + one active catalog item.
 *
 * `redemptions.{retailer_id,catalog_item_id,deal_id}` are real uuid FKs (SP4), so a test that
 * inserts a redemption directly — bypassing `purchaseService`, which resolves these from the
 * catalog — must reference rows that actually exist. Literal ids like 'retailer-1' no longer
 * insert.
 */
export async function seedRetailerAndItem(
  db: PostgresJsDatabase,
  opts: { businessName?: string; priceKobo?: bigint } = {},
): Promise<{ retailer: RetailerRow; item: CatalogItemRow }> {
  const retailer = await retailersRepo.insert(db, {
    businessName: opts.businessName ?? 'Test Retailer',
    payoutBankCode: factories.bankCode(),
    payoutAccountNumber: factories.bankAccount(),
    onboardingStatus: 'approved',
  });
  const item = await catalogItemsRepo.insert(db, {
    retailerId: retailer.id,
    name: 'Test Item',
    priceKobo: kobo(opts.priceKobo ?? 100_000n),
    section: 'general',
  });
  return { retailer, item };
}

const SHARED_RETAILER_NAME = 'Shared Test Retailer';

/**
 * The shared retailer + item, seeding them if they are not there.
 *
 * Idempotent by design: several suites call `truncateAll()` more than once per file (including
 * inside `fast-check` property loops), which wipes anything cached in a module-level variable.
 * Resolving at insert time keeps those suites correct without threading ids through helpers.
 */
export async function ensureRetailerAndItem(
  db: PostgresJsDatabase,
): Promise<{ retailer: RetailerRow; item: CatalogItemRow }> {
  const [existing] = await db
    .select()
    .from(retailers)
    .where(eq(retailers.businessName, SHARED_RETAILER_NAME))
    .limit(1);
  if (existing) {
    const [item] = await catalogItemsRepo.listByRetailer(db, existing.id);
    if (item) return { retailer: existing, item };
  }
  return seedRetailerAndItem(db, { businessName: SHARED_RETAILER_NAME });
}
