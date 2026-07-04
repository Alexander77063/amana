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

  txnNipOutSent(input: {
    transactionId: string;
    actorUserId: string | null;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    anchorTransferId: string | null;
    reason: string | null;
  }): AuditEntry {
    return {
      actorKind: input.actorUserId === null ? 'system' : 'user',
      actorUserId: input.actorUserId,
      action: 'txn.nip_out_sent',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        status: input.status,
        anchorTransferId: input.anchorTransferId,
        reason: input.reason,
      },
    };
  },

  txnSettled(input: {
    transactionId: string;
    nibssSessionId: string | null;
    feeKobo: bigint;
    settledAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'partner',
      actorUserId: null,
      action: 'txn.settled',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        nibssSessionId: input.nibssSessionId,
        feeKobo: input.feeKobo.toString(),
        settledAt: input.settledAt.toISOString(),
      },
    };
  },

  txnFailedReversed(input: {
    transactionId: string;
    reversalTransactionId: string;
    reason: string | null;
    failedAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'system',
      actorUserId: null,
      action: 'txn.failed_reversed',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        reversalTransactionId: input.reversalTransactionId,
        reason: input.reason,
        failedAt: input.failedAt.toISOString(),
      },
    };
  },

  marketplaceRedeemed(input: {
    redemptionId: string;
    payoutTransactionId: string;
    retailerId: string;
    retailerNetKobo: bigint;
    status: 'PENDING' | 'FAILED';
    reason: string | null;
  }): AuditEntry {
    return {
      actorKind: 'system',
      actorUserId: null,
      action: 'marketplace.redeemed',
      subjectKind: 'redemption',
      subjectId: input.redemptionId,
      payloadJson: {
        payoutTransactionId: input.payoutTransactionId,
        retailerId: input.retailerId,
        retailerNetKobo: input.retailerNetKobo.toString(),
        status: input.status,
        reason: input.reason,
      },
    };
  },

  marketplaceRedemptionSettled(input: {
    redemptionId: string;
    payoutTransactionId: string;
    retailerNetKobo: bigint;
    commissionKobo: bigint;
    nibssSessionId: string | null;
    settledAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'partner',
      actorUserId: null,
      action: 'marketplace.redemption_settled',
      subjectKind: 'redemption',
      subjectId: input.redemptionId,
      payloadJson: {
        payoutTransactionId: input.payoutTransactionId,
        retailerNetKobo: input.retailerNetKobo.toString(),
        commissionKobo: input.commissionKobo.toString(),
        nibssSessionId: input.nibssSessionId,
        settledAt: input.settledAt.toISOString(),
      },
    };
  },

  marketplaceRedemptionPayoutFailed(input: {
    redemptionId: string;
    payoutTransactionId: string;
    payoutStatus: 'failed_retryable' | 'stuck';
    payoutAttempts: number;
    reason: string | null;
    failedAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'system',
      actorUserId: null,
      action: 'marketplace.redemption_payout_failed',
      subjectKind: 'redemption',
      subjectId: input.redemptionId,
      payloadJson: {
        payoutTransactionId: input.payoutTransactionId,
        payoutStatus: input.payoutStatus,
        payoutAttempts: input.payoutAttempts,
        reason: input.reason,
        failedAt: input.failedAt.toISOString(),
      },
    };
  },

  txnToppedUp(input: {
    transactionId: string;
    masterWalletId: string;
    amountKobo: bigint;
    nibssSessionId: string;
    senderBankCode: string;
    senderAccountNumber: string;
    senderAccountName: string;
    receivedAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'partner',
      actorUserId: null,
      action: 'txn.topped_up',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        masterWalletId: input.masterWalletId,
        amountKobo: input.amountKobo.toString(),
        nibssSessionId: input.nibssSessionId,
        senderBankCode: input.senderBankCode,
        senderAccountNumber: input.senderAccountNumber,
        senderAccountName: input.senderAccountName,
        receivedAt: input.receivedAt.toISOString(),
      },
    };
  },
};
