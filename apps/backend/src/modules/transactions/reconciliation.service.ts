import { and, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { settlementService } from './settlement.service';
import { reversalService } from './reversal.service';

type DbOrTx = PostgresJsDatabase;

const STUCK_THRESHOLD_MINUTES = 5;

export type SweepResult = {
  inspected: number;
  settled: number;
  reversed: number;
  stillPending: number;
  unknown: number;
};

export const reconciliationService = {
  async sweep(
    db: DbOrTx,
    adapter: AnchorAdapter,
    now: Date,
  ): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60 * 1000);
    const stuck = await db
      .select({
        id: transactions.id,
        idempotencyKey: transactions.idempotencyKey,
        kind: transactions.kind,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'in_flight'),
          eq(transactions.kind, 'spend'),
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
        await settlementService.finalise(db, {
          transactionId: row.id,
          nibssSessionId: remote.nibssSessionId ?? null,
          settledAt: now,
        });
        settled += 1;
      } else if (remote.status === 'FAILED') {
        await reversalService.reverse(db, {
          transactionId: row.id,
          reason: remote.failureReason ?? null,
          failedAt: now,
        });
        reversed += 1;
      } else {
        stillPending += 1;
      }
    }

    return { inspected: stuck.length, settled, reversed, stillPending, unknown };
  },
};
