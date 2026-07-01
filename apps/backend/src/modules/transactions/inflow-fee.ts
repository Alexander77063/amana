import { type Kobo, kobo } from '../../lib/kobo';

/** Anchor's inflow (collection) fee that Amana absorbs: 0.5% of the load, capped at ₦500. */
export const INFLOW_FEE_RATE_BPS = 50n; // 50 basis points = 0.50%
export const INFLOW_FEE_CAP_KOBO: Kobo = kobo(50_000n); // ₦500

/** Round-half-up integer division. Both args must be positive. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/**
 * The Anchor inflow fee Amana absorbs for a top-up of `amountKobo`:
 * 0.5% (basis points / 10,000) of the amount, rounded half-up, capped at ₦500.
 * Pure integer kobo math — never floats.
 */
export function computeInflowFeeAbsorbedKobo(amountKobo: Kobo): Kobo {
  if (amountKobo <= 0n) return kobo(0n);
  const fee = roundDiv(amountKobo * INFLOW_FEE_RATE_BPS, 10_000n);
  return kobo(fee > (INFLOW_FEE_CAP_KOBO as bigint) ? (INFLOW_FEE_CAP_KOBO as bigint) : fee);
}
