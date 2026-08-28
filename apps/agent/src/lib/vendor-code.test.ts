import { ApiError } from '@amana/api-client';
import { describe, expect, it } from 'vitest';
import { describeScanFailure, parseScannedPayload } from './vendor-code';

const CODE = 'AMNV-7QK2H-9PZ0R';

describe('parseScannedPayload', () => {
  it('reads an Amana code from a pay.amana-ng.com URL', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com/v/${CODE}`)).toEqual({
      kind: 'vendor_code',
      code: CODE,
    });
  });

  it('accepts a bare code, for a non-URL sticker', () => {
    expect(parseScannedPayload(CODE)).toEqual({ kind: 'vendor_code', code: CODE });
  });

  it('accepts http as well as https', () => {
    expect(parseScannedPayload(`http://pay.amana-ng.com/v/${CODE}`)).toEqual({
      kind: 'vendor_code',
      code: CODE,
    });
  });

  it('matches the host case-insensitively, because hostnames are', () => {
    expect(parseScannedPayload(`https://PAY.AMANA-NG.COM/v/${CODE}`)).toEqual({
      kind: 'vendor_code',
      code: CODE,
    });
  });

  it('tolerates a trailing slash and a query string', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com/v/${CODE}/?utm=poster`)).toEqual({
      kind: 'vendor_code',
      code: CODE,
    });
  });

  it('tolerates a fragment', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com/v/${CODE}#x`)).toEqual({
      kind: 'vendor_code',
      code: CODE,
    });
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(parseScannedPayload(`  ${CODE}\n`)).toEqual({ kind: 'vendor_code', code: CODE });
  });

  // ---- verbatim: the client decides the KIND, the server decides the VALUE ----

  it('emits a lowercased URL code VERBATIM — it does not upper-case it', () => {
    // The api-client contract says the code goes through "VERBATIM — no trim, no upper-casing,
    // no Crockford fold", because `normalizeCrockford` on the server is the single place that
    // folds. A second fold here is a fold that can drift.
    const r = parseScannedPayload('https://pay.amana-ng.com/v/amnv-7qk2h-9pz0r');
    expect(r).toEqual({ kind: 'vendor_code', code: 'amnv-7qk2h-9pz0r' });
  });

  it('emits a lowercased BARE code verbatim too', () => {
    expect(parseScannedPayload('amnv-7qk2h-9pz0r')).toEqual({
      kind: 'vendor_code',
      code: 'amnv-7qk2h-9pz0r',
    });
  });

  it('passes confusable glyphs (O, I, L, U) through instead of rejecting them', () => {
    // `normalizeCrockford` folds I/L -> 1 and O -> 0 server-side; the route's own zod regex is
    // `[0-9A-Za-z]{5}` for exactly that reason. A client alphabet that excluded them would send
    // a genuine Amana URL down the NQR branch and surface a TLV parse error to the payer.
    const glyphy = 'AMNV-OIL7U-9PZ0R';
    expect(parseScannedPayload(`https://pay.amana-ng.com/v/${glyphy}`)).toEqual({
      kind: 'vendor_code',
      code: glyphy,
    });
    expect(parseScannedPayload(glyphy)).toEqual({ kind: 'vendor_code', code: glyphy });
  });

  // ---- the discrimination must actually discriminate ----

  it('does NOT treat a lookalike host as an Amana code', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com.evil.com/v/${CODE}`).kind).toBe('nqr');
  });

  it('does NOT treat our host appearing in a path as an Amana code', () => {
    expect(parseScannedPayload(`https://evil.com/pay.amana-ng.com/v/${CODE}`).kind).toBe('nqr');
  });

  it('does NOT match a userinfo-prefixed authority', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com@evil.com/v/${CODE}`).kind).toBe('nqr');
  });

  it('does NOT match a different path prefix on our host', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com/vendor/${CODE}`).kind).toBe('nqr');
  });

  it('does NOT match extra path segments after the code', () => {
    expect(parseScannedPayload(`https://pay.amana-ng.com/v/${CODE}/pay`).kind).toBe('nqr');
  });

  it('falls through to nqr for a NIBSS TLV payload', () => {
    const tlv = '26200008NG.NIBSS0103058';
    expect(parseScannedPayload(tlv)).toEqual({ kind: 'nqr', payload: tlv });
  });

  it('falls through to nqr for a bare string that is not the code shape', () => {
    expect(parseScannedPayload('AMNV-123-456')).toEqual({ kind: 'nqr', payload: 'AMNV-123-456' });
  });

  it('falls through to nqr for anything else', () => {
    expect(parseScannedPayload('https://example.com/x')).toEqual({
      kind: 'nqr',
      payload: 'https://example.com/x',
    });
  });

  it('falls through to nqr for an empty payload', () => {
    expect(parseScannedPayload('')).toEqual({ kind: 'nqr', payload: '' });
  });
});

const apiError = (status: number, code: string) => ApiError.fromResponse(status, { error: code });

