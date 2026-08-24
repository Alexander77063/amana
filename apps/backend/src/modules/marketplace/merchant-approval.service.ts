import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { ruleSetService } from '../rules/rule-set.service';
import type { MerchantRuleConfig, Rule } from '../rules/types';
import { assertSubWalletAccess } from '../wallet/wallet-access.service';
import { retailersRepo } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

/** Where an approved-merchant rule sits relative to the parent's own rules. */
const MERCHANT_RULE_PRIORITY = 40;

/**
 * The control fusion (spec §8): **approving a merchant writes a rule.**
 *
 * The marketplace and the rule engine are deliberately one system. A principal approving Ada's
 * Salon does not add a row to some separate marketplace permission table — it edits the very rule
 * set that already governs the sub-wallet's limits, categories and hours, and the same engine
 * evaluates it.
 *
 * ## The dangerous part
 *
 * `publishNewVersion` **supersedes the active rule set and takes the whole rule array**. So
 * approval must read the current set, merge the merchant rule into it, and republish everything.
 * Publishing only the merchant rule would silently delete the parent's daily limit, category lock
 * and time window — turning "I approved one shop" into "I removed every restriction I had set".
 * That is the single worst thing this feature could do, and it is one forgotten spread away.
 *
 * `EditRulesScreen` publishes the whole set for exactly this reason; this follows it.
 */
export const merchantApprovalService = {
  /**
   * Approve a retailer for one sub-wallet. Idempotent: approving twice is a no-op rather than a
   * duplicate rule, so a double tap cannot grow the rule set without bound.
   */
  async approve(
    db: DbOrTx,
    input: { actorUserId: string; subWalletId: string; retailerId: string },
  ): Promise<{ retailerIds: string[] }> {
    // Ownership, not the role claim: only the principal who owns the household this sub-wallet
    // belongs to may change what it is allowed to buy.
    await assertSubWalletAccess(db, input.actorUserId, input.subWalletId, { principalOnly: true });

    const retailer = await retailersRepo.findById(db, input.retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${input.retailerId} not found`);
    if (retailer.onboardingStatus !== 'approved') {
      throw new ConflictError(`retailer ${input.retailerId} is not approved`);
    }

    return mutate(db, input, (ids) =>
      ids.includes(input.retailerId) ? ids : [...ids, input.retailerId],
    );
  },

  /** Withdraw approval. Removing the last retailer leaves an EMPTY merchant rule, which denies
   * everything — deliberately. A principal who has revoked everyone has approved nobody, and
   * dropping the rule entirely would silently re-open the whole catalogue instead. */
  async revoke(
    db: DbOrTx,
    input: { actorUserId: string; subWalletId: string; retailerId: string },
  ): Promise<{ retailerIds: string[] }> {
    await assertSubWalletAccess(db, input.actorUserId, input.subWalletId, { principalOnly: true });
    return mutate(db, input, (ids) => ids.filter((id) => id !== input.retailerId));
  },

  /** The retailers this sub-wallet may currently buy from. Null means no merchant rule is set —
   * which is NOT the same as an empty list: no rule means the marketplace is unrestricted. */
  async approvedRetailerIds(db: DbOrTx, subWalletId: string): Promise<string[] | null> {
    const active = await ruleSetService.getActiveWithRules(db, subWalletId);
    const rule = active?.rules.find((r) => r.kind === 'merchant');
    if (!rule) return null;
    return (rule.configJson as MerchantRuleConfig).retailerIds ?? [];
  },
};

async function mutate(
  db: DbOrTx,
  input: { actorUserId: string; subWalletId: string },
  next: (current: string[]) => string[],
): Promise<{ retailerIds: string[] }> {
  const active = await ruleSetService.getActiveWithRules(db, input.subWalletId);
  const existing = active?.rules ?? [];

  const current =
    (existing.find((r) => r.kind === 'merchant')?.configJson as MerchantRuleConfig | undefined)
      ?.retailerIds ?? [];
  const retailerIds = next(current);

  // Carry EVERY other rule through untouched. This spread is the whole safety property.
  const others = existing
    .filter((r) => r.kind !== 'merchant')
    .map(
      (r) =>
        ({ kind: r.kind, priority: r.priority, config: r.configJson }) as unknown as Omit<
          Rule,
          'id'
        >,
    );

  await ruleSetService.publishNewVersion(db, {
    subWalletId: input.subWalletId,
    createdByUserId: input.actorUserId,
    rules: [
      ...others,
      {
        kind: 'merchant',
        priority: MERCHANT_RULE_PRIORITY,
        config: { retailerIds },
      } as unknown as Omit<Rule, 'id'>,
    ],
  });

  return { retailerIds };
}
