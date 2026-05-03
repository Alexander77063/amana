import type { AnomalyThresholdRuleConfig, DenialReason } from '../types';

export function evaluateAnomalyThreshold(
  cfg: AnomalyThresholdRuleConfig,
  score: number,
): DenialReason | null {
  if (score > cfg.maxScore) {
    return { code: 'ANOMALY_TOO_HIGH', score, max: cfg.maxScore };
  }
  return null;
}
