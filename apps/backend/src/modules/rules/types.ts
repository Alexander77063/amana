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

/**
 * The control fusion (spec §8): which retailers this sub-wallet may buy from.
 *
 * Written when a principal approves a merchant, and evaluated by the same engine as every other
 * rule — that is the whole point. The marketplace is not a second permission system bolted on
 * beside the rule engine; approving a merchant IS writing a rule.
 *
 * Only ever an allowlist. A blocklist would mean "may buy from every retailer on the platform
 * except these", which silently grants access to retailers onboarded tomorrow that the principal
 * has never seen — the opposite of what approving a merchant means.
 */
export type MerchantRuleConfig = {
  retailerIds: string[];
};

export type Rule =
  | { id: string; kind: 'limit'; priority: number; config: LimitRuleConfig }
  | { id: string; kind: 'category'; priority: number; config: CategoryRuleConfig }
  | { id: string; kind: 'time_window'; priority: number; config: TimeWindowRuleConfig }
  | { id: string; kind: 'allowlist'; priority: number; config: AllowlistRuleConfig }
  | { id: string; kind: 'anomaly_threshold'; priority: number; config: AnomalyThresholdRuleConfig }
  | { id: string; kind: 'merchant'; priority: number; config: MerchantRuleConfig };

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
  /**
   * The retailer this spend goes to, for a marketplace purchase. Null for everything else — a
   * bank transfer has no retailer, and a merchant rule against a null retailer denies, which is
   * the correct reading of "only these merchants".
   */
  retailerId: string | null;
  /**
   * The registry vendor this spend resolved to. Attribution and audit ONLY — no evaluator reads
   * this field. In particular it is NOT a second `retailerId`: vendor identity and marketplace
   * retailer identity are separate namespaces, and `evaluateMerchant` still denies any intent
   * whose `retailerId` is null, bank transfers included.
   */
  vendorId: string | null;
  /**
   * What the registry says this vendor's category is, recorded whether or not it was enforced.
   * When enforcement is on for the household AND the category is claimed or ops-set, this value
   * is what `category` above was populated from; otherwise `category` is the app-supplied string
   * and this field is the counterfactual.
   */
  resolvedCategory: string | null;
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
  | { code: 'ANOMALY_TOO_HIGH'; score: number; max: number }
  | { code: 'MERCHANT_NOT_ALLOWED'; retailerId: string | null };

export type Decision =
  | { kind: 'allow' }
  | { kind: 'require_bump'; firstFailedReason: DenialReason; allReasons: DenialReason[] };
