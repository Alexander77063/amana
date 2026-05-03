import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { masterWallets } from '../../db/schema';
import { ledgerAccountsRepo } from './ledger-accounts.repo';

type DbOrTx = PostgresJsDatabase;

export type MasterWalletRow = typeof masterWallets.$inferSelect;

export type ProvisionInput = {
  householdId: string;
  anchorVirtualAccount: string;
  anchorBankCode: string;
};

export type ProvisionedMasterWallet = {
  master: MasterWalletRow;
  ledgerAccountIds: { master: string; suspense: string; fee: string };
};

export const masterWalletsRepo = {
  async provision(db: DbOrTx, input: ProvisionInput): Promise<ProvisionedMasterWallet> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(masterWallets)
        .values({
          householdId: input.householdId,
          anchorVirtualAccount: input.anchorVirtualAccount,
          anchorBankCode: input.anchorBankCode,
        })
        .returning();
      if (!row) throw new Error('masterWallets.provision returned no row');

      const masterLA = await ledgerAccountsRepo.insert(tx as DbOrTx, {
        masterWalletId: row.id, kind: 'master', normalSide: 'debit',
      });
      const suspenseLA = await ledgerAccountsRepo.insert(tx as DbOrTx, {
        masterWalletId: row.id, kind: 'suspense', normalSide: 'credit',
      });
      const feeLA = await ledgerAccountsRepo.insert(tx as DbOrTx, {
        masterWalletId: row.id, kind: 'fee', normalSide: 'credit',
      });

      return {
        master: row,
        ledgerAccountIds: { master: masterLA.id, suspense: suspenseLA.id, fee: feeLA.id },
      };
    });
  },

  async findById(db: DbOrTx, id: string): Promise<MasterWalletRow | undefined> {
    const [row] = await db.select().from(masterWallets).where(eq(masterWallets.id, id)).limit(1);
    return row;
  },

  async findByHousehold(db: DbOrTx, householdId: string): Promise<MasterWalletRow | undefined> {
    const [row] = await db
      .select()
      .from(masterWallets)
      .where(eq(masterWallets.householdId, householdId))
      .limit(1);
    return row;
  },
};
