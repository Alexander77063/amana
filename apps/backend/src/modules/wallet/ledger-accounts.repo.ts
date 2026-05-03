import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ledgerAccounts } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type LedgerAccountKind = 'master' | 'sub' | 'suspense' | 'fee' | 'external';
export type NormalSide = 'debit' | 'credit';

export type NewLedgerAccount = {
  masterWalletId: string;
  kind: LedgerAccountKind;
  subWalletId?: string | null;
  normalSide: NormalSide;
};

export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;

export const ledgerAccountsRepo = {
  async insert(db: DbOrTx, input: NewLedgerAccount): Promise<LedgerAccountRow> {
    const [row] = await db
      .insert(ledgerAccounts)
      .values({
        masterWalletId: input.masterWalletId,
        kind: input.kind,
        subWalletId: input.subWalletId ?? null,
        normalSide: input.normalSide,
      })
      .returning();
    if (!row) throw new Error('ledgerAccounts.insert returned no row');
    return row;
  },

  async findByMasterAndKind(
    db: DbOrTx,
    masterWalletId: string,
    kind: LedgerAccountKind,
  ): Promise<LedgerAccountRow | undefined> {
    const [row] = await db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.masterWalletId, masterWalletId), eq(ledgerAccounts.kind, kind)))
      .limit(1);
    return row;
  },

  async findBySubWallet(db: DbOrTx, subWalletId: string): Promise<LedgerAccountRow | undefined> {
    const [row] = await db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.subWalletId, subWalletId))
      .limit(1);
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<LedgerAccountRow | undefined> {
    const [row] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id)).limit(1);
    return row;
  },
};
