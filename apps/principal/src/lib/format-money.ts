/**
 * Format a bigint-safe kobo string as Naira, e.g. "482000" → "₦4,820.00".
 * 1 naira = 100 kobo. Pure integer (BigInt) math — the value is never coerced to
 * a float — so it is exact at any magnitude. Always renders 2 decimal places.
 * Assumes a non-negative amount (kobo strings from our backend always are).
 */
export function formatNaira(amountKoboStr: string): string {
  const kobo = BigInt(amountKoboStr);
  const naira = kobo / 100n;
  const remainder = kobo % 100n;
  return `₦${naira.toLocaleString('en-NG')}.${remainder.toString().padStart(2, '0')}`;
}
