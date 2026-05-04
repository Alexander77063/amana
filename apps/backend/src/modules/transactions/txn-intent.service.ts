import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactionsRepo, type TransactionRow } from '../wallet/transactions.repo';
import type { Kobo } from '../../lib/kobo';

export type CreateIntentInput = {
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
