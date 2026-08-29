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

  /**
   * Recorded only when the registry's category would have produced a DIFFERENT rule decision than
   * the app-supplied one. This is the measurement the whole shadow-mode rollout exists to take:
   * counting these rows per household is how we learn what enforcement would cost before anyone
   * is denied a purchase at a market stall.
   */
  vendorCategoryShadow(input: {
    transactionId: string;
    vendorId: string;
    appCategory: string | null;
    registryCategory: string | null;
    /**
     * Where the registry category came from. Load-bearing for the operator query, not decoration:
     * an `observed` category NEVER enforces (D-V7), so rows carrying one describe a difference that
     * will not happen. Grouping the shadow log without this field blends "enforcement would change
     * this" with "enforcement can never change this", and the whole point of the log is deciding
     * whether to switch enforcement on. In V1 every vendor is `observed` and the field looks
     * redundant; from SP-V2 onward both sources coexist and it is the only thing separating them.
     */
    categorySource: 'observed' | 'claimed' | 'ops';
    liveDecision: 'allow' | 'require_bump';
    shadowDecision: 'allow' | 'require_bump';
    enforced: boolean;
  }): AuditEntry {
    return {
      actorKind: 'system',
      action: 'vendor.category_shadow',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        vendorId: input.vendorId,
        appCategory: input.appCategory,
        registryCategory: input.registryCategory,
        categorySource: input.categorySource,
        liveDecision: input.liveDecision,
        shadowDecision: input.shadowDecision,
        enforced: input.enforced,
      },
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

  marketplaceVoucherRefunded(input: {
    redemptionId: string;
    refundedKobo: bigint;
    reason: 'expired' | 'cancelled';
    refundedAt: Date;
  }): AuditEntry {
    return {
      actorKind: input.reason === 'cancelled' ? 'user' : 'system',
      actorUserId: null,
      action: 'marketplace.voucher_refunded',
      subjectKind: 'redemption',
      subjectId: input.redemptionId,
      payloadJson: {
        refundedKobo: input.refundedKobo.toString(),
        reason: input.reason,
        refundedAt: input.refundedAt.toISOString(),
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

  vasPurchaseInitiated(input: {
    vasPurchaseId: string;
    transactionId: string;
    anchorBillId: string;
    category: string;
    now: Date;
  }): AuditEntry {
    return {
      actorKind: 'user',
      actorUserId: null,
      action: 'vas.purchase.initiated',
      subjectKind: 'vas_purchase',
      subjectId: input.vasPurchaseId,
      payloadJson: {
        transactionId: input.transactionId,
        anchorBillId: input.anchorBillId,
        category: input.category,
        at: input.now.toISOString(),
      },
    };
  },

  vasPurchaseSettled(input: {
    vasPurchaseId: string;
    transactionId: string;
    category: string;
    commissionKobo: bigint;
    settledAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'partner',
      actorUserId: null,
      action: 'vas.purchase.settled',
      subjectKind: 'vas_purchase',
      subjectId: input.vasPurchaseId,
      payloadJson: {
        transactionId: input.transactionId,
        category: input.category,
        commissionKobo: input.commissionKobo.toString(),
        at: input.settledAt.toISOString(),
      },
    };
  },

  vasPurchaseFailed(input: {
    vasPurchaseId: string;
    transactionId: string;
    reason: string;
    failedAt: Date;
  }): AuditEntry {
    return {
      actorKind: 'partner',
      actorUserId: null,
      action: 'vas.purchase.failed',
      subjectKind: 'vas_purchase',
      subjectId: input.vasPurchaseId,
      payloadJson: {
        transactionId: input.transactionId,
        reason: input.reason,
        at: input.failedAt.toISOString(),
      },
    };
  },

  /**
   * A member of staff signed in to the admin portal.
   *
   * The first event in the codebase to carry `actorAdminUserId`. Signing in is worth recording on
   * its own — "who had a live session at 02:00" is the question every later ops action is read
   * against — and it is the proof that attribution works end to end before Task 4 depends on it.
   */
  adminSignedIn(input: { adminUserId: string; email: string; at: Date }): AuditEntry {
    return {
      actorKind: 'ops',
      actorAdminUserId: input.adminUserId,
      action: 'admin.signed_in',
      subjectKind: 'admin_user',
      subjectId: input.adminUserId,
      payloadJson: { email: input.email, at: input.at.toISOString() },
    };
  },

  /**
   * A sign-in was refused, and why.
   *
   * `adminUserId` is null whenever the refusal happened before we knew who was asking — an
   * unknown state, a failed exchange, an address outside the Workspace. The subject is then the
   * login attempt itself, which is the only identifier such an event has.
   *
   * The address is recorded ONLY for someone inside the Workspace domain. A stranger's personal
   * email is not ours to file: `emailDomain` is enough to investigate a pattern of attempts
   * without keeping an address belonging to a person who is neither staff nor a customer.
   */
  adminSignInDenied(input: {
    adminUserId: string | null;
    subjectId: string;
    reason: string;
    email: string | null;
    workspaceDomain: string;
    at: Date;
  }): AuditEntry {
    const domain = input.email?.split('@')[1] ?? null;
    const insideWorkspace = domain === input.workspaceDomain.toLowerCase();
    return {
      actorKind: 'ops',
      actorAdminUserId: input.adminUserId,
      action: 'admin.sign_in_denied',
      subjectKind: input.adminUserId ? 'admin_user' : 'admin_auth_request',
      subjectId: input.subjectId,
      payloadJson: {
        reason: input.reason,
        emailDomain: domain,
        email: insideWorkspace ? input.email : null,
        at: input.at.toISOString(),
      },
    };
  },

  /**
   * A new member of staff was given an admin record. They hold no roles yet, so this event is
   * "someone can now sign in", not "someone can now do something".
   */
  adminOnboarded(input: {
    actorAdminUserId: string;
    newAdminUserId: string;
    email: string;
    at: Date;
  }): AuditEntry {
    return {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: 'admin.onboarded',
      subjectKind: 'admin_user',
      subjectId: input.newAdminUserId,
      payloadJson: { email: input.email, at: input.at.toISOString() },
    };
  },

  /**
   * A role was granted or revoked.
   *
   * The most dangerous action in the system, and the reason the audit column exists: a role grant
   * converts into every permission that role carries, so "who gave this person access, and when"
   * has to be answerable years later. The subject is the admin whose access changed, not the one
   * who changed it — the actor column already records that.
   */
  adminRoleChanged(input: {
    actorAdminUserId: string;
    targetAdminUserId: string;
    role: string;
    granted: boolean;
    reason: string | null;
    at: Date;
  }): AuditEntry {
    return {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: input.granted ? 'admin.role_granted' : 'admin.role_revoked',
      subjectKind: 'admin_user',
      subjectId: input.targetAdminUserId,
      payloadJson: {
        role: input.role,
        granted: input.granted,
        reason: input.reason,
        at: input.at.toISOString(),
      },
    };
  },

  /**
   * A retailer's onboarding state was changed by an operator.
   *
   * These events did not exist until sub-plan A1 Task 2. Approving a retailer admits a business
   * to the marketplace and suspending one cuts off its income, and neither left any trace at all —
   * a worse problem than the missing attribution A1 was written to fix, and one that could be
   * fixed immediately because recording WHAT happened does not require knowing who did it.
   *
   * `actorAdminUserId` is null while these routes still authenticate with the shared
   * `ADMIN_API_KEY`, which is not an identity. Task 4 swaps that for a session and fills it in.
   */
  retailerOnboardingChanged(input: {
    retailerId: string;
    action: 'applied' | 'kyb_submitted' | 'approved' | 'suspended';
    actorAdminUserId?: string | null;
    at: Date;
    details?: Record<string, unknown>;
  }): AuditEntry {
    return {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId ?? null,
      action: `retailer.${input.action}`,
      subjectKind: 'retailer',
      subjectId: input.retailerId,
      payloadJson: { ...(input.details ?? {}), at: input.at.toISOString() },
    };
  },

  adminSignedOut(input: { adminUserId: string; at: Date }): AuditEntry {
    return {
      actorKind: 'ops',
      actorAdminUserId: input.adminUserId,
      action: 'admin.signed_out',
      subjectKind: 'admin_user',
      subjectId: input.adminUserId,
      payloadJson: { at: input.at.toISOString() },
    };
  },
};
