import { describe, expect, it } from 'vitest';
import { anomalyService } from '../../../src/modules/anomaly/anomaly.service';
import { kobo } from '../../../src/lib/kobo';

describe('anomalyService.score', () => {
  it('returns ~0.5 score for empty history + neutral intent', () => {
    const result = anomalyService.score({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns: [] });
    // Empty history: amount-zscore=0, hour-of-day≈0.958, vendor-novelty=1, velocity=0
    // Average ≈ (0 + 0.958 + 1 + 0) / 4 ≈ 0.49
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThan(0.55);
    expect(result.features).toHaveLength(4);
  });

  it('returns a score in [0, 1]', () => {
    for (let i = 0; i < 20; i++) {
      const result = anomalyService.score({
        amountKobo: kobo(BigInt(i * 100)), vendorBankCode: '058', vendorAccountNumber: String(i),
        confirmedAt: new Date(`2026-05-03T${String(i % 24).padStart(2, '0')}:00:00Z`),
      }, { txns: [] });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it('applies custom weights', () => {
    const intent = {
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    };
    // All-zero weights except vendor-novelty=1: score should equal vendor-novelty
    const r = anomalyService.score(intent, { txns: [] }, {
      weights: { amount_zscore: 0, hour_of_day: 0, vendor_novelty: 1, velocity: 0 },
    });
    expect(r.score).toBe(1);
  });
});
