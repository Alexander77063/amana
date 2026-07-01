import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import {
  INFLOW_FEE_CAP_KOBO,
  computeInflowFeeAbsorbedKobo,
} from '../../../src/modules/transactions/inflow-fee';

describe('computeInflowFeeAbsorbedKobo', () => {
  it('is 0.5% of the load below the cap', () => {
    // ₦10,000 load -> ₦50 fee
    expect(computeInflowFeeAbsorbedKobo(kobo(1_000_000n))).toBe(kobo(5_000n));
    // ₦40,000 load -> ₦200 fee
    expect(computeInflowFeeAbsorbedKobo(kobo(4_000_000n))).toBe(kobo(20_000n));
  });

  it('caps at ₦500 (reached at a ₦100,000 load)', () => {
    expect(computeInflowFeeAbsorbedKobo(kobo(10_000_000n))).toBe(INFLOW_FEE_CAP_KOBO); // exactly ₦500
    expect(computeInflowFeeAbsorbedKobo(kobo(50_000_000n))).toBe(INFLOW_FEE_CAP_KOBO); // ₦500,000 load -> still ₦500
  });

  it('is 0 for a non-positive amount', () => {
    expect(computeInflowFeeAbsorbedKobo(kobo(0n))).toBe(kobo(0n));
  });

  it('rounds half-up on the kobo', () => {
    // ₦1,999.99 load = 199_999 kobo; 0.5% = 999.995 kobo -> rounds to 1000
    expect(computeInflowFeeAbsorbedKobo(kobo(199_999n))).toBe(kobo(1_000n));
  });

  it('property: 0 <= fee <= min(cap, amount) for any non-negative amount', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), (amt) => {
        const fee = computeInflowFeeAbsorbedKobo(kobo(amt));
        return fee >= 0n && fee <= INFLOW_FEE_CAP_KOBO && fee <= amt;
      }),
    );
  });
});
