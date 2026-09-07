import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NotFoundError } from '../../lib/errors';
import { type AdminApprovalKind, adminApprovalService } from './admin-approval.service';
import { type AdminPermission, adminIamService } from './admin-iam.service';
import { type ClaimApplied, adminOpsApprovalService } from './admin-ops-approval.service';

type DbOrTx = PostgresJsDatabase;

/**
 * What approving produced, if anything. A role grant has nothing to hand back; a vendor claim
 * mints a public code the checker has to read out to the merchant.
 */
export type ApprovalOutcome =
  | { kind: 'role_grant' }
  | ({ kind: 'vendor_approve_claim' } & ClaimApplied);

/**
 * The permission a checker needs to DECLINE each kind — the same one approving it needs.
 *
 * A total `Record` rather than a ternary for the same reason `approve` below uses an exhaustive
 * switch: adding a kind to the enum without deciding who may decline it must be a type error, not
 * a silent inheritance of whichever branch the `else` happened to be.
 */
const REJECT_PERMISSION: Record<AdminApprovalKind, AdminPermission> = {
  role_grant: 'iam.write',
  vendor_approve_claim: 'vendor.write',
};

/**
 * Routes an approval decision to whichever orchestrator owns that kind of action.
 *
 * It exists because the approvals inbox is one queue over several domains, while applying an
 * approved action is domain work: a role grant is `admin-iam.service`'s, a vendor claim is
 * `admin-ops-approval.service`'s. Putting the switch here keeps the route thin and — more
 * importantly — keeps `admin-approval.service` generic. That service records that somebody
 * proposed and somebody else agreed; it must never learn what a vendor is, or every future
 * maker-checked action would have to be added to it.
 *
 * The exhaustive switch is deliberate: adding a kind to the enum without teaching this dispatcher
 * about it is a type error, not a silent 500 in production.
 */
export const adminApprovalDispatch = {
  async approve(
    db: DbOrTx,
    input: { approvalId: string; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<ApprovalOutcome> {
    const approval = await adminApprovalService.findById(db, input.approvalId);
    if (!approval) throw new NotFoundError('approval_not_found');

    switch (approval.kind) {
      case 'role_grant':
        await adminIamService.approveRoleGrant(
          db,
          {
            approvalId: approval.id,
            checkerAdminUserId: input.checkerAdminUserId,
            reason: input.reason ?? null,
          },
          now,
        );
        return { kind: 'role_grant' };

      case 'vendor_approve_claim': {
        const applied = await adminOpsApprovalService.approveClaim(
          db,
          {
            approval,
            checkerAdminUserId: input.checkerAdminUserId,
            reason: input.reason ?? null,
          },
          now,
        );
        return { kind: 'vendor_approve_claim', ...applied };
      }
    }
  },

  /**
   * Declining is deciding. It needs the same permission as approving that kind — otherwise an
   * `auditor`, who writes nothing anywhere, could close a vendor claim, while the `ops` admin
   * meant to work the queue could not. The maker-cannot-be-checker rule is enforced by the
   * generic service underneath, exactly as for approve.
   */
  async reject(
    db: DbOrTx,
    input: { approvalId: string; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<void> {
    const approval = await adminApprovalService.findById(db, input.approvalId);
    if (!approval) throw new NotFoundError('approval_not_found');
    await adminIamService.requirePermission(
      db,
      input.checkerAdminUserId,
      REJECT_PERMISSION[approval.kind],
    );
    await adminApprovalService.reject(db, input, now);
  },
};
