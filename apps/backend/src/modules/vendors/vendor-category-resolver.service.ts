import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { type VendorCategorySource, vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type ResolvedVendorCategory = {
  vendorId: string;
  category: string | null;
  categorySource: VendorCategorySource;
  /**
   * Whether this category may DRIVE a rule outcome, as opposed to merely being recorded.
   *
   * False for an observed category however strong its consensus: inference is good enough to
   * measure with and not good enough to deny a purchase with. Only the business asserting its own
   * nature (a claim) or an operator setting it may ever be enforced.
   */
  enforceable: boolean;
};

export const vendorCategoryResolver = {
  /**
   * Look up what the registry knows about a vendor bank account.
   *
   * **Never throws, and returns null on any failure.** This runs inside the spend path, and a
   * registry outage must not be able to block a payment — the caller falls back to the
   * app-supplied category exactly as it behaved before the registry existed.
   */
  async resolve(
    db: DbOrTx,
    bankCode: string | null,
    accountNumber: string | null,
  ): Promise<ResolvedVendorCategory | null> {
    if (!bankCode || !accountNumber) return null;
    try {
      const vendor = await vendorsRepo.findByAccount(db, bankCode, accountNumber);
      if (!vendor) return null;
      return {
        vendorId: vendor.id,
        category: vendor.category,
        categorySource: vendor.categorySource,
        enforceable: vendor.categorySource !== 'observed',
      };
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'vendor category resolution failed',
      );
      return null;
    }
  },
};
