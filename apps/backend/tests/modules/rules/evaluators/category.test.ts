import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { evaluateCategory } from '../../../../src/modules/rules/evaluators/category';
import type { CategoryRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';

const intent = (category: string | null): TxnIntent => ({
  amountKobo: kobo(0n),
  category,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
});

describe('evaluateCategory', () => {
  it('allowlist: allows when category is in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'allowlist', categories: ['groceries', 'transport'] };
    expect(evaluateCategory(cfg, intent('groceries'))).toBeNull();
  });

  it('allowlist: denies when category is not in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'allowlist', categories: ['groceries'] };
    const r = evaluateCategory(cfg, intent('alcohol'));
    expect(r?.code).toBe('CATEGORY_NOT_ALLOWED');
  });

  it('allowlist: denies when category is null and rule is set', () => {
    const cfg: CategoryRuleConfig = { mode: 'allowlist', categories: ['groceries'] };
    expect(evaluateCategory(cfg, intent(null))?.code).toBe('CATEGORY_NOT_ALLOWED');
  });

  it('blocklist: denies when category is in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'blocklist', categories: ['alcohol', 'gambling'] };
    expect(evaluateCategory(cfg, intent('alcohol'))?.code).toBe('CATEGORY_NOT_ALLOWED');
  });

  it('blocklist: allows when category is not in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'blocklist', categories: ['alcohol'] };
    expect(evaluateCategory(cfg, intent('groceries'))).toBeNull();
  });

  it('blocklist: allows when category is null', () => {
    const cfg: CategoryRuleConfig = { mode: 'blocklist', categories: ['alcohol'] };
    expect(evaluateCategory(cfg, intent(null))).toBeNull();
  });
});
