import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, ok, type Result } from '../../lib/result';
import { stickersRepo } from './stickers.repo';

type DbOrTx = PostgresJsDatabase;

export type ResolvedSticker = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

export type ResolveError =
  | { code: 'NOT_FOUND' }
  | { code: 'UNBOUND' }
  | { code: 'REVOKED' };

export const stickerResolverService = {
  async resolve(
    db: DbOrTx,
    stickerUuid: string,
  ): Promise<Result<ResolvedSticker, ResolveError>> {
    const row = await stickersRepo.findByUuid(db, stickerUuid);
    if (!row) return err({ code: 'NOT_FOUND' });
    if (row.status === 'unbound') return err({ code: 'UNBOUND' });
    if (row.status === 'revoked') return err({ code: 'REVOKED' });
    return ok({
      bankCode: row.bankCode,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
    });
  },
};
