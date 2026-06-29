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
  // model). The former `amountKobo > subWalletAvailableKobo` check was inert and blocked
  // every spend from an unfunded sub-wallet — i.e. the first spend on every sub-wallet.
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
