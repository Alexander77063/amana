import { describe, expect, it } from 'vitest';
import { evaluate } from '../../../src/modules/rules/engine';
import type { Rule, RuleEvaluationContext, TxnIntent } from '../../../src/modules/rules/types';
import { kobo } from '../../../src/lib/kobo';

const intent = (overrides: Partial<TxnIntent> = {}): TxnIntent => ({
  amountKobo: kobo(40_000n),
  category: 'groceries',
  vendorBankCode: '058',
  vendorAccountNumber: '0123456789',
  vendorResolvedName: 'MUSA',
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
  ...overrides,
});

const ctx = (overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext => ({
  ledger: {
    subWalletAvailableKobo: kobo(100_000n),
    spentLast24hKobo: kobo(0n),
    spentLast30dKobo: kobo(0n),
  },
  anomalyScore: 0.1,
  ...overrides,
});

describe('rule engine evaluate', () => {
  it('allow when no rules', () => {
    expect(evaluate(intent(), { id: 'rs', subWalletId: 'sw', version: 1, rules: [] }, ctx())).toEqual({
      kind: 'allow',
    });
  });

  it('allow when all rules pass', () => {
    const rules: Rule[] = [
      { id: 'r1', kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 100_000n } },
      { id: 'r2', kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['groceries'] } },
    ];
    const out = evaluate(intent(), { id: 'rs', subWalletId: 'sw', version: 1, rules }, ctx());
    expect(out.kind).toBe('allow');
  });

  it('require_bump when one rule fails; reason matches that rule', () => {
    const rules: Rule[] = [
      { id: 'r1', kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 30_000n } },
    ];
    const out = evaluate(intent({ amountKobo: kobo(40_000n) }), { id: 'rs', subWalletId: 'sw', version: 1, rules }, ctx());
    expect(out.kind).toBe('require_bump');
    if (out.kind === 'require_bump') {
      expect(out.firstFailedReason.code).toBe('LIMIT_EXCEEDED');
      expect(out.allReasons).toHaveLength(1);
    }
  });

  it('collects all failures across multiple rules; firstFailedReason follows priority', () => {
    const rules: Rule[] = [
      { id: 'lo', kind: 'limit', priority: 5, config: { windowKind: 'daily', maxKobo: 30_000n } },
      { id: 'hi', kind: 'category', priority: 50, config: { mode: 'allowlist', categories: ['transport'] } },
    ];
    const out = evaluate(intent({ amountKobo: kobo(40_000n), category: 'groceries' }), {
      id: 'rs', subWalletId: 'sw', version: 1, rules,
    }, ctx());
    expect(out.kind).toBe('require_bump');
    if (out.kind === 'require_bump') {
      expect(out.allReasons).toHaveLength(2);
      // Lowest priority number = highest priority = comes first
      expect(out.firstFailedReason.code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('passes anomaly score through to anomaly_threshold rules', () => {
    const rules: Rule[] = [
      { id: 'a', kind: 'anomaly_threshold', priority: 100, config: { maxScore: 0.5 } },
    ];
    const out = evaluate(intent(), { id: 'rs', subWalletId: 'sw', version: 1, rules }, ctx({ anomalyScore: 0.9 }));
    expect(out.kind).toBe('require_bump');
  });
});
