import type { DenialReason, LedgerSnapshot, LimitRuleConfig, TxnIntent } from '../types';

export function evaluateLimit(
  cfg: LimitRuleConfig,
  intent: TxnIntent,
  ledger: LedgerSnapshot,
): DenialReason | null {
  // Sub-wallets are spending *envelopes*, not balance-holding accounts (locked decision
  // #7, "limits-only" funds model): there is no per-sub-wallet available balance to check
  // here. Spending authority is bounded by the daily/30-day limit below; overdraft of the
  // household's real funds is enforced authoritatively by Anchor at transfer time (an
  // over-balance NIP is rejected → reversed → FAILED — see nip-out.service / settlement),
  // not by the ledger (no ledger account holds an "available" figure under the envelope
  // model). The former `amountKobo > subWalletAvailableKobo` check was inert: production
  // top-ups credit the MASTER, so a sub LA balance is ~0 and the check fired on the FIRST
  // within-limit spend of every *limit-ruled* sub-wallet. The engine has no deny verdict
  // (Decision = allow | require_bump), so that became a SPURIOUS bump → bump_pending —
  // silently routing legitimate within-limit spends to principal approval, defeating the
  // limits feature. (Not a hard block.) Regression: lifecycle.service.test.ts "limits-only".
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
