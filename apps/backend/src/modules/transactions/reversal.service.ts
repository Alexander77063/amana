import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type DbOrTx = PostgresJsDatabase;

export type ReverseInput = {
  transactionId: string;
  reason: string | null;
  failedAt: Date;
};

export const reversalService = {
  // TODO(T16): real implementation
  async reverse(_db: DbOrTx, _input: ReverseInput): Promise<void> {
    throw new Error('not yet implemented');
  },
};
