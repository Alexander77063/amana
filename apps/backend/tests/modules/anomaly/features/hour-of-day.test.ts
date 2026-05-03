import { describe, expect, it } from 'vitest';
import { hourOfDay } from '../../../../src/modules/anomaly/features/hour-of-day';
import { kobo } from '../../../../src/lib/kobo';

const txn = (iso: string) => ({
  amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
  confirmedAt: new Date(iso),
});

describe('hourOfDay', () => {
  it('returns close to 1 for an hour never seen in history', () => {
    const history = { txns: [
      txn('2026-05-01T12:00:00Z'),
      txn('2026-05-02T12:00:00Z'),
      txn('2026-05-03T12:00:00Z'),
    ]};
    const v = hourOfDay({
      amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-04T03:00:00Z'),
    }, history);
    expect(v).toBeGreaterThan(0.9);
  });

  it('returns close to 0 for an hour that dominates history', () => {
    const history = { txns: Array.from({ length: 50 }, () => txn('2026-05-01T12:00:00Z')) };
    const v = hourOfDay({
      amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-04T12:00:00Z'),
    }, history);
    expect(v).toBeLessThan(0.1);
  });

  it('returns 0.5-ish on empty history (no signal)', () => {
    const v = hourOfDay({
      amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-04T12:00:00Z'),
    }, { txns: [] });
    expect(v).toBeCloseTo(23 / 24, 2);
  });
});
