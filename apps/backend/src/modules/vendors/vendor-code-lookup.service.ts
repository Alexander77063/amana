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

    // An ALLOW-list, not a deny-list, and the exhaustive `never` guard is the point of it. This is
    // a money path: the default direction must be refuse. Written as `status === 'suspended'` it
    // would make any status added to `vendorStatusEnum` later — `delisted`, `pending_review` —
    // silently payable, with no test and no reviewer likely to notice. Here a fourth enum member
    // fails to compile until someone decides, deliberately, which side of the line it falls on.
    switch (vendor.status) {
      case 'claimed':
        break;
      // A suspended vendor keeps its code so the row stays findable, but it must never resolve to
      // something payable. Its own error code — not NOT_FOUND — because suspension is a state the
      // caller can act on and explain, and collapsing the two would let a suspension revoke the
      // landing page while leaving the in-app payment working.
      case 'suspended':
        return err({ code: 'VENDOR_SUSPENDED' });
      // Unreachable today: only `claim()` writes `publicCode`, and it does so atomically with
      // `status: 'claimed'`. If a code ever appears on an observed row it got there by hand, and
      // "no such code" is the honest answer — nobody has proven they own that account.
      case 'observed':
        return err({ code: 'NOT_FOUND' });
      default: {
        const _exhaustive: never = vendor.status;
        return err({ code: 'NOT_FOUND' });
      }
    }

    const ne = await nameEnquiryService.lookup(adapter, {
      bankCode: vendor.bankCode,
      accountNumber: vendor.accountNumber,
    });
    if (!isOk(ne)) {
      // `nameEnquiryService` maps an Anchor 404 to NOT_FOUND, which is right for a typed account
      // number and wrong here: `findByPublicCode` has already proven this code is real, so a 404
      // means the SHOP'S ACCOUNT is gone, not that the code never existed. Re-map it where that
      // context exists — the shared enquiry service has no way to know which it is looking at.
      if (ne.error.code === 'NOT_FOUND') return err({ code: 'VENDOR_ACCOUNT_GONE' });
      // The same correction, applied to the rest of the non-5xx statuses. `nameEnquiryService`
      // calls a 429 / 401 / 403 / 422 `BAD_INPUT` — true when a human typed the account number,
      // false here, where the account came off the vendor row. Left alone it would tell a
      // shopkeeper with a correct code that their code is malformed, and `BAD_INPUT` carries a
      // `message` of the form `Anchor <status>`, naming our banking partner to the caller.
      if (ne.error.code === 'BAD_INPUT') return err({ code: 'VENDOR_ENQUIRY_FAILED' });
      return ne;
    }

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
