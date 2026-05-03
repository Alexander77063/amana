import type { Kobo } from '../../lib/kobo';

export const TIER_2_BALANCE_CAP_KOBO = 30_000_000n; // ₦300,000

export type KycInput = {
  role: 'principal' | 'agent';
  kycTier: '1' | '2' | '3';
  balanceKobo: Kobo;
};

export function shouldRecommendKycUpgrade(input: KycInput): boolean {
  if (input.role === 'agent') return false;
  if (input.kycTier === '3') return false;
  if (input.kycTier === '1') return true;
  // Tier 2: trigger upgrade once balance crosses 80% of the cap.
  const threshold = (TIER_2_BALANCE_CAP_KOBO * 80n) / 100n;
  return input.balanceKobo > threshold;
}
