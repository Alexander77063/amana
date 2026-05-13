import type { AnomalyHistory, ScoringIntent } from '../types';

const HOURS = 24;

// Laplace alpha = 0.1 (weaker than 1) so even modest history (~50 samples) gives
// strong discrimination on dominant hours while keeping the empty-history result
// at the uniform 1/24 (1 - 23/24 ≈ 0.958).
const LAPLACE_ALPHA = 0.1;

export function hourOfDay(intent: ScoringIntent, history: AnomalyHistory): number {
  const hour = intent.confirmedAt.getUTCHours();
  const counts = new Array<number>(HOURS).fill(0);
  for (const t of history.txns) {
    const h = t.confirmedAt.getUTCHours();
    counts[h] = (counts[h] as number) + 1;
  }
  const total = history.txns.length;
  const prob = ((counts[hour] as number) + LAPLACE_ALPHA) / (total + HOURS * LAPLACE_ALPHA);
  return 1 - prob;
}
