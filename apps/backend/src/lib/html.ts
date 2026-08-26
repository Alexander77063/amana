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
 * The vendor landing page renders a NIBSS-supplied business name to the public internet. That
 * string is not ours, is not validated at the bank, and reaches an unauthenticated page — which is
 * exactly the shape of an injection that gets found by someone else first.
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
