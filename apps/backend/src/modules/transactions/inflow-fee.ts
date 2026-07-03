import { type Kobo, kobo } from '../../lib/kobo';

/** Anchor's inflow (collection) fee: 0.5% of the load, capped at ₦500 — the gross fee to be split. */
export const INFLOW_FEE_RATE_BPS = 50n; // 50 basis points = 0.50%
export const INFLOW_FEE_CAP_KOBO: Kobo = kobo(50_000n); // ₦500 per load

/**
 * Amana's monthly absorption cap per wallet: Amana eats the inflow fee up to this each calendar
 * month; the user pays anything above. Pure whale insurance (₦6,000 > a heavy shop's ~₦5,000/mo
 * gross, so it is invisible to every modeled persona).
 */
export const INFLOW_ABSORPTION_CAP_KOBO: Kobo = kobo(600_000n); // ₦6,000 / wallet / calendar month

/** Round-half-up integer division. Both args must be positive. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/**
 * The gross Anchor inflow fee for a top-up of `amountKobo`: 0.5% (basis points / 10,000) of the
 * amount, rounded half-up, capped at ₦500. Pure integer kobo math — never floats.
 */
export function computeInflowFeeKobo(amountKobo: Kobo): Kobo {
  if (amountKobo <= 0n) return kobo(0n);
  const fee = roundDiv(amountKobo * INFLOW_FEE_RATE_BPS, 10_000n);
  return kobo(fee > (INFLOW_FEE_CAP_KOBO as bigint) ? (INFLOW_FEE_CAP_KOBO as bigint) : fee);
}

/**
 * Split the gross inflow `feeKobo` into the part Amana absorbs (up to the ₦6,000/wallet/month cap)
 * and the part charged to the user. `mtdAbsorbedKobo` is this wallet's month-to-date absorbed total
 * (Africa/Lagos calendar month), BEFORE this top-up. Pure integer kobo math.
 */
export function splitInflowFee(
  feeKobo: Kobo,
  mtdAbsorbedKobo: Kobo,
): { absorbedKobo: Kobo; chargedKobo: Kobo } {
  const remaining = (INFLOW_ABSORPTION_CAP_KOBO as bigint) - (mtdAbsorbedKobo as bigint);
  const headroom = remaining > 0n ? remaining : 0n;
  const fee = feeKobo as bigint;
  const absorbed = fee <= headroom ? fee : headroom;
  return { absorbedKobo: kobo(absorbed), chargedKobo: kobo(fee - absorbed) };
}
