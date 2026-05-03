import type { CategoryRuleConfig, DenialReason, TxnIntent } from '../types';

export function evaluateCategory(
  cfg: CategoryRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  const category = intent.category;
  const inList = category !== null && cfg.categories.includes(category);

  if (cfg.mode === 'allowlist' && !inList) {
    return { code: 'CATEGORY_NOT_ALLOWED', category };
  }
  if (cfg.mode === 'blocklist' && inList) {
    return { code: 'CATEGORY_NOT_ALLOWED', category };
  }
  return null;
}
