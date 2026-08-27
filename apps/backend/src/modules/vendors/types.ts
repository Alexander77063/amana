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

/**
 * The WIRE shape of a `ResolvedVendor` — what the five resolution endpoints actually send.
 *
 * It differs from `ResolvedVendor` in exactly one field, and that one field is why this type
 * exists: `suggestedAmountKobo` is `Kobo`, which is a `bigint`, and `bigint` has NO JSON
 * representation. `JSON.stringify({ a: 1n })` throws `TypeError: Do not know how to serialize a
 * BigInt`, and Hono's `c.json` is a bare `JSON.stringify`. Handing a `ResolvedVendor` straight to
 * `c.json` therefore 500s on any NQR carrying tag 54 — which is the standard "scan to pay ₦2,000"
 * sticker, and the whole reason NQR defines tag 54 at all.
 *
 * Mirrored by `ResolvedVendorResponse` in `@amana/api-client`, by hand: the backend is not a
 * dependency of that package, so nothing makes the compiler compare the two. When this changes,
 * change that one.
 */
export type ResolvedVendorResponse = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  source: ResolvedVendor['source'];
  /** Decimal kobo, base 10 — see `toResolvedVendorResponse`. */
  suggestedAmountKobo: string | null;
  vendorId: string | null;
  category: string | null;
};

/**
 * The single serialization boundary for `ResolvedVendor`. Every route that returns one goes
 * through here — deliberately once for the TYPE rather than once per endpoint, because a
 * per-route fix is how the sixth endpoint reintroduces the 500.
 *
 * `.toString()` on the bigint: raw kobo, base 10, no thousands separator and no currency. That is
 * what every other `…Kobo` field on the wire already is (`routes/sub-wallets.ts`,
 * `routes/me-bumps.ts`, `routes/vas.ts`, `routes/retailer-portal.ts` all emit
 * `<bigint>.toString()`), and it is what `@amana/api-client` declares the field to be.
 *
 * NOT `toNairaString` from `lib/kobo.ts`, despite it being the nearest-looking helper: it returns
 * `"5,200.50"` — a different UNIT, comma-formatted for display, and not parseable by `BigInt()`
 * on the far side. A field named `…Kobo` carrying naira is worse than no helper at all. And not a
 * `Number`, ever: coercing kobo through a float is exactly what `CLAUDE.md` forbids, and it is
 * silently lossy above 2^53 kobo.
 *
 * The null test is `=== null`, not truthiness, and it has to stay that way: `0n` is FALSY, so
 * `v.suggestedAmountKobo ? … : null` turns a legitimate zero-amount QR into "no amount" and the
 * payer gets prompted for a figure the sticker deliberately set to zero. `sub-wallets.ts` uses
 * the same `=== null` form for the same reason.
 *
 * Every field is named rather than spread, which is the same rule `ResolvedVendor` itself states:
 * a spread is how a field nobody vetted crosses the boundary.
 */
export function toResolvedVendorResponse(v: ResolvedVendor): ResolvedVendorResponse {
  return {
    bankCode: v.bankCode,
    accountNumber: v.accountNumber,
    accountName: v.accountName,
    source: v.source,
    suggestedAmountKobo: v.suggestedAmountKobo === null ? null : v.suggestedAmountKobo.toString(),
    vendorId: v.vendorId,
    category: v.category,
  };
}

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
  | { code: 'VENDOR_ACCOUNT_GONE' }
  /**
   * The enquiry against the vendor's account failed for a reason that is neither "account gone"
   * nor "partner down" — a 429, a 401, a 403, a 422. `nameEnquiryService` calls all of those
   * `BAD_INPUT`, which is honest on the `account` path (the caller typed the number) and a lie
   * here: on the `vendor_code` path the bank code and account number are OURS, read off a vendor
   * row whose code has already been proven real. A shopkeeper with a perfectly correct code must
   * not be told their code is wrong.
   *
   * Same reasoning as `VENDOR_ACCOUNT_GONE`, which applied it to Anchor's 404 and stopped there.
   * The partner's identity and status stay inside this error: the route emits the code and no
   * `detail`, because which upstream returned what is not the payer's business.
   */
  | { code: 'VENDOR_ENQUIRY_FAILED' };
