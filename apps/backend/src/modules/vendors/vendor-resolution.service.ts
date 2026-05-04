import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { type Result, err, isOk, ok } from '../../lib/result';
import { nameEnquiryService } from './name-enquiry.service';
import { decodeNqr } from './nqr-decoder';
import { phoneLookupService } from './phone-lookup.service';
import { recentsService } from './recents.service';
import { stickerLookupService } from './sticker-lookup.service';
import type { ResolveError, ResolvedVendor } from './types';

export type ResolveInput =
  | { kind: 'account'; bankCode: string; accountNumber: string; subWalletId: string; now: Date }
  | { kind: 'phone'; phoneNumber: string; subWalletId: string; now: Date }
  | { kind: 'sticker'; stickerUuid: string; subWalletId: string; now: Date }
  | { kind: 'nqr'; payload: string; subWalletId: string; now: Date };

export const vendorResolutionService = {
  async resolve(
    db: PostgresJsDatabase,
    adapter: AnchorAdapter,
    input: ResolveInput,
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    let result: Result<ResolvedVendor, ResolveError>;

    switch (input.kind) {
      case 'account':
        result = await nameEnquiryService.lookup(adapter, {
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
        });
        break;

      case 'phone':
        result = await phoneLookupService.lookup(adapter, { phoneNumber: input.phoneNumber });
        break;

      case 'sticker':
        result = await stickerLookupService.lookup(db, input.stickerUuid);
        break;

      case 'nqr': {
        const decoded = decodeNqr(input.payload);
        if (!isOk(decoded)) return err({ code: 'BAD_INPUT', message: decoded.error.message });
        // Confirm name via Anchor name enquiry; the QR may have provided a name but we trust NIBSS.
        const ne = await nameEnquiryService.lookup(adapter, {
          bankCode: decoded.value.bankCode,
          accountNumber: decoded.value.accountNumber,
        });
        if (!isOk(ne)) return ne;
        result = ok({
          ...ne.value,
          source: 'nqr',
          suggestedAmountKobo: decoded.value.amountKobo,
        });
        break;
      }
    }

    if (isOk(result)) {
      await recentsService.touch(db, {
        subWalletId: input.subWalletId,
        bankCode: result.value.bankCode,
        accountNumber: result.value.accountNumber,
        accountName: result.value.accountName,
        now: input.now,
      });
    }

    return result;
  },
};
