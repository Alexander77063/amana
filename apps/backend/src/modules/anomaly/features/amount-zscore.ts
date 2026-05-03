import type { AnomalyHistory, ScoringIntent } from '../types';

export function amountZscore(intent: ScoringIntent, history: AnomalyHistory): number {
  if (history.txns.length === 0) return 0;
  const amounts = history.txns.map((t) => Number(t.amountKobo));
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((acc, a) => acc + (a - mean) ** 2, 0) / amounts.length;
  const stddev = Math.sqrt(variance);
  const x = Number(intent.amountKobo);
  if (stddev === 0) {
    return x === mean ? 0 : 1;
  }
  const z = Math.abs(x - mean) / stddev;
  return Math.min(1, z / 4);
}
