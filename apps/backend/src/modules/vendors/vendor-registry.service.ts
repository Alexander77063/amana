import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { computeConsensus } from './consensus';
import { vendorObservationsRepo } from './vendor-observations.repo';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type SweepConfig = {
  minHouseholds: number;
  consensusMinHouseholds: number;
  consensusRatio: number;
  sensitiveCategories: readonly string[];
  retentionDays: number;
};

export type SweepResult = {
  promoted: number;
  categorised: number;
  pruned: number;
};

const MS_PER_DAY = 86_400_000;

export const vendorRegistryService = {
  /**
   * Promote, categorise, prune — in that order, and deliberately not in one transaction.
   *
   * Each phase is independently idempotent, so a crash between phases costs at most one hour: the
   * next sweep re-derives everything from the observation table. Wrapping the whole thing in a
   * transaction would instead hold locks across what can be a large scan, for no correctness gain.
   *
   * Promotion always precedes categorisation, and because the consensus floor sits ABOVE the
   * promotion floor, a vendor is never promoted and categorised in the same sweep. That is
   * intended: being listed is a weaker claim than being categorised.
   */
  async sweep(db: DbOrTx, now: Date, cfg: SweepConfig): Promise<SweepResult> {
    let promoted = 0;
    let categorised = 0;

    // Phase 1 — promotion.
    const candidates = await vendorObservationsRepo.accountsAtOrAboveThreshold(
      db,
      cfg.minHouseholds,
    );
    for (const c of candidates) {
      const row = await vendorsRepo.promoteIfAbsent(db, {
        bankCode: c.bankCode,
        accountNumber: c.accountNumber,
        displayName: c.accountName,
        promotedHouseholdCount: c.householdCount,
        now,
      });
      if (row) promoted++;
    }

    // Phase 2 — categorisation. Only vendors whose category is still observation-derived; a
    // claimed or ops-set category is authoritative and must never be recomputed.
    const observedVendors = await vendorsRepo.listByCategorySource(db, 'observed');
    for (const v of observedVendors) {
      const rows = await vendorObservationsRepo.listForAccount(db, v.bankCode, v.accountNumber);
      const result = computeConsensus(
        rows.map((r) => r.categoryCounts),
        {
          minHouseholds: cfg.consensusMinHouseholds,
          ratio: cfg.consensusRatio,
          sensitiveCategories: cfg.sensitiveCategories,
        },
      );
      // Skip the write when nothing would change — keeps `categorised` an honest count of actual
      // changes rather than of rows examined.
      if (result.category === v.category) continue;
      const changed = await vendorsRepo.setObservedCategory(
        db,
        v.id,
        result.category,
        result.category === null ? null : result.householdCount,
      );
      if (changed) categorised++;
    }

    // Phase 3 — retention. Accounts that never looked like merchants are forgotten.
    const cutoff = new Date(now.getTime() - cfg.retentionDays * MS_PER_DAY);
    const pruned = await vendorObservationsRepo.pruneStaleUnpromoted(db, cutoff);

    logger.info({ promoted, categorised, pruned }, 'vendor registry sweep complete');
    return { promoted, categorised, pruned };
  },
};
