import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ledgerAccounts } from '../../db/schema';
import { postingsRepo } from './postings.repo';

type DbOrTx = PostgresJsDatabase;

export const balanceService = {
	async accountBalanceForSubWallet(db: DbOrTx, subWalletId: string): Promise<bigint> {
		const [la] = await db
			.select({ id: ledgerAccounts.id })
			.from(ledgerAccounts)
			.where(and(eq(ledgerAccounts.subWalletId, subWalletId), eq(ledgerAccounts.kind, 'sub')))
			.limit(1);
		if (!la) throw new Error(`balance: no sub ledger-account for ${subWalletId}`);
		return postingsRepo.accountBalance(db, la.id);
	},
};
