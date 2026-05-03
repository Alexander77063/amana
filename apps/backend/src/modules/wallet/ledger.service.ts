import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { postingsRepo } from './postings.repo';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type DoubleEntryLeg = {
  ledgerAccountId: string;
  debitKobo: Kobo;
  creditKobo: Kobo;
};

export const ledgerService = {
  /** Writes a balanced set of postings inside a transaction. Throws on imbalance. */
  async writeDoubleEntry(db: DbOrTx, transactionId: string, legs: DoubleEntryLeg[]): Promise<void> {
    if (legs.length < 2) {
      throw new Error('writeDoubleEntry: need at least 2 postings');
    }
    const totalDebit = legs.reduce((acc, l) => acc + l.debitKobo, 0n);
    const totalCredit = legs.reduce((acc, l) => acc + l.creditKobo, 0n);
    if (totalDebit !== totalCredit) {
      throw new Error(
        `writeDoubleEntry: unbalanced — debits=${totalDebit} credits=${totalCredit}`,
      );
    }
    await db.transaction(async (tx) => {
      await postingsRepo.insertMany(tx as DbOrTx, legs.map((l) => ({ ...l, transactionId })));
    });
  },
};
