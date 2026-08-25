import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { householdsRepo } from '../identity/households.repo';
import { vendorObservationsRepo } from './vendor-observations.repo';

type DbOrTx = PostgresJsDatabase;

export type RecordSettlementInput = {
  masterWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  category: string | null;
  now: Date;
};

export const vendorObservationService = {
  /**
   * Record one settled payment against the registry's observation table.
   *
   * **This function never throws.** It is called after a settlement has already committed, and a
   * registry fault must not turn a successful payment into an error anywhere upstream. A dropped
   * observation is statistically harmless; the promotion threshold is measured in households, and
   * a household that pays a vendor once will almost certainly pay it again.
   */
  async recordSettlement(db: DbOrTx, input: RecordSettlementInput): Promise<void> {
    try {
      const household = await householdsRepo.findByMasterWalletId(db, input.masterWalletId);
      if (!household) {
        logger.warn(
          { masterWalletId: input.masterWalletId },
          'vendor observation skipped: no household for master wallet',
        );
        return;
      }
      await vendorObservationsRepo.record(db, {
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        householdId: household.id,
        accountName: input.accountName,
        category: input.category,
        now: input.now,
      });
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'vendor observation write failed',
      );
    }
  },
};
