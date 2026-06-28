import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { postings } from '../../db/schema';
import { type Kobo, kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type PostingRow = typeof postings.$inferSelect;

export type NewPosting = {
  transactionId: string;
  ledgerAccountId: string;
  debitKobo: Kobo;
  creditKobo: Kobo;
};

export const postingsRepo = {
  /** Append-only. No update / delete methods exist. */
  async insertMany(db: DbOrTx, rows: NewPosting[]): Promise<PostingRow[]> {
    if (rows.length === 0) return [];
    return db.insert(postings).values(rows).returning();
  },

  async listByTransaction(db: DbOrTx, transactionId: string): Promise<PostingRow[]> {
    return db.select().from(postings).where(eq(postings.transactionId, transactionId));
  },

  /** Sum of (debits - credits) for a ledger account. */
  async accountBalance(db: DbOrTx, ledgerAccountId: string): Promise<Kobo> {
    const result = await db.execute<{ balance: string }>(sql`
      SELECT COALESCE(SUM(debit_kobo) - SUM(credit_kobo), 0)::text AS balance
      FROM postings
      WHERE ledger_account_id = ${ledgerAccountId}
    `);
    return kobo(BigInt(result[0]?.balance ?? '0'));
  },

  /**
   * Sum of debit_kobo on *active* (sent, not reversed/failed) spend
   * transactions for a sub-wallet within a rolling window. Windowed by
   * `sent_at` and including `in_flight` — so spends that have been submitted but
   * not yet settled count immediately, closing the rapid-spend limit bypass.
   */
  async sumDebitsInWindow(
    db: DbOrTx,
    subWalletId: string,
    windowSeconds: number,
    now: Date,
  ): Promise<Kobo> {
    const cutoff = new Date(now.getTime() - windowSeconds * 1000);
    const result = await db.execute<{ s: string }>(sql`
      SELECT COALESCE(SUM(p.debit_kobo), 0)::text AS s
      FROM postings p
      INNER JOIN ledger_accounts la ON la.id = p.ledger_account_id
      INNER JOIN transactions t ON t.id = p.transaction_id
      WHERE la.sub_wallet_id = ${subWalletId}
        AND la.kind = 'sub'
        AND t.kind = 'spend'
        AND t.status IN ('in_flight', 'settled')
        AND t.sent_at IS NOT NULL
        AND t.sent_at >= ${cutoff.toISOString()}::timestamptz
    `);
    return kobo(BigInt(result[0]?.s ?? '0'));
  },
};
