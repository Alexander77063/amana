import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { vendorNovelty } from '../../../../src/modules/anomaly/features/vendor-novelty';

const txn = (bank: string | null, acct: string | null) => ({
  amountKobo: kobo(0n),
  vendorBankCode: bank,
  vendorAccountNumber: acct,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
});

describe('vendorNovelty', () => {
  it('returns 1.0 when vendor never seen', () => {
    const v = vendorNovelty(
      {
        amountKobo: kobo(0n),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        confirmedAt: new Date(),
      },
      { txns: [txn('058', '9999999999'), txn('058', '8888888888')] },
    );
    expect(v).toBe(1);
  });

  it('returns 0 when vendor seen at least 5 times (familiar)', () => {
    const history = { txns: Array.from({ length: 5 }, () => txn('058', '0123456789')) };
    const v = vendorNovelty(
      {
        amountKobo: kobo(0n),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        confirmedAt: new Date(),
      },
      history,
    );
    expect(v).toBe(0);
  });

  it('decreases linearly between 1 and 5 prior sightings', () => {
    const history = { txns: [txn('058', '0123456789'), txn('058', '0123456789')] };
    const v = vendorNovelty(
      {
        amountKobo: kobo(0n),
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        confirmedAt: new Date(),
      },
      history,
    );
    expect(v).toBeCloseTo(0.6, 5);
  });

  it('returns 1.0 when intent has no vendor info', () => {
    const v = vendorNovelty(
      {
        amountKobo: kobo(0n),
        vendorBankCode: null,
        vendorAccountNumber: null,
        confirmedAt: new Date(),
      },
      { txns: [] },
    );
    expect(v).toBe(1);
  });
});
