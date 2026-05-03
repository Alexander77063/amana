import { describe, expect, it } from 'vitest';
import { evaluateAnomalyThreshold } from '../../../../src/modules/rules/evaluators/anomaly-threshold';
import type { AnomalyThresholdRuleConfig } from '../../../../src/modules/rules/types';

describe('evaluateAnomalyThreshold', () => {
  it('allows when score is below threshold', () => {
    const cfg: AnomalyThresholdRuleConfig = { maxScore: 0.85 };
    expect(evaluateAnomalyThreshold(cfg, 0.5)).toBeNull();
  });

  it('allows when score equals threshold (denial only on strictly greater)', () => {
    const cfg: AnomalyThresholdRuleConfig = { maxScore: 0.85 };
    expect(evaluateAnomalyThreshold(cfg, 0.85)).toBeNull();
  });

  it('denies when score exceeds threshold', () => {
    const cfg: AnomalyThresholdRuleConfig = { maxScore: 0.85 };
    const r = evaluateAnomalyThreshold(cfg, 0.92);
    expect(r?.code).toBe('ANOMALY_TOO_HIGH');
    if (r?.code === 'ANOMALY_TOO_HIGH') {
      expect(r.score).toBe(0.92);
      expect(r.max).toBe(0.85);
    }
  });
});
