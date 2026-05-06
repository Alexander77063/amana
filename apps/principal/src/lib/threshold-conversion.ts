/**
 * Threshold-input conversions for NotificationKindDetailScreen.
 * - Amount kinds (txn_settled, txn_failed): naira ↔ kobo, BigInt-safe over the wire.
 * - Anomaly kind: percent (0–100) ↔ percent×100 in thresholdKobo (mirrors backend prefs.service).
 *
 * All input-side functions return null on invalid/empty/out-of-range; callers ignore null
 * so the user can correct the input.
 */

export function nairaInputToKoboString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const naira = Number(trimmed);
  if (!Number.isFinite(naira) || naira < 0) return null;
  return Math.round(naira * 100).toString();
}

export function koboToNairaDisplay(kobo: string | null): string {
  if (kobo === null) return '';
  const kn = BigInt(kobo);
  const naira = kn / 100n;
  const remainder = kn % 100n;
  if (remainder === 0n) return naira.toString();
  return `${naira}.${remainder.toString().padStart(2, '0')}`;
}

export function thresholdKoboToScorePercentDisplay(kobo: string | null): string {
  if (kobo === null) return '';
  return (Number(kobo) / 100).toString();
}

export function scorePercentInputToThresholdKobo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.round(pct * 100).toString();
}
