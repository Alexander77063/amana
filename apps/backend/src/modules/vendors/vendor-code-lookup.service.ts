import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { type Result, err, isOk, ok } from '../../lib/result';
import { nameEnquiryService } from './name-enquiry.service';
import type { ResolveError, ResolvedVendor } from './types';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export const vendorCodeLookupService = {
  /**
   * Resolve an Amana Vendor Code to a payable vendor.
   *
   * The stored `displayName` is NOT what the payer is shown. As with the NQR path, the name is
   * re-confirmed against NIBSS on every single scan: a vendor's bank account can be closed,
   * reassigned or renamed long after the sticker was printed, and the name on the confirm screen
   * is the payer's only defence against sending money to the wrong place. If NIBSS is unreachable
   * we fail the resolution rather than fall back to the stored name — a stale name shown with
   * full confidence is worse than an error.
   *
   * The vendor row never leaves this function. It carries `claimedByPhone`, a raw phone number
   * belonging to the business owner, so the return value is built field by field rather than
   * spread; see the note on `ResolvedVendor`.
   */
  async lookup(
    db: DbOrTx,
    adapter: AnchorAdapter,
    publicCode: string,
  ): Promise<Result<ResolvedVendor, ResolveError>> {
    const vendor = await vendorsRepo.findByPublicCode(db, publicCode);
    if (!vendor) return err({ code: 'NOT_FOUND' });
    // A suspended vendor keeps its code so the row stays findable, but it must never resolve to
    // something payable. Its own error code — not NOT_FOUND — because suspension is a state the
    // caller can act on and explain, and collapsing the two would let a suspension revoke the
    // landing page while leaving the in-app payment working.
    if (vendor.status === 'suspended') return err({ code: 'VENDOR_SUSPENDED' });

    const ne = await nameEnquiryService.lookup(adapter, {
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
    });
    if (!isOk(ne)) return ne;

    return ok({
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
      accountName: ne.value.accountName,
      source: 'vendor_code',
      suggestedAmountKobo: null,
      vendorId: vendor.id,
      category: vendor.category,
    });
  },
};
