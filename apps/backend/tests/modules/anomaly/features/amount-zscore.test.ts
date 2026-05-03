import { describe, expect, it } from 'vitest';
import { amountZscore } from '../../../../src/modules/anomaly/features/amount-zscore';
import { kobo } from '../../../../src/lib/kobo';

describe('amountZscore', () => {
  const txn = (amount: bigint) => ({
    amountKobo: kobo(amount),
    vendorAccountNumber: null,
    vendorBankCode: null,
    confirmedAt: new Date('2026-05-03T12:00:00Z'),
  });

  it('returns 0 when no history', () => {
    expect(amountZscore({
      amountKobo: kobo(50_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns: [] })).toBe(0);
  });

  it('returns 0 when amount equals historical mean', () => {
    const history = { txns: [txn(10_000n), txn(10_000n), txn(10_000n)] };
    expect(amountZscore({
      amountKobo: kobo(10_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, history)).toBe(0);
  });

  it('returns ~0.25 for a 1-sigma deviation', () => {
    const history = { txns: [txn(8_000n), txn(10_000n), txn(12_000n)] };
    const v = amountZscore({
      amountKobo: kobo(12_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, history);
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThan(0.4);
  });

  it('caps at 1.0 for very-large deviations (degenerate stddev → 1.0)', () => {
    const history = { txns: [txn(10_000n), txn(10_000n), txn(10_000n)] };
    const v = amountZscore({
      amountKobo: kobo(1_000_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, history);
    expect(v).toBe(1);
  });
});
