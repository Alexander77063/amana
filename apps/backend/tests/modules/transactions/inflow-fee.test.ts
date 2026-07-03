import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import {
  INFLOW_ABSORPTION_CAP_KOBO,
  INFLOW_FEE_CAP_KOBO,
  computeInflowFeeKobo,
  splitInflowFee,
} from '../../../src/modules/transactions/inflow-fee';

describe('computeInflowFeeKobo', () => {
  it('is 0.5% of the load below the cap', () => {
    // ₦10,000 load -> ₦50 fee
    expect(computeInflowFeeKobo(kobo(1_000_000n))).toBe(kobo(5_000n));
    // ₦40,000 load -> ₦200 fee
    expect(computeInflowFeeKobo(kobo(4_000_000n))).toBe(kobo(20_000n));
  });

  it('caps at ₦500 (reached at a ₦100,000 load)', () => {
    expect(computeInflowFeeKobo(kobo(10_000_000n))).toBe(INFLOW_FEE_CAP_KOBO); // exactly ₦500
    expect(computeInflowFeeKobo(kobo(50_000_000n))).toBe(INFLOW_FEE_CAP_KOBO); // ₦500,000 load -> still ₦500
  });

  it('is 0 for a non-positive amount', () => {
    expect(computeInflowFeeKobo(kobo(0n))).toBe(kobo(0n));
  });

  it('rounds half-up on the kobo', () => {
    // ₦1,999.99 load = 199_999 kobo; 0.5% = 999.995 kobo -> rounds to 1000
    expect(computeInflowFeeKobo(kobo(199_999n))).toBe(kobo(1_000n));
  });

  it('property: 0 <= fee <= min(cap, amount) for any non-negative amount', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), (amt) => {
        const fee = computeInflowFeeKobo(kobo(amt));
        return fee >= 0n && fee <= INFLOW_FEE_CAP_KOBO && fee <= amt;
      }),
    );
  });
});

describe('splitInflowFee (₦6,000/wallet/month absorption cap)', () => {
  it('absorbs the whole fee when well under the cap', () => {
    const { absorbedKobo, chargedKobo } = splitInflowFee(kobo(20_000n), kobo(0n)); // ₦200 fee, ₦0 MTD
    expect(absorbedKobo).toBe(kobo(20_000n));
    expect(chargedKobo).toBe(kobo(0n));
  });

  it('splits the fee when it crosses the cap', () => {
    // MTD ₦5,950 absorbed → ₦50 headroom; a ₦200 fee → ₦50 absorbed, ₦150 charged.
    const { absorbedKobo, chargedKobo } = splitInflowFee(kobo(20_000n), kobo(595_000n));
    expect(absorbedKobo).toBe(kobo(5_000n));
    expect(chargedKobo).toBe(kobo(15_000n));
  });

  it('charges the whole fee once the cap is already reached', () => {
    const { absorbedKobo, chargedKobo } = splitInflowFee(kobo(20_000n), INFLOW_ABSORPTION_CAP_KOBO);
    expect(absorbedKobo).toBe(kobo(0n));
    expect(chargedKobo).toBe(kobo(20_000n));
  });

  it('absorbs exactly up to the cap at the boundary', () => {
    // MTD ₦5,999 → ₦1 headroom; ₦200 fee → ₦1 absorbed, ₦199 charged.
    const { absorbedKobo, chargedKobo } = splitInflowFee(kobo(20_000n), kobo(599_900n));
    expect(absorbedKobo).toBe(kobo(100n));
    expect(chargedKobo).toBe(kobo(19_900n));
  });

  it('property: absorbed + charged == fee, and absorbed never exceeds headroom', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 50_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        (fee, mtd) => {
          const { absorbedKobo, chargedKobo } = splitInflowFee(kobo(fee), kobo(mtd));
          const headroom = 600_000n - mtd > 0n ? 600_000n - mtd : 0n;
          return (
            absorbedKobo + chargedKobo === fee &&
            absorbedKobo >= 0n &&
            chargedKobo >= 0n &&
            absorbedKobo <= headroom
          );
        },
      ),
    );
  });
});
