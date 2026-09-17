import { and, eq, inArray, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { logger } from '../../lib/logger';
import { postingsRepo } from '../wallet/postings.repo';
import {
  TRANSFER_BACKED_KINDS,
  applyTransferCompleted,
  applyTransferFailed,
} from './transfer-outcome';

type DbOrTx = PostgresJsDatabase;

const STUCK_THRESHOLD_MINUTES = 5;

export type SweepResult = {
  inspected: number;
  settled: number;
  reversed: number;
  stillPending: number;
  unknown: number;
  /** Master ledger accounts found with a negative balance (recon red flag). */
  negativeMaster: number;
};

export const reconciliationService = {
  async sweep(db: DbOrTx, adapter: AnchorAdapter, now: Date): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60 * 1000);
    // Every kind that waits on an Anchor TRANSFER, not just `spend`. A retailer payout
    // (`redemption`) is settled only by a `transfer.completed` webhook, so before this the sweep
    // left a lost webhook stranding the retailer's money in suspense permanently.
    const stuck = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'in_flight'),
          inArray(transactions.kind, [...TRANSFER_BACKED_KINDS]),
          lt(transactions.createdAt, cutoff),
        ),
      );

    let settled = 0;
    let reversed = 0;
    let stillPending = 0;
    let unknown = 0;

    for (const row of stuck) {
      const remote = await adapter.findTransferByReference(row.idempotencyKey);
      if (remote === null) {
        unknown += 1;
        continue;
      }
      if (remote.status === 'COMPLETED') {
        await applyTransferCompleted(db, row, {
          nibssSessionId: remote.nibssSessionId ?? null,
          settledAt: now,
        });
        settled += 1;
      } else if (remote.status === 'FAILED') {
        await applyTransferFailed(db, row, {
          reason: remote.failureReason ?? null,
          failedAt: now,
        });
        reversed += 1;
      } else {
        stillPending += 1;
      }
    }

    // Observability guard: the platform fee is booked at settlement without upfront reservation,
    // so a master ledger account can silently go negative (Amana-side ledger↔cash drift). Surface
    // it as a structured alert on every sweep instead of letting it accrue unnoticed.
    const negativeMaster = await postingsRepo.findNegativeMasterBalances(db);
    for (const acc of negativeMaster) {
      logger.error(
        {
          ledgerAccountId: acc.ledgerAccountId,
          masterWalletId: acc.masterWalletId,
          balanceKobo: acc.balanceKobo.toString(),
        },
        'recon: master ledger account has a negative balance',
      );
    }

    return {
      inspected: stuck.length,
      settled,
      reversed,
      stillPending,
      unknown,
      negativeMaster: negativeMaster.length,
    };
  },
};
