import { describe, expect, it } from 'vitest';
import { computeCommissionKobo } from '../../../src/modules/vas/commission';

describe('computeCommissionKobo', () => {
  it('airtime 2% of ₦1,000 = ₦20', () => {
    expect(computeCommissionKobo('airtime', 100_000n)).toBe(2_000n);
  });
  it('electricity 1% capped at ₦1,000 for a ₦200,000 bill', () => {
    expect(computeCommissionKobo('electricity', 20_000_000n)).toBe(100_000n); // cap hit
  });
  it('floors to whole kobo (no float)', () => {
    expect(computeCommissionKobo('cabletv', 12_345n)).toBe(148n); // 1.2% of 12345 = 148.14 → 148
  });
  it('never exceeds the amount', () => {
    expect(computeCommissionKobo('airtime', 1n)).toBe(0n);
  });
});
