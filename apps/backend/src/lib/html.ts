const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape text for interpolation into HTML.
 *
 * The vendor landing page renders a business name to the public internet, and that name's
 * provenance depends on which rail claimed the vendor:
 *
 * - Self-service (`vendorClaimService.verify`): the name NIBSS returned for the account, written
 *   at claim time from the same enquiry that proved ownership. Bank-confirmed.
 * - Ops (`routes/vendors-admin.ts` `approve-claim`): still the observation-derived name, which
 *   traces back to `vendorResolvedName` on a payer's `POST /transactions/intent`. Operator-
 *   reviewed, never bank-confirmed. That rail exists because the NIBSS enquiry refused, so it has
 *   no bank name to write.
 *
 * Either way the string is not ours, is not authored by us, and reaches an unauthenticated page —
 * which is exactly the shape of an injection that gets found by someone else first. Escaping does
 * not care which rail it came from, and must not start to: the day someone decides one source is
 * "trusted enough" to interpolate raw is the day this page grows an XSS.
 *
 * `&` is replaced first by virtue of being in the same single pass: a two-pass implementation that
 * escaped `<` before `&` would turn `&lt;` into `&amp;lt;` and double-encode every legitimate
 * ampersand in a trading name.
 *
 * This is escaping for TEXT and for double-quoted attribute values, which is all this page needs.
 * It is not safe for unquoted attributes, `href`/`src` values, inline JavaScript or CSS contexts —
 * the page deliberately has none of those, and adding one means adding the matching encoder too.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ENTITIES[ch] ?? ch);
}
