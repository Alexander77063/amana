import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { type RetailerRow, retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * Authorisation for everything the retailer portal touches.
 *
 * The rule the rest of this codebase follows (decisions #7/#17) applies here unchanged: the JWT
 * only says who someone is, never what they may reach. A caller is authorised for a retailer
 * because they ARE its `ownerUserId`, not because their token claims `actor: 'retailer'` — so a
 * forged role claim still fails, and so does a real retailer reaching for a different retailer's
 * catalogue.
 *
 * These live in the service layer rather than in route middleware for the same reason the wallet
 * ones do: a route is a thing someone can add without noticing the check, and a service is not.
 */
export const retailerAccessService = {
  /**
   * The retailer this user owns, or a refusal. Never trusts a retailerId supplied by the caller.
   */
  async assertRetailerAccess(db: DbOrTx, actorUserId: string): Promise<RetailerRow> {
    const retailer = await retailersRepo.findByOwnerUserId(db, actorUserId);
    if (!retailer) throw new ForbiddenError('not_a_retailer_owner');
    return retailer;
  },

  /**
   * As above, but for a route that names a retailer in its path. The id is checked against
   * ownership rather than used to look anything up on its own — the difference between a
   * scoped read and an IDOR.
   */
  async assertOwnsRetailer(
    db: DbOrTx,
    actorUserId: string,
    retailerId: string,
  ): Promise<RetailerRow> {
    const retailer = await retailersRepo.findById(db, retailerId);
    if (!retailer) throw new NotFoundError('retailer_not_found');
    if (retailer.ownerUserId !== actorUserId) throw new ForbiddenError('not_your_retailer');
    return retailer;
  },

  /**
   * May this retailer add supply — publish catalogue items, run deals, be found by buyers?
   *
   * Only an approved retailer may. A suspended one is cut off from NEW supply, which is what
   * suspension is for; it deliberately keeps the ability to redeem vouchers already sold (see
   * `assertCanRedeem`).
   */
  assertCanPublish(retailer: RetailerRow): void {
    if (retailer.onboardingStatus !== 'approved') {
      throw new ForbiddenError(`retailer_${retailer.onboardingStatus}`);
    }
  },

  /**
   * May this retailer redeem a voucher a buyer already holds?
   *
   * Yes, even when suspended — and that is a decision, not an oversight. The buyer has already
   * paid; refusing the redemption strands them to punish the retailer, which puts the cost on
   * the wrong party. Suspension stops new supply, not the honouring of what was already sold.
   * Documented in docs/runbook/retailer-onboarding.md.
   *
   * A retailer that never completed KYB is a different matter: redemption settles money to a
   * payout account, and that account has not been verified, so there is nothing to pay into.
   */
  assertCanRedeem(retailer: RetailerRow): void {
    // Keyed on having ACTUALLY been approved, not on the current status and not on the presence
    // of an Anchor business customer id. That id is written when KYB is submitted, before Anchor
    // rules on it, so it is true of a retailer whose KYB was later rejected — and a rejection
    // lands in `suspended`, the same status ops-suspension produces. `approvedAt` is the only
    // field that separates "was live, now suspended" (must still honour sold vouchers) from
    // "never passed KYB" (has no sold vouchers, and no verified account to be paid into).
    if (retailer.approvedAt === null) throw new ForbiddenError('kyb_incomplete');
  },

  /**
   * May money be paid out to this retailer?
   *
   * Keyed on `approvedAt`, not on the onboarding status. Retailers created before SP4 default to
   * `approved` because SP2 made them live-approved, so status alone would wave a legacy row past
   * a KYB it never actually passed — and those rows have no `approvedAt`.
   */
  assertPayable(retailer: RetailerRow): void {
    if (retailer.approvedAt === null) throw new ForbiddenError('kyb_incomplete');
  },
};
