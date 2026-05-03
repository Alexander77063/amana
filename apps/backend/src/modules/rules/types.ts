import type { Kobo } from '../../lib/kobo';

// ============ Rule definitions (one variant per rule kind) ============

export type LimitRuleConfig = {
  windowKind: 'daily' | 'monthly';
  maxKobo: bigint;
};

export type CategoryRuleConfig = {
  mode: 'allowlist' | 'blocklist';
  categories: string[];
};

export type TimeWindowRuleConfig = {
  startHour: number;
  endHour: number;
  daysOfWeek: number[];
};

export type AllowlistRuleConfig = {
  accounts?: { bankCode: string; accountNumber: string }[];
  nameSubstrings?: string[];
};

export type AnomalyThresholdRuleConfig = {
  maxScore: number;
};

export type Rule =
  | { id: string; kind: 'limit'; priority: number; config: LimitRuleConfig }
  | { id: string; kind: 'category'; priority: number; config: CategoryRuleConfig }
  | { id: string; kind: 'time_window'; priority: number; config: TimeWindowRuleConfig }
  | { id: string; kind: 'allowlist'; priority: number; config: AllowlistRuleConfig }
  | { id: string; kind: 'anomaly_threshold'; priority: number; config: AnomalyThresholdRuleConfig };

export type RuleSet = {
  id: string;
  subWalletId: string;
  version: number;
  rules: Rule[];
};

// ============ Inputs into evaluation ============

export type TxnIntent = {
  amountKobo: Kobo;
  category: string | null;
  vendorBankCode: string | null;
  vendorAccountNumber: string | null;
  vendorResolvedName: string | null;
  confirmedAt: Date;
};

export type LedgerSnapshot = {
  subWalletAvailableKobo: Kobo;
  spentLast24hKobo: Kobo;
  spentLast30dKobo: Kobo;
};

export type RuleEvaluationContext = {
  ledger: LedgerSnapshot;
  anomalyScore: number;
};

// ============ Outputs ============

export type DenialReason =
  | { code: 'INSUFFICIENT_FUNDS' }
  | { code: 'LIMIT_EXCEEDED'; window: 'daily' | 'monthly'; maxKobo: bigint; wouldBeKobo: bigint }
  | { code: 'CATEGORY_NOT_ALLOWED'; category: string | null }
  | { code: 'OUTSIDE_TIME_WINDOW'; nowHour: number; allowedStart: number; allowedEnd: number }
  | { code: 'NOT_IN_ALLOWLIST' }
  | { code: 'ANOMALY_TOO_HIGH'; score: number; max: number };

export type Decision =
  | { kind: 'allow' }
  | { kind: 'require_bump'; firstFailedReason: DenialReason; allReasons: DenialReason[] };
