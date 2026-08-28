import { ApiError, isRetryableVendorCodeError } from '@amana/api-client';

export type ScannedPayload =
  | { kind: 'vendor_code'; code: string }
  | { kind: 'nqr'; payload: string };

/**
 * The bare-code form, mirroring the server's own `VendorCodeParams` regex character-for-character
 * (`apps/backend/src/routes/vendors.ts`).
 *
 * Deliberately `[0-9A-Za-z]`, NOT the Crockford alphabet: `normalizeCrockford` folds `I`/`L`→`1`
 * and `O`→`0` server-side, so a code carrying one of those glyphs is a resolvable code. A client
 * class that excluded them would send a genuine Amana payload down the NQR branch and hand the
 * payer a TLV parse error for a perfectly good sticker.
 */
const BARE_CODE_RE = /^AMNV-[0-9A-Za-z]{5}-[0-9A-Za-z]{5}$/i;

/**
 * Anchored to the exact authority. A substring or `includes` check would accept
 * `pay.amana-ng.com.evil.com`, `evil.com/pay.amana-ng.com/v/…` and `pay.amana-ng.com@evil.com`, letting a
 * stranger's QR be read as one of ours — and the whole point of this branch is deciding which of
 * our endpoints to trust a payload with.
 *
 * The captured segment is passed through untouched and left for the server to validate: on our own
 * host and our own path, a malformed code is still "an Amana code that is wrong", and answering it
 * with the code ladder's 404 copy beats answering it with a QR-decoder error. The lookup is a
 * database read before it is anything else, so a bogus code costs a 404, never a paid enquiry.
 */
const CODE_URL_RE = /^https?:\/\/pay\.amana-ng\.com\/v\/([^/?#\s]{1,64})\/?(?:[?#].*)?$/i;

/**
 * Decide what a scanned QR actually is.
 *
 * One camera reads both an Amana Vendor Code and a bank NQR, so the discrimination happens on the
 * payload's SHAPE rather than by asking the agent to pick the right scanner first — at a market
 * stall, "which kind of QR is this?" is a worse question than it sounds. Shape, and not
 * try-one-endpoint-then-the-other: a fallback would fire a paid partner call on every mis-scan.
 *
 * The code is emitted VERBATIM. The server trims, folds case and folds the confusable glyphs, in
 * one place, on purpose; a second fold here is a fold that can drift, and a client fold that
 * disagrees with the server's is worse than no fold at all. (Trimming the whole payload before
 * deciding is not that fold — it changes which branch we take, never the characters we send.)
 *
 * Anything unrecognised falls through to `nqr`, which is the safe default: the NQR decoder already
 * returns a clean `BAD_INPUT` for garbage, so an unknown payload produces a sensible error rather
 * than a silent no-op.
 */
export function parseScannedPayload(raw: string): ScannedPayload {
  const trimmed = raw.trim();

  const fromUrl = CODE_URL_RE.exec(trimmed);
  if (fromUrl?.[1]) return { kind: 'vendor_code', code: fromUrl[1] };

  if (BARE_CODE_RE.test(trimmed)) return { kind: 'vendor_code', code: trimmed };

  return { kind: 'nqr', payload: trimmed };
}

export type ScanFailure = {
  /** One sentence, addressed to a payer standing in a shop. */
  message: string;
  /** Whether a Try again button should be offered at all. */
  retryable: boolean;
};

const NO_CONNECTION = 'No connection. Check your network and try again.';
const RATE_LIMITED = 'Too many scans just now. Wait a few seconds and try again.';
const PARTNER_UNREACHABLE = 'We could not reach our banking partner. Try again in a moment.';
const NOT_AN_AMANA_CODE =
  'That is not an Amana code. Ask the vendor for their bank account instead.';
const VENDOR_SUSPENDED =
  'This shop cannot be paid through Amana right now. Ask them for their bank account instead.';
const VENDOR_ACCOUNT_GONE =
  "This shop's bank account is closed. They need to sort it out with their bank.";
const UNREADABLE_QR = 'We could not read that QR code. Try another, or enter the account number.';
const GENERIC = 'Something went wrong with that scan. Start the payment again.';

/**
 * Turn a thrown resolution failure into the sentence a payer should read, and a verdict on whether
 * a Try again button belongs under it.
 *
 * Each rung of `GET /vendors/code/:code` means something different to the person holding the
 * phone, and the difference is the whole reason the route refuses to collapse its statuses (see
 * the comment at that handler). Two collapses here are deliberate, not oversights:
 *
 * - **502 and 503 share a sentence.** They differ in whose fault it is upstream, which is not the
 *   payer's business; the outcome — wait and try again — is identical, and inventing a distinction
 *   would be writing copy for a difference the reader cannot act on.
 * - **400 and 404 share a sentence.** "Malformed code" and "unknown code" are one fact to a payer:
 *   the thing they scanned is not an Amana code.
 *
 * `retryable` is delegated to `isRetryableVendorCodeError` rather than re-derived, so the two apps
 * and any future automatic retry cannot drift on which failures are worth repeating. A payer
 * standing in a shop tapping Try again on a suspended vendor is exactly the failure this prevents.
 */
export function describeScanFailure(error: unknown, kind: ScannedPayload['kind']): ScanFailure {
  const status = error instanceof ApiError ? error.status : null;
  const retryable = isRetryableVendorCodeError(error);

  // Transport- and capacity-level facts read the same whichever payload we were resolving.
  if (status === 0) return { message: NO_CONNECTION, retryable };
  if (status === 429) return { message: RATE_LIMITED, retryable };
  if (status === 502 || status === 503) return { message: PARTNER_UNREACHABLE, retryable };

  // `/vendors/nqr-decode` answers every resolver failure with a flat 400, so there is no ladder to
  // read on this branch — and borrowing the code ladder's copy would tell someone who scanned a
  // bank QR that it "is not an Amana code", which is both true and useless.
  if (kind === 'nqr') return { message: UNREADABLE_QR, retryable };

  switch (status) {
    case 400:
    case 404:
      return { message: NOT_AN_AMANA_CODE, retryable };
    case 410:
      return { message: VENDOR_SUSPENDED, retryable };
    case 409:
      return { message: VENDOR_ACCOUNT_GONE, retryable };
    default:
      // 403 lands here. It should be unreachable — the sub-wallet was chosen by this app, from
      // this user's own store — so it is an error, not a story: no copy claims the code is
      // unknown, and nothing invites a retry that would fail identically. Raw thrown messages are
      // never surfaced; `BAD_INPUT`'s names our banking partner verbatim.
      return { message: GENERIC, retryable };
  }
}
