import { beforeEach, describe, expect, it } from 'vitest';
import { RuleDeniedError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { catalogItemsRepo } from '../../../src/modules/marketplace/catalog-items.repo';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

/**
 * The parent's rules must reach the marketplace.
 *
 * Until SP5b they did not: `reserve` enforced the spend limit and nothing else, so a sub-wallet
 * locked to transport and school could buy a voucher for anything in the catalogue while the
 * identical spend as a bank transfer was held for approval.
 * `tools/demo/probe-marketplace.mjs` reproduces the original hole end to end.
 */
describe('marketplace purchase: the parent’s rules apply', () => {
  const NOW = new Date('2026-07-04T12:00:00.000Z');

  beforeEach(async () => {
    await truncateAll();
  });

  async function seed() {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      bvn: factories.bvn(),
      kycTier: '2',
    });
    const hh = await householdsRepo.insert(testDb, {
      principalUserId: principal.id,
      name: 'HH',
    });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id,
      anchorVirtualAccount: '0123456789',
      anchorBankCode: '058',
      anchorAccountId: `mw-${Math.random().toString(36).slice(2, 10)}`,
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id,
      agentUserId: agent.id,
      name: 'Errands',
    });
    const retailer = await retailersRepo.insert(testDb, {
      businessName: 'Ada Salon',
      payoutBankCode: '011',
      payoutAccountNumber: '9988776655',
      onboardingStatus: 'approved',
    });
    return { principal, agent, mw, sw, retailer };
  }

  async function seedItem(retailerId: string, category: string) {
    const row = await catalogItemsRepo.insert(testDb, {
      retailerId,
      name: 'Wash and set',
      priceKobo: kobo(300_000n),
      section: 'hair',
      category,
    });
    return row.id;
  }

  const lockTo = (subWalletId: string, principalUserId: string, categories: string[]) =>
    ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalUserId,
      rules: [{ kind: 'category', priority: 10, config: { mode: 'allowlist', categories } }],
    });

  const buy = (
    ctx: Awaited<ReturnType<typeof seed>>,
    catalogItemId: string,
    subWalletId: string | null,
  ) =>
    purchaseService.createFromCatalog(testDb, {
      actorUserId: subWalletId ? ctx.agent.id : ctx.principal.id,
      masterWalletId: ctx.mw.master.id,
      subWalletId,
      catalogItemId,
      idempotencyKey: factories.idempotencyKey(),
      now: NOW,
    });

  it('refuses an item outside the parent’s category allowlist', async () => {
    const ctx = await seed();
    await lockTo(ctx.sw.sub.id, ctx.principal.id, ['transport', 'school']);
    const itemId = await seedItem(ctx.retailer.id, 'health');

    await expect(buy(ctx, itemId, ctx.sw.sub.id)).rejects.toBeInstanceOf(RuleDeniedError);
  });

  it('names the reason, so the app can say why rather than "something went wrong"', async () => {
    const ctx = await seed();
    await lockTo(ctx.sw.sub.id, ctx.principal.id, ['transport']);
    const itemId = await seedItem(ctx.retailer.id, 'health');

    await expect(buy(ctx, itemId, ctx.sw.sub.id)).rejects.toMatchObject({
      reasons: ['CATEGORY_NOT_ALLOWED'],
    });
  });

  it('allows an item the parent did permit', async () => {
    const ctx = await seed();
    await lockTo(ctx.sw.sub.id, ctx.principal.id, ['transport', 'health']);
    const itemId = await seedItem(ctx.retailer.id, 'health');

    const { redemption } = await buy(ctx, itemId, ctx.sw.sub.id);
    expect(redemption.id).toBeTruthy();
  });

  it('blocks a category the parent explicitly blocklisted', async () => {
    const ctx = await seed();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: ctx.sw.sub.id,
      createdByUserId: ctx.principal.id,
      rules: [
        { kind: 'category', priority: 10, config: { mode: 'blocklist', categories: ['health'] } },
      ],
    });
    const itemId = await seedItem(ctx.retailer.id, 'health');
    await expect(buy(ctx, itemId, ctx.sw.sub.id)).rejects.toBeInstanceOf(RuleDeniedError);
  });

  // A principal is not bound by rules they wrote for someone else, and a principal-direct buy
  // spends the master wallet they own (decision #17).
  it('does not rule-gate a principal-direct purchase', async () => {
    const ctx = await seed();
    await lockTo(ctx.sw.sub.id, ctx.principal.id, ['transport']);
    const itemId = await seedItem(ctx.retailer.id, 'health');

    const { redemption } = await buy(ctx, itemId, null);
    expect(redemption.id).toBeTruthy();
  });

  it('allows anything when the parent has published no rules', async () => {
    const ctx = await seed();
    const itemId = await seedItem(ctx.retailer.id, 'health');
    const { redemption } = await buy(ctx, itemId, ctx.sw.sub.id);
    expect(redemption.id).toBeTruthy();
  });

  // Items predating the category column default to 'other', which an allowlist denies. That is
  // the safe direction: a column added under a live lock must not silently widen it.
  it('treats a legacy item with no explicit category as "other"', async () => {
    const ctx = await seed();
    await lockTo(ctx.sw.sub.id, ctx.principal.id, ['transport']);
    const row = await catalogItemsRepo.insert(testDb, {
      retailerId: ctx.retailer.id,
      name: 'Legacy',
      priceKobo: kobo(100_000n),
      section: 'misc',
    });
    await expect(buy(ctx, row.id, ctx.sw.sub.id)).rejects.toBeInstanceOf(RuleDeniedError);
  });
});
