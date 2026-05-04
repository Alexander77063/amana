import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type RecentRow, recentsRepo } from './recents.repo';

const MAX_RECENTS = 10;

export type TouchInput = {
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  now: Date;
};

export const recentsService = {
  async touch(db: PostgresJsDatabase, input: TouchInput): Promise<RecentRow> {
    const row = await recentsRepo.upsert(db, input);
    await recentsRepo.trimToLimit(db, input.subWalletId, MAX_RECENTS);
    return row;
  },

  async listTop10(db: PostgresJsDatabase, subWalletId: string): Promise<RecentRow[]> {
    return recentsRepo.listTop(db, subWalletId, MAX_RECENTS);
  },
};
