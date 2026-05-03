import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { kobo } from '../../lib/kobo';
import type { AnomalyHistory } from './types';

const LOOKBACK_DAYS = 90;

export async function loadHistoryForSubWallet(
  db: PostgresJsDatabase,
  subWalletId: string,
  now: Date,
): Promise<AnomalyHistory> {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      amountKobo: transactions.amountKobo,
      vendorAccountNumber: transactions.vendorAccount,
      vendorBankCode: transactions.vendorBankCode,
      settledAt: transactions.settledAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.subWalletId, subWalletId),
        eq(transactions.status, 'settled'),
        eq(transactions.kind, 'spend'),
        isNotNull(transactions.settledAt),
        gte(transactions.settledAt, cutoff),
      ),
    );

  return {
    txns: rows.map((r) => ({
      amountKobo: kobo(r.amountKobo as bigint),
      vendorAccountNumber: r.vendorAccountNumber,
      vendorBankCode: r.vendorBankCode,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      confirmedAt: r.settledAt!,
    })),
  };
}
