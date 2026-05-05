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
};

export type ProvisionedSubWallet = {
  subWallet: SubWallet;
  ledgerAccountId: string;
};

export type SubWalletBalance = {
  balanceKobo: string;
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
