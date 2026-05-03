import type { DenialReason, LedgerSnapshot, LimitRuleConfig, TxnIntent } from '../types';

export function evaluateLimit(
  cfg: LimitRuleConfig,
  intent: TxnIntent,
  ledger: LedgerSnapshot,
): DenialReason | null {
  if (intent.amountKobo > ledger.subWalletAvailableKobo) {
    return { code: 'INSUFFICIENT_FUNDS' };
  }
  const spent = cfg.windowKind === 'daily' ? ledger.spentLast24hKobo : ledger.spentLast30dKobo;
  const wouldBe = spent + intent.amountKobo;
  if (wouldBe > cfg.maxKobo) {
    return {
      code: 'LIMIT_EXCEEDED',
      window: cfg.windowKind,
      maxKobo: cfg.maxKobo,
      wouldBeKobo: wouldBe,
    };
  }
  return null;
}
