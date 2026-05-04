import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { stickerResolverService } from '../sticker/sticker-resolver.service';
import { err, isOk, ok, type Result } from '../../lib/result';
import type { ResolvedVendor, ResolveError } from './types';

export const stickerLookupService = {
  async lookup(
    db: PostgresJsDatabase,
    stickerUuid: string,
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    const r = await stickerResolverService.resolve(db, stickerUuid);
    if (isOk(r)) {
      return ok({
        bankCode: r.value.bankCode,
        accountNumber: r.value.accountNumber,
        accountName: r.value.accountName,
        source: 'sticker',
        suggestedAmountKobo: null,
      });
    }
    switch (r.error.code) {
      case 'NOT_FOUND':
        return err({ code: 'NOT_FOUND' });
      case 'UNBOUND':
        return err({ code: 'STICKER_UNBOUND' });
      case 'REVOKED':
        return err({ code: 'STICKER_REVOKED' });
    }
  },
};
