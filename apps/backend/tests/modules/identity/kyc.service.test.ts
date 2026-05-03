import { describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import {
  shouldRecommendKycUpgrade,
  TIER_2_BALANCE_CAP_KOBO,
} from '../../../src/modules/identity/kyc.service';

describe('kyc.service.shouldRecommendKycUpgrade', () => {
  it('returns false for an agent (no balance, no tier promotion path)', () => {
    expect(shouldRecommendKycUpgrade({ role: 'agent', kycTier: '1', balanceKobo: kobo(0n) })).toBe(false);
  });

  it('returns false for principal at Tier 3 (already topped out)', () => {
    expect(
      shouldRecommendKycUpgrade({ role: 'principal', kycTier: '3', balanceKobo: kobo(50_000_000n) }),
    ).toBe(false);
  });

  it('returns true for principal at Tier 2 above 80% of cap', () => {
    const eightyPct = (TIER_2_BALANCE_CAP_KOBO * 81n) / 100n;
    expect(shouldRecommendKycUpgrade({ role: 'principal', kycTier: '2', balanceKobo: kobo(eightyPct) })).toBe(true);
  });

  it('returns false for principal at Tier 2 below 80% of cap', () => {
    const halfCap = TIER_2_BALANCE_CAP_KOBO / 2n;
    expect(shouldRecommendKycUpgrade({ role: 'principal', kycTier: '2', balanceKobo: kobo(halfCap) })).toBe(false);
  });

  it('returns true for principal at Tier 1 (rare; should always upgrade)', () => {
    expect(
      shouldRecommendKycUpgrade({ role: 'principal', kycTier: '1', balanceKobo: kobo(0n) }),
    ).toBe(true);
  });

  it('TIER_2_BALANCE_CAP_KOBO is ₦300,000 (= 30,000,000 kobo)', () => {
    expect(TIER_2_BALANCE_CAP_KOBO).toBe(30_000_000n);
  });
});
