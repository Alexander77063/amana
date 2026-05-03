import type { AnomalyHistory, ScoringIntent } from '../types';

const FAMILIARITY_THRESHOLD = 5;

export function vendorNovelty(intent: ScoringIntent, history: AnomalyHistory): number {
  if (intent.vendorBankCode === null || intent.vendorAccountNumber === null) return 1;
  const matches = history.txns.filter(
    (t) =>
      t.vendorBankCode === intent.vendorBankCode &&
      t.vendorAccountNumber === intent.vendorAccountNumber,
  ).length;
  if (matches >= FAMILIARITY_THRESHOLD) return 0;
  return 1 - matches / FAMILIARITY_THRESHOLD;
}
