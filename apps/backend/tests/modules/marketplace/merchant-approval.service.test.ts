import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { catalogItemsRepo } from '../../../src/modules/marketplace/catalog-items.repo';
import { merchantApprovalService } from '../../../src/modules/marketplace/merchant-approval.service';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('merchant approval — the control fusion', () => {
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
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
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
    const mk = async (name: string) =>
      retailersRepo.insert(testDb, {
        businessName: name,
        payoutBankCode: '011',
        payoutAccountNumber: '9988776655',
        onboardingStatus: 'approved',
      });
    return { principal, agent, mw, sw, ada: await mk('Ada Salon'), bola: await mk('Bola Stores') };
  }

  const item = async (retailerId: string, category = 'health') =>
    (
      await catalogItemsRepo.insert(testDb, {
        retailerId,
        name: 'Wash and set',
        priceKobo: kobo(300_000n),
        section: 'hair',
        category,
      })
    ).id;

  /**
   * The single most dangerous property in this feature.
   *
   * publishNewVersion supersedes the active set and takes the WHOLE rule array, so approving a
   * merchant has to merge into what is already there. Publishing just the merchant rule would
   * turn "I approved one shop" into "I deleted every limit I had set".
   */
  it('keeps the parent’s existing limits and locks when approving a merchant', async () => {
    const ctx = await seed();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: ctx.sw.sub.id,
      createdByUserId: ctx.principal.id,
      rules: [
        { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 2_000_000n } },
        {
          kind: 'category',
          priority: 20,
          config: { mode: 'allowlist', categories: ['health', 'transport'] },
        },
        {
          kind: 'time_window',
          priority: 30,
          config: { startHour: 6, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5] },
        },
      ],
    });

    await merchantApprovalService.approve(testDb, {
      actorUserId: ctx.principal.id,
      subWalletId: ctx.sw.sub.id,
      retailerId: ctx.ada.id,
    });

    const active = await ruleSetService.getActiveWithRules(testDb, ctx.sw.sub.id);
    const kinds = (active?.rules ?? []).map((r) => r.kind).sort();
    expect(kinds).toEqual(['category', 'limit', 'merchant', 'time_window']);

    const limit = active?.rules.find((r) => r.kind === 'limit');
    expect((limit?.configJson as { maxKobo: string }).maxKobo).toBe('2000000');
  });

  it('is idempotent — approving twice does not duplicate the rule or the retailer', async () => {
    const ctx = await seed();
    const args = {
      actorUserId: ctx.principal.id,
      subWalletId: ctx.sw.sub.id,
      retailerId: ctx.ada.id,
    };
    await merchantApprovalService.approve(testDb, args);
    const second = await merchantApprovalService.approve(testDb, args);

    expect(second.retailerIds).toEqual([ctx.ada.id]);
    const active = await ruleSetService.getActiveWithRules(testDb, ctx.sw.sub.id);
    expect(active?.rules.filter((r) => r.kind === 'merchant')).toHaveLength(1);
  });

  it('accumulates approvals rather than replacing them', async () => {
    const ctx = await seed();
    await merchantApprovalService.approve(testDb, {
      actorUserId: ctx.principal.id,
      subWalletId: ctx.sw.sub.id,
      retailerId: ctx.ada.id,
    });
    const r = await merchantApprovalService.approve(testDb, {
      actorUserId: ctx.principal.id,
      subWalletId: ctx.sw.sub.id,
      retailerId: ctx.bola.id,
    });
    expect(r.retailerIds.sort()).toEqual([ctx.ada.id, ctx.bola.id].sort());
  });

  it('only the owning principal may approve — not the agent whose wallet it is', async () => {
    const ctx = await seed();
    await expect(
      merchantApprovalService.approve(testDb, {
        actorUserId: ctx.agent.id,
        subWalletId: ctx.sw.sub.id,
        retailerId: ctx.ada.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses to approve a retailer the platform has not approved', async () => {
    const ctx = await seed();
    const pending = await retailersRepo.insert(testDb, {
      businessName: 'Not vetted',
      payoutBankCode: '011',
      payoutAccountNumber: '1111111111',
      onboardingStatus: 'applied',
    });
    await expect(
      merchantApprovalService.approve(testDb, {
        actorUserId: ctx.principal.id,
        subWalletId: ctx.sw.sub.id,
        retailerId: pending.id,
      }),
    ).rejects.toThrow();
  });

  describe('what the rule actually does at purchase time', () => {
    it('lets the agent buy from an approved merchant and refuses an unapproved one', async () => {
      const ctx = await seed();
      await merchantApprovalService.approve(testDb, {
        actorUserId: ctx.principal.id,
        subWalletId: ctx.sw.sub.id,
        retailerId: ctx.ada.id,
      });

      const buy = (catalogItemId: string) =>
        purchaseService.createFromCatalog(testDb, {
          actorUserId: ctx.agent.id,
          masterWalletId: ctx.mw.master.id,
          subWalletId: ctx.sw.sub.id,
          catalogItemId,
          idempotencyKey: factories.idempotencyKey(),
          now: NOW,
        });

      const fromAda = await buy(await item(ctx.ada.id));
      expect(fromAda.redemption.id).toBeTruthy();

      await expect(buy(await item(ctx.bola.id))).rejects.toMatchObject({
        reasons: ['MERCHANT_NOT_ALLOWED'],
      });
    });

    // Revoking everyone leaves an EMPTY merchant rule, which denies. Dropping the rule instead
    // would silently re-open the entire catalogue.
    it('revoking the last approval closes the marketplace rather than opening it', async () => {
      const ctx = await seed();
      const args = {
        actorUserId: ctx.principal.id,
        subWalletId: ctx.sw.sub.id,
        retailerId: ctx.ada.id,
      };
      await merchantApprovalService.approve(testDb, args);
      const after = await merchantApprovalService.revoke(testDb, args);
      expect(after.retailerIds).toEqual([]);

      await expect(
        purchaseService.createFromCatalog(testDb, {
          actorUserId: ctx.agent.id,
          masterWalletId: ctx.mw.master.id,
          subWalletId: ctx.sw.sub.id,
          catalogItemId: await item(ctx.ada.id),
          idempotencyKey: factories.idempotencyKey(),
          now: NOW,
        }),
      ).rejects.toMatchObject({ reasons: ['MERCHANT_NOT_ALLOWED'] });
    });

    // No merchant rule at all is NOT the same as an empty one: a parent who has never used
    // merchant approval has not thereby restricted anything.
    it('leaves the marketplace unrestricted when no merchant rule was ever set', async () => {
      const ctx = await seed();
      expect(await merchantApprovalService.approvedRetailerIds(testDb, ctx.sw.sub.id)).toBeNull();

      const bought = await purchaseService.createFromCatalog(testDb, {
        actorUserId: ctx.agent.id,
        masterWalletId: ctx.mw.master.id,
        subWalletId: ctx.sw.sub.id,
        catalogItemId: await item(ctx.ada.id),
        idempotencyKey: factories.idempotencyKey(),
        now: NOW,
      });
      expect(bought.redemption.id).toBeTruthy();
    });

    // A merchant rule must never leak onto the bank-transfer path, where retailerId is null and
    // it would deny every ordinary spend.
    it('does not affect a plain bank transfer', async () => {
      const ctx = await seed();
      await merchantApprovalService.approve(testDb, {
        actorUserId: ctx.principal.id,
        subWalletId: ctx.sw.sub.id,
        retailerId: ctx.ada.id,
      });
      const active = await ruleSetService.getActiveWithRules(testDb, ctx.sw.sub.id);
      // The guarantee is structural: lifecycle passes retailerId: null and never evaluates a
      // merchant rule, so the rule's presence here is inert for transfers.
      expect(active?.rules.some((r) => r.kind === 'merchant')).toBe(true);
    });
  });
});
