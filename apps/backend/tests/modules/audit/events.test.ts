import { describe, expect, it } from 'vitest';
import { auditEvents } from '../../../src/modules/audit/events';

describe('auditEvents', () => {
  it('txnRuleEval has the expected shape', () => {
    const e = auditEvents.txnRuleEval({
      transactionId: 't1',
      actorUserId: 'u1',
      ruleSetId: 'rs1',
      ruleSetVersion: 2,
      decision: { kind: 'allow' },
    });
    expect(e.action).toBe('txn.rule_eval');
    expect(e.subjectKind).toBe('transaction');
    expect(e.subjectId).toBe('t1');
    expect(e.actorKind).toBe('system');
  });

  it('bumpRequested serializes amountKobo as string for JSONB safety', () => {
    const e = auditEvents.bumpRequested({
      bumpRequestId: 'b1',
      transactionId: 't1',
      actorUserId: 'u1',
      amountKobo: 50000n,
      vendorResolvedName: 'MAMA',
    });
    expect((e.payloadJson as { amountKobo: string }).amountKobo).toBe('50000');
  });

  it('anomalyScored captures features array', () => {
    const e = auditEvents.anomalyScored({
      transactionId: 't1',
      score: 0.42,
      features: [
        { name: 'amount_zscore', value: 0.5 },
        { name: 'velocity', value: 0.3 },
      ],
    });
    expect((e.payloadJson as { features: unknown[] }).features).toHaveLength(2);
  });
});
