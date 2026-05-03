import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { subWallets } from '../../db/schema';
import { ledgerAccountsRepo } from './ledger-accounts.repo';

type DbOrTx = PostgresJsDatabase;

export type SubWalletRow = typeof subWallets.$inferSelect;

export type ProvisionSubInput = {
  masterWalletId: string;
  agentUserId: string;
  name: string;
};

export type ProvisionedSubWallet = {
  sub: SubWalletRow;
  ledgerAccountId: string;
};

export const subWalletsRepo = {
  async provision(db: DbOrTx, input: ProvisionSubInput): Promise<ProvisionedSubWallet> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(subWallets)
        .values(input)
        .returning();
      if (!row) throw new Error('subWallets.provision returned no row');

      const la = await ledgerAccountsRepo.insert(tx as DbOrTx, {
        masterWalletId: input.masterWalletId,
        kind: 'sub',
        subWalletId: row.id,
        normalSide: 'debit',
      });
      return { sub: row, ledgerAccountId: la.id };
    });
  },

  async findById(db: DbOrTx, id: string): Promise<SubWalletRow | undefined> {
    const [row] = await db.select().from(subWallets).where(eq(subWallets.id, id)).limit(1);
    return row;
  },

  async listByMaster(db: DbOrTx, masterWalletId: string): Promise<SubWalletRow[]> {
    return db.select().from(subWallets).where(eq(subWallets.masterWalletId, masterWalletId));
  },

  async setStatus(
    db: DbOrTx,
    id: string,
    status: 'active' | 'suspended' | 'closed',
  ): Promise<void> {
    await db.update(subWallets).set({ status }).where(eq(subWallets.id, id));
  },
};
