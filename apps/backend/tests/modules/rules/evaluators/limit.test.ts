import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { evaluateLimit } from '../../../../src/modules/rules/evaluators/limit';
import type {
  LedgerSnapshot,
  LimitRuleConfig,
  TxnIntent,
} from '../../../../src/modules/rules/types';

const intent = (amount: bigint): TxnIntent => ({
  amountKobo: kobo(amount),
  category: null,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
});

const ledger = (overrides: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  subWalletAvailableKobo: kobo(100_000n),
  spentLast24hKobo: kobo(0n),
  spentLast30dKobo: kobo(0n),
  ...overrides,
});

describe('evaluateLimit', () => {
  it('allows when daily total stays under cap', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 50_000n };
    expect(
      evaluateLimit(cfg, intent(10_000n), ledger({ spentLast24hKobo: kobo(20_000n) })),
    ).toBeNull();
  });

  it('denies when daily total would exceed cap', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 50_000n };
    const r = evaluateLimit(cfg, intent(40_000n), ledger({ spentLast24hKobo: kobo(20_000n) }));
    expect(r?.code).toBe('LIMIT_EXCEEDED');
    if (r?.code === 'LIMIT_EXCEEDED') {
      expect(r.window).toBe('daily');
      expect(r.maxKobo).toBe(50_000n);
      expect(r.wouldBeKobo).toBe(60_000n);
    }
  });

  it('allows a spend from a sub-wallet with no stored balance (envelope/limits-only model)', () => {
    // Sub-wallets are spending envelopes, not balance-holding accounts: control is by
    // limit rules; overdraft is enforced authoritatively by Anchor at transfer time
    // (an over-balance NIP is rejected → reversed), never by a per-sub-wallet available
    // balance. A fresh sub-wallet (never funded) must be able to spend within its cap.
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 1_000_000n };
    expect(
      evaluateLimit(cfg, intent(200_000n), ledger({ subWalletAvailableKobo: kobo(0n) })),
    ).toBeNull();
  });

  it('handles monthly window via spentLast30dKobo', () => {
    const cfg: LimitRuleConfig = { windowKind: 'monthly', maxKobo: 200_000n };
    const r = evaluateLimit(cfg, intent(50_000n), ledger({ spentLast30dKobo: kobo(180_000n) }));
    expect(r?.code).toBe('LIMIT_EXCEEDED');
  });

  it('returns null (no denial) when amount exactly equals remaining headroom', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 50_000n };
    expect(
      evaluateLimit(cfg, intent(30_000n), ledger({ spentLast24hKobo: kobo(20_000n) })),
    ).toBeNull();
  });
});
