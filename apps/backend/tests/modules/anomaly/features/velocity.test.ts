import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { velocity } from '../../../../src/modules/anomaly/features/velocity';

const txn = (iso: string) => ({
  amountKobo: kobo(0n),
  vendorBankCode: null,
  vendorAccountNumber: null,
  confirmedAt: new Date(iso),
});

describe('velocity', () => {
  it('returns 0 with no recent txns', () => {
    const v = velocity(
      {
        amountKobo: kobo(0n),
        vendorBankCode: null,
        vendorAccountNumber: null,
        confirmedAt: new Date('2026-05-03T12:00:00Z'),
      },
      { txns: [] },
    );
    expect(v).toBe(0);
  });

  it('returns 1.0 when ≥10 txns in the last hour', () => {
    const txns = Array.from({ length: 10 }, (_, i) =>
      txn(`2026-05-03T11:${String(i).padStart(2, '0')}:00Z`),
    );
    const v = velocity(
      {
        amountKobo: kobo(0n),
        vendorBankCode: null,
        vendorAccountNumber: null,
        confirmedAt: new Date('2026-05-03T12:00:00Z'),
      },
      { txns },
    );
    expect(v).toBe(1);
  });

  it('linearly scales between 0 and 10', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      txn(`2026-05-03T11:${String(i * 5).padStart(2, '0')}:00Z`),
    );
    const v = velocity(
      {
        amountKobo: kobo(0n),
        vendorBankCode: null,
        vendorAccountNumber: null,
        confirmedAt: new Date('2026-05-03T12:00:00Z'),
      },
      { txns },
    );
    expect(v).toBe(0.5);
  });

  it('ignores txns older than 1 hour', () => {
    const txns = Array.from({ length: 10 }, () => txn('2026-05-02T12:00:00Z'));
    const v = velocity(
      {
        amountKobo: kobo(0n),
        vendorBankCode: null,
        vendorAccountNumber: null,
        confirmedAt: new Date('2026-05-03T12:00:00Z'),
      },
      { txns },
    );
    expect(v).toBe(0);
  });
});
