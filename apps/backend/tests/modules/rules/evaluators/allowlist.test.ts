import { describe, expect, it } from 'vitest';
import { kobo } from '../../../../src/lib/kobo';
import { evaluateAllowlist } from '../../../../src/modules/rules/evaluators/allowlist';
import type { AllowlistRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';

const intent = (overrides: Partial<TxnIntent> = {}): TxnIntent => ({
  amountKobo: kobo(0n),
  category: null,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
  ...overrides,
});

describe('evaluateAllowlist', () => {
  it('allows when account matches', () => {
    const cfg: AllowlistRuleConfig = {
      accounts: [{ bankCode: '058', accountNumber: '0123456789' }],
    };
    const r = evaluateAllowlist(
      cfg,
      intent({ vendorBankCode: '058', vendorAccountNumber: '0123456789' }),
    );
    expect(r).toBeNull();
  });

  it('denies when neither account nor name match', () => {
    const cfg: AllowlistRuleConfig = {
      accounts: [{ bankCode: '058', accountNumber: '0123456789' }],
      nameSubstrings: ['MAMA'],
    };
    const r = evaluateAllowlist(
      cfg,
      intent({
        vendorBankCode: '058',
        vendorAccountNumber: '9999999999',
        vendorResolvedName: 'JOHN DOE',
      }),
    );
    expect(r?.code).toBe('NOT_IN_ALLOWLIST');
  });

  it('matches by name substring (case-insensitive)', () => {
    const cfg: AllowlistRuleConfig = { nameSubstrings: ['MAMA'] };
    const r = evaluateAllowlist(cfg, intent({ vendorResolvedName: 'mama adunni store' }));
    expect(r).toBeNull();
  });

  it('denies when both lists are empty (vacuously empty allowlist = all denied)', () => {
    const cfg: AllowlistRuleConfig = {};
    expect(evaluateAllowlist(cfg, intent())?.code).toBe('NOT_IN_ALLOWLIST');
  });

  it('denies when name is null and only nameSubstrings is set', () => {
    const cfg: AllowlistRuleConfig = { nameSubstrings: ['MAMA'] };
    const r = evaluateAllowlist(cfg, intent({ vendorResolvedName: null }));
    expect(r?.code).toBe('NOT_IN_ALLOWLIST');
  });
});
