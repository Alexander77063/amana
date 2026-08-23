export type HouseholdSummary = {
  id: string;
  name: string;
  principalUserId: string;
};

export type MasterWalletStatus = 'active' | 'frozen';

export type MasterWalletSummary = {
  id: string;
  anchorVirtualAccount: string;
  anchorBankCode: string;
  currency: string;
  status?: MasterWalletStatus;
  /**
   * Lifetime sum (kobo, string) of bank inflow fees Amana absorbed on this
   * wallet's top-ups. Present on `GET /me/household`; omitted on the create
   * response (`POST /households`), hence optional.
   */
  feesCoveredKobo?: string;
};

export type HouseholdSnapshot = {
  household: HouseholdSummary;
  masterWallet: MasterWalletSummary;
};

export type HouseholdMember = {
  userId: string;
  phone: string;
  role: 'principal' | 'agent';
  kycTier: '1' | '2' | '3';
  status: 'active' | 'suspended';
  joinedAt: string;
};

export type SubWalletStatus = 'active' | 'suspended' | 'closed';

export type SubWallet = {
  id: string;
  masterWalletId: string;
  agentUserId: string;
  name: string;
  status: SubWalletStatus;
  createdAt: string;
  /** ISO8601 if currently snoozed and active; null otherwise. */
  snoozedUntil: string | null;
};

export type ProvisionedSubWallet = {
  subWallet: SubWallet;
  ledgerAccountId: string;
};

export type SubWalletBalance = {
  /**
   * The sub ledger account's balance, in kobo.
   *
   * A sub-wallet is a spending envelope, not an account that holds funds: top-ups credit the
   * master wallet and spends debit it, so this is ~0 by construction. It is here for ledger
   * reconciliation — do NOT show it to a principal as a balance, because an envelope capped at
   * ₦20,000 a day displaying ₦0.00 reads as an empty wallet. Use the spend figures below.
   */
  balanceKobo: string;
  /** Spent through this sub-wallet in the last 24 hours / 30 days, in kobo. */
  spentLast24hKobo: string;
  spentLast30dKobo: string;
  /** The caps currently published for it. Null means no limit rule of that window is active. */
  dailyLimitKobo: string | null;
  monthlyLimitKobo: string | null;
};

export type RuleKind = 'limit' | 'category' | 'time_window' | 'allowlist' | 'anomaly_threshold';

export type LimitRuleConfigWire = {
  windowKind: 'daily' | 'monthly';
  maxKobo: string;
};

export type CategoryRuleConfigWire = {
  mode: 'allowlist' | 'blocklist';
  categories: string[];
};

export type TimeWindowRuleConfigWire = {
  startHour: number;
  endHour: number;
  daysOfWeek: number[];
};

export type AllowlistRuleConfigWire = {
  accounts?: { bankCode: string; accountNumber: string }[];
  nameSubstrings?: string[];
};

export type AnomalyThresholdRuleConfigWire = {
  maxScore: number;
};

export type RuleInput =
  | { kind: 'limit'; priority: number; config: LimitRuleConfigWire }
  | { kind: 'category'; priority: number; config: CategoryRuleConfigWire }
  | { kind: 'time_window'; priority: number; config: TimeWindowRuleConfigWire }
  | { kind: 'allowlist'; priority: number; config: AllowlistRuleConfigWire }
  | { kind: 'anomaly_threshold'; priority: number; config: AnomalyThresholdRuleConfigWire };

export type RuleRecord = {
  id: string;
  kind: RuleKind;
  priority: number;
  configJson: unknown;
};

export type ActiveRuleSet = {
  ruleSetId: string;
  version: number;
  rules: RuleRecord[];
};

export type PairingTokenIssued = {
  pairingTokenId: string;
  code: string;
  expiresAt: string;
};
