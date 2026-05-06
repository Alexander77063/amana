import { describe, expect, it } from 'vitest';
import {
  koboToNairaDisplay,
  nairaInputToKoboString,
  scorePercentInputToThresholdKobo,
  thresholdKoboToScorePercentDisplay,
} from './threshold-conversion';

describe('nairaInputToKoboString', () => {
  it('converts whole naira to kobo', () => {
    expect(nairaInputToKoboString('5000')).toBe('500000');
  });

  it('converts decimal naira to kobo with rounding', () => {
    expect(nairaInputToKoboString('5000.50')).toBe('500050');
    expect(nairaInputToKoboString('1.99')).toBe('199');
  });

  it('returns null on empty / whitespace input', () => {
    expect(nairaInputToKoboString('')).toBeNull();
    expect(nairaInputToKoboString('   ')).toBeNull();
  });

  it('returns null on non-numeric input', () => {
    expect(nairaInputToKoboString('abc')).toBeNull();
    expect(nairaInputToKoboString('1.2.3')).toBeNull();
  });

  it('returns null on negative input', () => {
    expect(nairaInputToKoboString('-50')).toBeNull();
  });

  it('handles zero', () => {
    expect(nairaInputToKoboString('0')).toBe('0');
  });
});

describe('koboToNairaDisplay', () => {
  it('returns empty string for null', () => {
    expect(koboToNairaDisplay(null)).toBe('');
  });

  it('shows whole number when no remainder', () => {
    expect(koboToNairaDisplay('500000')).toBe('5000');
    expect(koboToNairaDisplay('100')).toBe('1');
  });

  it('shows two-decimal precision when remainder is present', () => {
    expect(koboToNairaDisplay('500050')).toBe('5000.50');
    expect(koboToNairaDisplay('199')).toBe('1.99');
  });

  it('zero-pads single-digit remainder', () => {
    expect(koboToNairaDisplay('501')).toBe('5.01');
  });

  it('handles BigInt-range values past Number.MAX_SAFE_INTEGER', () => {
    // 10^13 kobo = 10^11 naira; well within BigInt territory.
    expect(koboToNairaDisplay('10000000000000')).toBe('100000000000');
  });
});

describe('thresholdKoboToScorePercentDisplay', () => {
  it('returns empty string for null', () => {
    expect(thresholdKoboToScorePercentDisplay(null)).toBe('');
  });

  it('converts thresholdKobo (percent×100) back to percent', () => {
    expect(thresholdKoboToScorePercentDisplay('8500')).toBe('85');
    expect(thresholdKoboToScorePercentDisplay('5000')).toBe('50');
    expect(thresholdKoboToScorePercentDisplay('0')).toBe('0');
  });

  it('preserves fractional percent', () => {
    expect(thresholdKoboToScorePercentDisplay('8550')).toBe('85.5');
  });
});

describe('scorePercentInputToThresholdKobo', () => {
  it('converts integer percent to percent×100', () => {
    expect(scorePercentInputToThresholdKobo('85')).toBe('8500');
    expect(scorePercentInputToThresholdKobo('0')).toBe('0');
    expect(scorePercentInputToThresholdKobo('100')).toBe('10000');
  });

  it('rounds decimal percent', () => {
    expect(scorePercentInputToThresholdKobo('85.5')).toBe('8550');
    // 99.999 is in-range (≤100); rounds up to 10000.
    expect(scorePercentInputToThresholdKobo('99.999')).toBe('10000');
  });

  it('returns null on empty / non-numeric input', () => {
    expect(scorePercentInputToThresholdKobo('')).toBeNull();
    expect(scorePercentInputToThresholdKobo('   ')).toBeNull();
    expect(scorePercentInputToThresholdKobo('abc')).toBeNull();
  });

  it('returns null on out-of-range input', () => {
    expect(scorePercentInputToThresholdKobo('-10')).toBeNull();
    expect(scorePercentInputToThresholdKobo('100.001')).toBeNull();
    expect(scorePercentInputToThresholdKobo('200')).toBeNull();
  });
});
