import type { AnomalyHistory, ScoringIntent } from '../types';

const ONE_HOUR_MS = 60 * 60 * 1000;
const SATURATION_COUNT = 10;

export function velocity(intent: ScoringIntent, history: AnomalyHistory): number {
  const cutoff = intent.confirmedAt.getTime() - ONE_HOUR_MS;
  const recent = history.txns.filter((t) => t.confirmedAt.getTime() >= cutoff).length;
  return Math.min(1, recent / SATURATION_COUNT);
}
