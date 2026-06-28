import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Kobo } from '../../lib/kobo';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';

export type CreateIntentInput = {
  /** The user initiating the spend; authorized against the wallet before insert. */
  actorUserId: string;
  masterWalletId: string;
  /** null means principal-direct spend per Decision #17. */
  subWalletId: string | null;
  amountKobo: Kobo;
  idempotencyKey: string;
  vendorBankCode: string;
  vendorAccountNumber: string;
  vendorResolvedName: string;
  category: string | null;
  agentNote: string | null;
};

export const txnIntentService = {
  async create(db: PostgresJsDatabase, input: CreateIntentInput): Promise<TransactionRow> {
    await assertWalletAccess(db, input.actorUserId, {
      masterWalletId: input.masterWalletId,
      subWalletId: input.subWalletId,
    });
    return transactionsRepo.insert(db, {
      masterWalletId: input.masterWalletId,
      subWalletId: input.subWalletId,
      kind: 'spend',
      amountKobo: input.amountKobo,
      idempotencyKey: input.idempotencyKey,
      vendorBankCode: input.vendorBankCode,
      vendorAccount: input.vendorAccountNumber,
      vendorResolvedName: input.vendorResolvedName,
      category: input.category,
      agentNote: input.agentNote,
    });
  },
};
