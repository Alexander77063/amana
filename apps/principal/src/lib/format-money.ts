/**
 * Format a bigint-safe kobo string as Naira, e.g. "482000" → "₦4,820.00".
 * 1 naira = 100 kobo. Uses BigInt parsing so the string is never coerced to
 * a lossy float before the /100 division.
 */
export function formatNaira(amountKoboStr: string): string {
  const kobo = BigInt(amountKoboStr);
  const naira = Number(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
