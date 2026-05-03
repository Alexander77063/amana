import type { Kobo } from '../../lib/kobo';

export type HistoricalTxn = {
  amountKobo: Kobo;
  vendorAccountNumber: string | null;
  vendorBankCode: string | null;
  confirmedAt: Date;
};

export type ScoringIntent = {
  amountKobo: Kobo;
  vendorAccountNumber: string | null;
  vendorBankCode: string | null;
  confirmedAt: Date;
};

export type AnomalyHistory = {
  txns: HistoricalTxn[];
};

export type FeatureScore = {
  name: string;
  value: number;
};

export type AnomalyResult = {
  score: number;
  features: FeatureScore[];
};
