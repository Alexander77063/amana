import { ApiError } from './errors';
import type { AuthedClient } from './household-api';

/**
 * The wire shape of the backend's `ResolvedVendor`
 * (`apps/backend/src/modules/vendors/types.ts`), returned by every vendor resolution endpoint.
 *
 * This is a HAND-WRITTEN mirror, not a generated type: the backend is not a dependency of this
 * package, so nothing makes the compiler compare the two. It has already drifted once — SP-V3
 * Task 1 added `vendorId`, `category` and `source: 'vendor_code'` to the backend type, and because
 * `/vendors/name-enquiry`, `/phone-lookup`, `/sticker/:uuid` and `/nqr-decode` all serialize
 * `result.value` straight to JSON, the wire carried three fields this type denied while the extra
 * properties survived the cast in silence. `tests/vendor-api.test-d.ts` pins the shape so the next
 * divergence is a red `typecheck` instead. When the backend type changes, change this one.
 */
export type ResolvedVendorResponse = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents' | 'vendor_code';
  /**
   * `string`, not `number`: raw kobo, base 10, no separator and no currency — `BigInt()`-parseable
   * on this side, and the same encoding as every other `…Kobo` field on the wire.
   *
   * The server's field is `Kobo` — `bigint & brand` — and `bigint` has no JSON representation:
   * `JSON.stringify({ a: 1n })` throws, and Hono's `c.json` is a bare `JSON.stringify`
   * (`hono/dist/context.js`). `toResolvedVendorResponse` (backend `modules/vendors/types.ts`) is
   * the single boundary that maps it, `.toString()`, for all five resolution endpoints.
   *
   * Non-null only on `/vendors/nqr-decode`, and only when the QR carries NQR tag 54 — the standard
   * "scan to pay ₦2,000" sticker. Every other resolution path sets it `null`.
   *
   * **`"0"` is a real value, not "no amount".** A zero-amount QR sets it deliberately, so test it
   * with `=== null` on this side too; `0n` is falsy on the server and a truthiness check there is
   * the exact bug the boundary's `=== null` exists to avoid.
   *
   * (This comment previously said the wire "cannot currently produce a non-null value at all",
   * which was true when it was written — the endpoint 500'd on any tag-54 payload. Backend commit
   * `99faccb` fixed that.)
   */
  suggestedAmountKobo: string | null;
  /**
   * The registry vendor, when the account is one. Non-null only on the `vendor_code` path: every
   * other path leaves it null and lets the server resolve the vendor from the account at
   * evaluation time.
   *
   * Read-only, as an OUTPUT. Never send it back on a spend intent — the server re-resolves the
   * vendor from the bank code and account number precisely so a client cannot choose which
   * merchant's category rules get applied to a payment.
   */
  vendorId: string | null;
  /** The registry's category, for pre-filling the confirm screen. Advisory to the client. */
  category: string | null;
};

/**
 * The `error` codes `GET /vendors/code/:code` can return from the resolver itself. SCREAMING_CASE,
 * mirroring `ResolveError` on the backend — the framework layers wrapped around the route answer
 * in snake_case instead (`validation_error` on a 400, `forbidden` on a 403, `rate_limited` on a
 * 429), so a consumer switching on `ApiError.code` sees both conventions.
 */
export type VendorCodeErrorCode =
  | 'NOT_FOUND'
  | 'VENDOR_SUSPENDED'
  | 'VENDOR_ACCOUNT_GONE'
  | 'VENDOR_ENQUIRY_FAILED'
  | 'PARTNER_DOWN';

/**
 * 502 (could not reach the partner), 503 (partner down), 429 (rate limited) and a dropped
 * connection all mean "no answer yet". Everything else on this endpoint is terminal: 404 is not a
 * code, 410 is a suspended vendor, 409 is a bank account closed at NIBSS — retrying those will
 * never turn them into a payment, and offering a payer a Try again button for them is a lie.
 *
 * The split lives here rather than in each app so the two confirm screens cannot drift apart. Note
 * that this client performs NO automatic retry of its own — the only replay in `request()` is the
 * one-shot 401 → refresh — so this classifies a failure for a human-initiated retry, and any
 * future automatic one must gate on it rather than on `status >= 500`.
 */
const RETRYABLE_STATUSES = new Set([0, 429, 502, 503]);

export function isRetryableVendorCodeError(error: unknown): boolean {
  return error instanceof ApiError && RETRYABLE_STATUSES.has(error.status);
}

export type RecentVendorResponse = {
  id: string;
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  lastUsedAt: string;
  firstSeenAt: string;
};

export class VendorApi {
  constructor(private readonly client: AuthedClient) {}

  nameEnquiry(
    bankCode: string,
    accountNumber: string,
    subWalletId: string,
  ): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ bankCode, accountNumber, subWalletId });
    return this.client.request<ResolvedVendorResponse>(`/vendors/name-enquiry?${params}`);
  }

  phoneLookup(phoneNumber: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ phoneNumber, subWalletId });
    return this.client.request<ResolvedVendorResponse>(`/vendors/phone-lookup?${params}`);
  }

  nqrDecode(payload: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    return this.client.request<ResolvedVendorResponse>('/vendors/nqr-decode', {
      method: 'POST',
      jsonBody: { payload, subWalletId },
    });
  }

  /**
   * Resolve an Amana Vendor Code (`AMNV-XXXXX-XXXXX`) scanned from a vendor's sticker or screen.
   *
   * The code goes through VERBATIM — no trim, no upper-casing, no Crockford fold. All of that is
   * the backend's, in one place: `VendorCodeParams` trims and matches case-insensitively, and
   * `normalizeCrockford` folds I/L→1 and O→0 inside the lookup. A second copy of that fold here
   * would be a copy that drifts, and a client-side fold that disagrees with the server's is worse
   * than none at all. Escaped rather than normalized, so a dirty string reaches the server intact
   * and gets the server's answer.
   *
   * Throws `ApiError` on every non-2xx; see `isRetryableVendorCodeError` for the retryable split.
   */
  vendorCode(code: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ subWalletId });
    return this.client.request<ResolvedVendorResponse>(
      `/vendors/code/${encodeURIComponent(code)}?${params}`,
    );
  }

  async recents(subWalletId: string): Promise<RecentVendorResponse[]> {
    const r = await this.client.request<{ recents: RecentVendorResponse[] }>(
      `/vendors/recents?subWalletId=${encodeURIComponent(subWalletId)}`,
    );
    return r.recents;
  }
}
