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
   * Master ledger accounts whose balance (debits − credits) is negative — a reconciliation red
   * flag. The platform fee is booked at settlement without upfront reservation, so a wallet that
   * has spent down before the fee accrues can drive its (debit-normal) master LA negative — an
   * Amana-side ledger↔cash drift that is otherwise silent. Surfaced by the recon sweep.
   */
  async findNegativeMasterBalances(
    db: DbOrTx,
  ): Promise<{ ledgerAccountId: string; masterWalletId: string; balanceKobo: Kobo }[]> {
    const rows = await db.execute<{
      ledger_account_id: string;
      master_wallet_id: string;
      balance: string;
    }>(sql`
      SELECT la.id AS ledger_account_id,
             la.master_wallet_id,
             (COALESCE(SUM(p.debit_kobo), 0) - COALESCE(SUM(p.credit_kobo), 0))::text AS balance
      FROM ledger_accounts la
      LEFT JOIN postings p ON p.ledger_account_id = la.id
      WHERE la.kind = 'master'
      GROUP BY la.id, la.master_wallet_id
      HAVING (COALESCE(SUM(p.debit_kobo), 0) - COALESCE(SUM(p.credit_kobo), 0)) < 0
    `);
    return rows.map((r) => ({
      ledgerAccountId: r.ledger_account_id,
      masterWalletId: r.master_wallet_id,
      balanceKobo: kobo(BigInt(r.balance)),
    }));
  },

  /**
   * Sum of debit_kobo on *active* spend obligations for a sub-wallet within a rolling window.
   *
   * Three mutually-exclusive (by `t.kind`) branches count toward the same limit window:
   *  - **NIP spends** (`kind='spend'`): windowed by `sent_at`, including `in_flight` — so spends
   *    submitted but not yet settled count immediately, closing the rapid-spend limit bypass.
   *  - **Marketplace holds** (`kind='marketplace_purchase'`): a reserve debits the same sub LA but
   *    the txn stays `draft` with no `sent_at`, so it is windowed by `created_at`. Only an *active*
   *    hold counts — its redemption must still be `reserved` or `redeemed`. An expired/refunded hold
   *    booked a reversing credit back to the sub LA, so it must NOT count (else it double-charges the
   *    window against funds already returned).
   *  - **VAS holds** (`kind='vas_purchase'`): a reserve debits the same sub LA, windowed by
   *    `created_at`. VAS status *is* the txn status, so we filter directly on
   *    `t.status IN ('in_flight','settled')` — a refunded (`failed`) bill drops out automatically,
   *    no redemption-style EXISTS join needed.
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
        AND (
          (
            t.kind = 'spend'
            AND t.status IN ('in_flight', 'settled')
            AND t.sent_at IS NOT NULL
            AND t.sent_at >= ${cutoff.toISOString()}::timestamptz
          )
          OR (
            t.kind = 'marketplace_purchase'
            AND t.created_at >= ${cutoff.toISOString()}::timestamptz
            AND EXISTS (
              SELECT 1 FROM redemptions r
              WHERE r.transaction_id = t.id
                AND r.status IN ('reserved', 'redeemed')
            )
          )
          OR (
            t.kind = 'vas_purchase'
            AND t.status IN ('in_flight', 'settled')
            AND t.created_at >= ${cutoff.toISOString()}::timestamptz
          )
        )
    `);
    return kobo(BigInt(result[0]?.s ?? '0'));
  },
};
