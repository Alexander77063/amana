import type { Kobo } from '../../lib/kobo';

export type ResolvedVendor = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  /** Where the resolution came from — useful for audit + UX. */
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents' | 'vendor_code';
  /** Optional amount baked in (NQR can include amount; other paths set null). */
  suggestedAmountKobo: Kobo | null;
  /**
   * The registry vendor, when this account is one. Only the `vendor_code` path can populate it at
   * resolution time; every other path leaves it null and lets `lifecycleService.evaluate` resolve
   * the vendor from the account at evaluation time instead.
   *
   * This type is the ONLY thing that leaves the vendors module on a resolution. A `VendorRow`
   * carries `claimedByPhone` — a raw phone number — so a row must never be spread into a resolved
   * vendor; name every field that crosses the boundary, as here.
   */
  vendorId: string | null;
  /** The registry's category, for pre-filling the confirm screen. Advisory to the client. */
  category: string | null;
};

export type ResolveError =
  | { code: 'NOT_FOUND' }
  | { code: 'BAD_INPUT'; message: string }
  | { code: 'PARTNER_DOWN' }
  | { code: 'STICKER_UNBOUND' }
  | { code: 'STICKER_REVOKED' }
  /**
   * The code is real but the vendor behind it has been suspended. Deliberately NOT `NOT_FOUND`:
   * a suspended vendor keeps its `publicCode`, so the caller can tell "this code was real and is
   * now dead" apart from "this code never existed" — and the two want different HTTP statuses and
   * very different copy on the confirm screen. Same reasoning as `STICKER_REVOKED`.
   */
  | { code: 'VENDOR_SUSPENDED' }
  /**
   * The code is real but NIBSS no longer knows the bank account behind it — closed, or
   * reassigned. Deliberately NOT `NOT_FOUND`, for the same reason as `VENDOR_SUSPENDED`: told
   * "no such code", a shopkeeper debugs the code in their window, which is fine, instead of the
   * closed account, which is the actual problem. Ops needs the two apart as well.
   *
   * Only the `vendor_code` path can raise this, because only it has already proven the code
   * exists before the enquiry runs. On the `account` path a NIBSS 404 genuinely does mean the
   * typed account number is wrong, and `NOT_FOUND` stays correct there.
   */
  | { code: 'VENDOR_ACCOUNT_GONE' };
