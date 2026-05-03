import type { Decision } from '../rules/types';
import type { AuditEntry } from './audit.repo';

export const auditEvents = {
  txnRuleEval(input: {
    transactionId: string;
    actorUserId: string;
    ruleSetId: string;
    ruleSetVersion: number;
    decision: Decision;
  }): AuditEntry {
    return {
      actorKind: 'system',
      actorUserId: input.actorUserId,
      action: 'txn.rule_eval',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: JSON.parse(
        JSON.stringify(
          {
            ruleSetId: input.ruleSetId,
            ruleSetVersion: input.ruleSetVersion,
            decision: input.decision,
          },
          (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        ),
      ),
    };
  },

  bumpRequested(input: {
    bumpRequestId: string;
    transactionId: string;
    actorUserId: string;
    amountKobo: bigint;
    vendorResolvedName: string;
  }): AuditEntry {
    return {
      actorKind: 'user',
      actorUserId: input.actorUserId,
      action: 'bump.requested',
      subjectKind: 'bump_request',
      subjectId: input.bumpRequestId,
      payloadJson: {
        transactionId: input.transactionId,
        amountKobo: input.amountKobo.toString(),
        vendorResolvedName: input.vendorResolvedName,
      },
    };
  },

  bumpDecided(input: {
    bumpRequestId: string;
    decidedByUserId: string;
    decision: 'approve_once' | 'approve_raise_limit' | 'deny';
  }): AuditEntry {
    return {
      actorKind: 'user',
      actorUserId: input.decidedByUserId,
      action: 'bump.decided',
      subjectKind: 'bump_request',
      subjectId: input.bumpRequestId,
      payloadJson: { decision: input.decision },
    };
  },

  anomalyScored(input: {
    transactionId: string;
    score: number;
    features: Array<{ name: string; value: number }>;
  }): AuditEntry {
    return {
      actorKind: 'system',
      action: 'txn.anomaly_scored',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: { score: input.score, features: input.features },
    };
  },
};
