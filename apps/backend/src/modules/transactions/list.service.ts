import type { TransactionListResponse, TransactionSummary } from '@amana/types';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { maskAccount } from '../../lib/mask-account';

function toISO(d: Date): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

type ListRow = {
  id: string;
  kind: string;
  status: string;
  amount_kobo: string;
  vendor_resolved_name: string | null;
  vendor_account: string | null;
  initiated_at: Date;
  settled_at: Date | null;
};

export const transactionListService = {
  async listForSubWallet(
    db: PostgresJsDatabase,
    input: { subWalletId: string; limit: number; cursor: string | null },
  ): Promise<TransactionListResponse> {
    const { subWalletId, limit, cursor } = input;

    let rows: ListRow[];

    if (cursor) {
      rows = await db.execute<ListRow>(sql`
        SELECT t.id,
               t.kind::text           AS kind,
               t.status::text         AS status,
               t.amount_kobo::text    AS amount_kobo,
               t.vendor_resolved_name,
               t.vendor_account,
               t.created_at           AS initiated_at,
               t.settled_at
        FROM transactions t
        WHERE t.sub_wallet_id = ${subWalletId}
          AND (t.created_at, t.id) < (
            SELECT created_at, id FROM transactions WHERE id = ${cursor} LIMIT 1
          )
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit + 1}
      `);
    } else {
      rows = await db.execute<ListRow>(sql`
        SELECT t.id,
               t.kind::text           AS kind,
               t.status::text         AS status,
               t.amount_kobo::text    AS amount_kobo,
               t.vendor_resolved_name,
               t.vendor_account,
               t.created_at           AS initiated_at,
               t.settled_at
        FROM transactions t
        WHERE t.sub_wallet_id = ${subWalletId}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit + 1}
      `);
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const transactions: TransactionSummary[] = page.map((r) => ({
      id: r.id,
      kind: r.kind as TransactionSummary['kind'],
      status: r.status as TransactionSummary['status'],
      amountKobo: r.amount_kobo,
      vendorResolvedName: r.vendor_resolved_name,
      vendorAccountMasked: maskAccount(r.vendor_account),
      initiatedAt: toISO(r.initiated_at),
      settledAt: r.settled_at ? toISO(r.settled_at) : null,
    }));

    return { transactions, nextCursor };
  },
};
