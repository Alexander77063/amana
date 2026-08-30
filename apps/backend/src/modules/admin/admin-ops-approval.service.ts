import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { mintPrefixedCode } from '../../lib/crockford';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { auditRepo } from '../audit/audit.repo';
import { phoneFingerprint } from '../vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../vendors/vendor-claims.repo';
import { vendorsRepo } from '../vendors/vendors.repo';
import { type AdminApprovalRow, adminApprovalService } from './admin-approval.service';
import { adminIamService } from './admin-iam.service';

type DbOrTx = PostgresJsDatabase;

export type ProposeClaimApprovalInput = {
  actorAdminUserId: string;
  vendorId: string;
  phone: string;
  category: string | null;
};

/** What the proposal stores so the approver can execute the same action days later. */
type ClaimApprovalPayload = {
  vendorId: string;
  phone: string;
  category: string | null;
};

export type ClaimApplied = { publicCode: string; displayName: string | null };

/**
 * Ops actions that require two people.
 *
 * Sits between the generic `admin-approval.service` (which knows nothing about vendors, and must
 * stay that way) and the vendor repos. It is the vendor-side mirror of `approveRoleGrant`: the
 * approval service records that somebody proposed and somebody else agreed; this decides what the
 * proposal MEANS and performs it.
 *
 * Only `approve-claim` is here. Suspend and consent-revoke are deliberately ungated — see the
 * `admin_approval_kind` enum for the reasoning.
 */
export const adminOpsApprovalService = {
  /**
   * Propose a vendor claim approval. Never applies it, for anybody.
   *
   * Note the absence of `selfApprove`. The bootstrap exemption in `grantRole` exists for exactly
   * one reason — without it the IAM bootstrap deadlocks, because the config-seeded account is the
   * only admin who could grant the first role. There is no equivalent deadlock on the vendor
   * rail, so extending the exemption here would hand the break-glass account the power to assign
   * a business identity alone, buying nothing.
   */
  async proposeClaimApproval(
    db: DbOrTx,
    input: ProposeClaimApprovalInput,
    now: Date = new Date(),
  ): Promise<AdminApprovalRow> {
    await adminIamService.requirePermission(db, input.actorAdminUserId, 'vendor.write');
    await assertClaimable(db, input.vendorId);

    return adminApprovalService.propose(
      db,
      {
        kind: 'vendor_approve_claim',
        makerAdminUserId: input.actorAdminUserId,
        // The phone is stored in full because applying the claim needs it — a fingerprint could
        // not be used to claim anything. It is short-lived (the proposal expires) and every
        // AUDIT row derived from it still records only `phoneFingerprint`, so the merchant's
        // number never reaches the permanent, append-only trail.
        payload: {
          vendorId: input.vendorId,
          phone: input.phone,
          category: input.category,
        } satisfies ClaimApprovalPayload,
        reason: null,
      },
      now,
    );
  },

  /**
   * Approve someone else's proposed claim and perform it.
   *
   * The checker must hold `vendor.write` themselves — two people is only a control if both could
   * have done it alone — and `adminApprovalService.approve` refuses the maker.
   */
  async approveClaim(
    db: DbOrTx,
    input: { approval: AdminApprovalRow; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<ClaimApplied> {
    await adminIamService.requirePermission(db, input.checkerAdminUserId, 'vendor.write');

    const payload = input.approval.payloadJson as ClaimApprovalPayload;
    // Re-checked against the world as it is NOW, not as it was when proposed. The vendor may have
    // been suspended or claimed by the self-service rail in between; a proposal is a request, not
    // a pre-authorised write.
    await assertClaimable(db, payload.vendorId);

    // Claim the proposal first: the conditional UPDATE inside means two checkers racing cannot
    // both win and mint two public codes for one vendor.
    await adminApprovalService.approve(
      db,
      {
        approvalId: input.approval.id,
        checkerAdminUserId: input.checkerAdminUserId,
        reason: input.reason ?? null,
      },
      now,
    );

    const applied = await applyClaim(db, {
      vendorId: payload.vendorId,
      phone: payload.phone,
      category: payload.category,
      makerAdminUserId: input.approval.makerAdminUserId,
      checkerAdminUserId: input.checkerAdminUserId,
      now,
    });
    if (!applied) throw new ConflictError('not_claimable');
    return applied;
  },
};

/**
 * A vendor must exist and still be claimable, both when proposed and when approved.
 *
 * `observed` is the only claimable status — it is what `vendorsRepo.claim`'s own CAS requires, and
 * this check exists to fail early with a clear reason rather than to replace it. A vendor that has
 * been suspended, or claimed by the self-service rail, in the days between proposal and approval
 * lands here rather than silently no-opping.
 */
async function assertClaimable(db: DbOrTx, vendorId: string): Promise<void> {
  const vendor = await vendorsRepo.findById(db, vendorId);
  if (!vendor) throw new NotFoundError('vendor_not_found');
  if (vendor.status !== 'observed') throw new ConflictError('not_claimable');
}

/**
 * The claim itself, in one transaction — moved here from `routes/vendors-admin.ts` unchanged in
 * substance. A vendor left `claimed` with its queue entry still `pending` is a phantom ops-queue
 * row for a business that no longer needs review.
 */
async function applyClaim(
  db: DbOrTx,
  input: {
    vendorId: string;
    phone: string;
    category: string | null;
    makerAdminUserId: string;
    checkerAdminUserId: string;
    now: Date;
  },
): Promise<ClaimApplied | null> {
  const publicCode = mintPrefixedCode('AMNV');

  return db.transaction(async (tx) => {
    const txDb = tx as DbOrTx;
    const claimedRow = await vendorsRepo.claim(txDb, {
      vendorId: input.vendorId,
      phone: input.phone,
      category: input.category,
      // `null` = keep the observation-derived name. This rail exists precisely BECAUSE the NIBSS
      // enquiry refused, so it has no bank-confirmed name to write — an ops-approved vendor's
      // public name is operator-reviewed observation data, never bank-confirmed.
      displayName: null,
      publicCode,
      now: input.now,
    });
    if (!claimedRow) return null;

    const attempt = await vendorClaimsRepo.findPendingByPhone(txDb, input.phone, input.now);
    if (attempt && attempt.vendorId === input.vendorId) {
      await vendorClaimsRepo.markVerified(txDb, attempt.id, 'ops', input.now);
    }

    await auditRepo.append(txDb, {
      actorKind: 'ops',
      // The MAKER is the actor: they asked for this business identity to be assigned. The
      // checker's agreement is recorded on the approval row, so both people are answerable for
      // their own part.
      actorAdminUserId: input.makerAdminUserId,
      action: 'vendor.claim_approved_by_ops',
      subjectKind: 'vendor',
      subjectId: input.vendorId,
      payloadJson: {
        claimantPhone: phoneFingerprint(input.phone),
        publicCode,
        category: input.category,
        ownershipProof: 'ops',
        // Recorded so the trail shows this went through two-person control, and names the second.
        checkerAdminUserId: input.checkerAdminUserId,
      },
    });
    return { publicCode, displayName: claimedRow.displayName };
  });
}
