import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { type Result, err, ok } from '../../lib/result';
import type { ResolveError, ResolvedVendor } from './types';

const E164_RE = /^\+\d{10,15}$/;

export const phoneLookupService = {
  async lookup(
    adapter: AnchorAdapter,
    input: { phoneNumber: string },
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    if (!E164_RE.test(input.phoneNumber)) {
      return err({ code: 'BAD_INPUT', message: `phone not in E.164 format: ${input.phoneNumber}` });
    }
    try {
      const r = await adapter.phoneLookup({ phoneNumber: input.phoneNumber });
      return ok({
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        source: 'phone_lookup',
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
