import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { type RetailerOnboardingStatus, type RetailerRow, retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * The only Anchor surface this service needs. Narrowing it to the one method keeps the
 * service testable without constructing (or stubbing) the whole adapter.
 */
export type BusinessKybClient = Pick<AnchorAdapter, 'createBusinessCustomer'>;

export type ApplyInput = {
  businessName: string;
  payoutBankCode: string;
  payoutAccountNumber: string;
};

export type SubmitKybInput = { bvn: string; rcNumber?: string; email?: string };

/** Statuses a retailer may submit (or re-submit) KYB from. */
const KYB_SUBMITTABLE: readonly RetailerOnboardingStatus[] = ['applied', 'kyb_pending'];
/** Statuses an ops operator may manually approve from — never from `suspended`. */
const MANUALLY_APPROVABLE: readonly RetailerOnboardingStatus[] = ['applied', 'kyb_pending'];

/**
 * Curated retailer onboarding: `applied → kyb_pending → approved | suspended`.
 *
 * Every guarded transition is an atomic compare-and-set in the repo, never a
 * read-then-write — a KYB re-submit racing a `kyb.approved` webhook must not be able to
 * pull an already-approved retailer back to `kyb_pending`. The read that precedes each
 * CAS exists only to produce a precise 404/409, not to enforce the guard.
 */
export const retailerOnboardingService = {
  async apply(db: DbOrTx, input: ApplyInput): Promise<RetailerRow> {
    const retailer = await retailersRepo.insert(db, { ...input, onboardingStatus: 'applied' });
    await auditRepo.append(
      db,
      auditEvents.retailerOnboardingChanged({
        retailerId: retailer.id,
        action: 'applied',
        at: new Date(),
        details: { businessName: retailer.businessName },
      }),
    );
    return retailer;
  },

  /**
   * Create the Anchor business customer and move the retailer to `kyb_pending`.
   *
   * Anchor is called before the status write, keyed `kyb:<retailerId>` so a retry (or two
   * concurrent submits) resolves to the same business customer rather than creating a
   * second one. The status write is the CAS, so it is the write — not the read — that
   * decides whether the transition was legal.
   */
  async submitKyb(
    db: DbOrTx,
    retailerId: string,
    input: SubmitKybInput,
    anchor: BusinessKybClient,
  ): Promise<RetailerRow> {
    const retailer = await retailersRepo.findById(db, retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${retailerId} not found`);
    if (!KYB_SUBMITTABLE.includes(retailer.onboardingStatus)) {
      throw new ConflictError(
        `retailer ${retailerId} cannot submit KYB from status ${retailer.onboardingStatus}`,
      );
    }

    const biz = await anchor.createBusinessCustomer(
      {
        businessName: retailer.businessName,
        bvn: input.bvn,
        ...(input.rcNumber !== undefined && { rcNumber: input.rcNumber }),
        ...(input.email !== undefined && { email: input.email }),
      },
      `kyb:${retailerId}`,
    );

    const updated = await retailersRepo.transitionOnboardingStatus(
      db,
      retailerId,
      KYB_SUBMITTABLE,
      'kyb_pending',
      { anchorBusinessCustomerId: biz.id },
    );
    if (!updated) {
      throw new ConflictError(
        `retailer ${retailerId} changed status during KYB submission; not re-opened`,
      );
    }
    // Deliberately records that KYB was submitted and nothing about its content: the BVN and the
    // RC number are exactly the identity data the audit log must not accumulate a second copy of.
    await auditRepo.append(
      db,
      auditEvents.retailerOnboardingChanged({
        retailerId,
        action: 'kyb_submitted',
        at: new Date(),
        details: { anchorBusinessCustomerId: biz.id },
      }),
    );
    return updated;
  },

  /**
   * `kyb.approved` webhook. Idempotent: a re-delivered event finds the retailer already
   * `approved`, the CAS no-ops, and the current row is returned so the webhook still 200s.
   * Returns undefined only when no retailer matches the business customer id.
   */
  async handleKybApproved(
    db: DbOrTx,
    businessCustomerId: string,
  ): Promise<RetailerRow | undefined> {
    const result = await transitionByBusinessCustomerId(db, businessCustomerId, 'approved');
    if (result?.transitioned)
      logger.info({ businessCustomerId }, 'kyb.approved: retailer approved');
    return result?.row;
  },

  /** `kyb.rejected` webhook. Same idempotency contract as `handleKybApproved`. */
  async handleKybRejected(
    db: DbOrTx,
    businessCustomerId: string,
    reason: string,
  ): Promise<RetailerRow | undefined> {
    const result = await transitionByBusinessCustomerId(db, businessCustomerId, 'suspended');
    if (result?.transitioned) {
      logger.warn({ businessCustomerId, reason }, 'kyb.rejected: retailer suspended');
    } else if (result) {
      // A late rejection for a retailer that already left kyb_pending. Worth surfacing —
      // it means Anchor and our state disagree — but it must not change the status.
      logger.warn(
        { businessCustomerId, reason, onboardingStatus: result.row.onboardingStatus },
        'kyb.rejected: ignored, retailer no longer kyb_pending',
      );
    }
    return result?.row;
  },

  /**
   * Manual ops approval — the documented bypass of the KYB wait (a retailer verified
   * out-of-band). Deliberately NOT reachable from `suspended`: un-suspending is a separate
   * decision that must go back through KYB.
   */
  async approve(db: DbOrTx, retailerId: string): Promise<RetailerRow> {
    const retailer = await retailersRepo.findById(db, retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${retailerId} not found`);
    const updated = await retailersRepo.transitionOnboardingStatus(
      db,
      retailerId,
      MANUALLY_APPROVABLE,
      'approved',
      // Stamped in the same statement as the status, so the two can never disagree. This is what
      // later distinguishes a retailer that was live and got suspended — whose already-sold
      // vouchers must still be honoured — from one whose KYB was rejected, which lands in the
      // very same `suspended` status but was never approved at all.
      { approvedAt: new Date() },
    );
    if (!updated) {
      throw new ConflictError(
        `retailer ${retailerId} cannot be approved from status ${retailer.onboardingStatus}`,
      );
    }
    // Written only after the transition succeeded, so the trail never claims an approval that a
    // status conflict actually refused.
    await auditRepo.append(
      db,
      auditEvents.retailerOnboardingChanged({
        retailerId,
        action: 'approved',
        at: new Date(),
        details: { fromStatus: retailer.onboardingStatus },
      }),
    );
    return updated;
  },

  /** Kill switch — legal from any status, including `approved` and `suspended` (no-op). */
  async suspend(db: DbOrTx, retailerId: string): Promise<RetailerRow> {
    const before = await retailersRepo.findById(db, retailerId);
    const updated = await retailersRepo.updateOnboardingStatus(db, retailerId, 'suspended');
    if (!updated) throw new NotFoundError(`retailer ${retailerId} not found`);
    await auditRepo.append(
      db,
      auditEvents.retailerOnboardingChanged({
        retailerId,
        action: 'suspended',
        at: new Date(),
        details: { fromStatus: before?.onboardingStatus ?? null },
      }),
    );
    return updated;
  },
};

async function transitionByBusinessCustomerId(
  db: DbOrTx,
  businessCustomerId: string,
  to: RetailerOnboardingStatus,
): Promise<{ row: RetailerRow; transitioned: boolean } | undefined> {
  const retailer = await retailersRepo.findByAnchorBusinessCustomerId(db, businessCustomerId);
  if (!retailer) return undefined;
  const updated = await retailersRepo.transitionOnboardingStatus(
    db,
    retailer.id,
    ['kyb_pending'],
    to,
    to === 'approved' ? { approvedAt: new Date() } : {},
  );
  // CAS miss = the retailer already left `kyb_pending` (re-delivered event, or an ops
  // decision landed first). Return the row unchanged so the webhook acks instead of retrying.
  return updated ? { row: updated, transitioned: true } : { row: retailer, transitioned: false };
}