/** Every rung's copy, keyed by status, so a collapse between two rungs is visible. */
function copyFor(status: number, code: string): string {
  return describeScanFailure(apiError(status, code), 'vendor_code').message;
}

describe('describeScanFailure — the vendor-code error ladder', () => {
  it('404: tells the payer this is not an Amana code', () => {
    const r = describeScanFailure(apiError(404, 'NOT_FOUND'), 'vendor_code');
    expect(r.message).toMatch(/not an Amana code/i);
    expect(r.retryable).toBe(false);
  });

  it('410: tells the payer the shop cannot be paid through Amana right now', () => {
    const r = describeScanFailure(apiError(410, 'VENDOR_SUSPENDED'), 'vendor_code');
    expect(r.message).toMatch(/cannot be paid through Amana right now/i);
    expect(r.retryable).toBe(false);
  });

  it("409: tells the payer the shop's bank account is closed", () => {
    const r = describeScanFailure(apiError(409, 'VENDOR_ACCOUNT_GONE'), 'vendor_code');
    expect(r.message).toMatch(/bank account is closed/i);
    expect(r.message).toMatch(/their bank/i);
    expect(r.retryable).toBe(false);
  });

  it('502: says we could not reach the partner, and is retryable', () => {
    const r = describeScanFailure(apiError(502, 'VENDOR_ENQUIRY_FAILED'), 'vendor_code');
    expect(r.message).toMatch(/could not reach/i);
    expect(r.retryable).toBe(true);
  });

  it('503: retryable, and deliberately shares 502 copy — one outcome, one sentence', () => {
    const r = describeScanFailure(apiError(503, 'PARTNER_DOWN'), 'vendor_code');
    expect(r.retryable).toBe(true);
    expect(r.message).toBe(copyFor(502, 'VENDOR_ENQUIRY_FAILED'));
  });

  it('429: tells the payer to wait, and is retryable', () => {
    const r = describeScanFailure(apiError(429, 'rate_limited'), 'vendor_code');
    expect(r.message).toMatch(/too many/i);
    expect(r.retryable).toBe(true);
    // Not the partner-down sentence — a rate limit is our doing, not the bank's.
    expect(r.message).not.toBe(copyFor(502, 'VENDOR_ENQUIRY_FAILED'));
  });

  it('403: terminal, and does NOT claim the code is unknown', () => {
    const r = describeScanFailure(apiError(403, 'forbidden'), 'vendor_code');
    expect(r.retryable).toBe(false);
    expect(r.message).not.toBe(copyFor(404, 'NOT_FOUND'));
    expect(r.message).not.toMatch(/not an Amana code/i);
  });

  it('400: a malformed code is the same fact to a payer as an unknown one', () => {
    const r = describeScanFailure(apiError(400, 'validation_error'), 'vendor_code');
    expect(r.retryable).toBe(false);
    expect(r.message).toBe(copyFor(404, 'NOT_FOUND'));
  });

  it('0 (transport failure): blames the connection, and is retryable', () => {
    const r = describeScanFailure(ApiError.network(new Error('offline')), 'vendor_code');
    expect(r.message).toMatch(/connection|network/i);
    expect(r.retryable).toBe(true);
  });

  it('a non-ApiError throw is terminal, and never leaks the raw message', () => {
    const r = describeScanFailure(new TypeError('undefined is not a function'), 'vendor_code');
    expect(r.retryable).toBe(false);
    expect(r.message).not.toContain('undefined is not a function');
  });

  it('gives every terminal rung a DISTINCT sentence', () => {
    const terminal = [
      copyFor(404, 'NOT_FOUND'),
      copyFor(410, 'VENDOR_SUSPENDED'),
      copyFor(409, 'VENDOR_ACCOUNT_GONE'),
      copyFor(403, 'forbidden'),
    ];
    expect(new Set(terminal).size).toBe(terminal.length);
  });

  it('offers a retry on exactly the retryable statuses and no others', () => {
    const retryable = [0, 429, 502, 503];
    const terminal = [400, 403, 404, 409, 410, 422, 500];
    for (const s of retryable) {
      expect(describeScanFailure(apiError(s, 'x'), 'vendor_code').retryable).toBe(true);
    }
    for (const s of terminal) {
      expect(describeScanFailure(apiError(s, 'x'), 'vendor_code').retryable).toBe(false);
    }
  });
});

describe('describeScanFailure — the NQR branch', () => {
  it('does not reuse the vendor-code copy for a 400 from the NQR decoder', () => {
    const r = describeScanFailure(apiError(400, 'BAD_INPUT'), 'nqr');
    expect(r.message).not.toMatch(/Amana code/i);
    expect(r.message).toMatch(/could not read/i);
    expect(r.retryable).toBe(false);
  });

  it('still treats a transport failure as retryable on the NQR branch', () => {
    expect(describeScanFailure(ApiError.network(new Error('offline')), 'nqr').retryable).toBe(true);
  });
});
