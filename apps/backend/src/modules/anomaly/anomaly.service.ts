import { amountZscore } from './features/amount-zscore';
import { hourOfDay } from './features/hour-of-day';
import { velocity } from './features/velocity';
import { vendorNovelty } from './features/vendor-novelty';
import type { AnomalyHistory, AnomalyResult, ScoringIntent } from './types';

export type FeatureWeights = {
  amount_zscore: number;
  hour_of_day: number;
  vendor_novelty: number;
  velocity: number;
};

const DEFAULT_WEIGHTS: FeatureWeights = {
  amount_zscore: 1,
  hour_of_day: 1,
  vendor_novelty: 1,
  velocity: 1,
};

export const anomalyService = {
  score(
    intent: ScoringIntent,
    history: AnomalyHistory,
    opts?: { weights?: FeatureWeights },
  ): AnomalyResult {
    const weights = opts?.weights ?? DEFAULT_WEIGHTS;
    const features = [
      { name: 'amount_zscore', value: amountZscore(intent, history) },
      { name: 'hour_of_day', value: hourOfDay(intent, history) },
      { name: 'vendor_novelty', value: vendorNovelty(intent, history) },
      { name: 'velocity', value: velocity(intent, history) },
    ];
    const wsum =
      weights.amount_zscore + weights.hour_of_day + weights.vendor_novelty + weights.velocity;
    if (wsum === 0) return { score: 0, features };
    const weighted =
      features[0]?.value * weights.amount_zscore +
      features[1]?.value * weights.hour_of_day +
      features[2]?.value * weights.vendor_novelty +
      features[3]?.value * weights.velocity;
    return { score: weighted / wsum, features };
  },
};
