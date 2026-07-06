import { VAS_COMMISSION, type VasCategory } from './config';

/**
 * Expected reseller commission in kobo: `floor(amount * bps / 10000)`, capped, and never > amount.
 * All-bigint (no float). Anchor's response value is authoritative at settle; this is the fallback/quote.
 */
export function computeCommissionKobo(category: VasCategory, amountKobo: bigint): bigint {
  const { bps, capKobo } = VAS_COMMISSION[category];
  let c = (amountKobo * BigInt(bps)) / 10_000n; // floor via integer division
  if (capKobo !== null && c > capKobo) c = capKobo;
  if (c > amountKobo) c = amountKobo;
  return c;
}
