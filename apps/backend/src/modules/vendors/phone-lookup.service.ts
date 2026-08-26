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
      // The number is deliberately NOT interpolated. This message is now logged by the route,
      // and the logger's redaction matches field paths — it cannot reach inside a string, so an
      // interpolated phone would land in the logs in the clear. The caller already knows what
      // they typed, and the route passes the number separately as the redacted `phone` field.
      return err({ code: 'BAD_INPUT', message: 'phone not in E.164 format' });
    }
    try {
      const r = await adapter.phoneLookup({ phoneNumber: input.phoneNumber });
      return ok({
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        source: 'phone_lookup',
        suggestedAmountKobo: null,
        vendorId: null,
        category: null,
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
