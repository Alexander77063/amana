import type { AllowlistRuleConfig, DenialReason, TxnIntent } from '../types';

export function evaluateAllowlist(
  cfg: AllowlistRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  const accountMatch = (cfg.accounts ?? []).some(
    (a) => a.bankCode === intent.vendorBankCode && a.accountNumber === intent.vendorAccountNumber,
  );
  if (accountMatch) return null;

  const name = intent.vendorResolvedName?.toLowerCase() ?? '';
  const nameMatch =
    name.length > 0 && (cfg.nameSubstrings ?? []).some((s) => name.includes(s.toLowerCase()));
  if (nameMatch) return null;

  return { code: 'NOT_IN_ALLOWLIST' };
}
