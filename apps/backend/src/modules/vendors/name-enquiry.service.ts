import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { type Result, err, ok } from '../../lib/result';
import type { ResolveError, ResolvedVendor } from './types';

export const nameEnquiryService = {
  async lookup(
    adapter: AnchorAdapter,
    input: { bankCode: string; accountNumber: string },
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    try {
      const r = await adapter.nameEnquiry({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
      });
      return ok({
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        source: 'name_enquiry',
        suggestedAmountKobo: null,
      });
    } catch (e) {
      if (e instanceof AnchorHttpError) {
        if (e.status === 404) return err({ code: 'NOT_FOUND' });
        if (e.status >= 500) return err({ code: 'PARTNER_DOWN' });
        return err({ code: 'BAD_INPUT', message: `Anchor ${e.status}` });
      }
      return err({ code: 'PARTNER_DOWN' });
    }
  },
};
