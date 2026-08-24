import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { catalogItemsRepo } from '../../src/modules/marketplace/catalog-items.repo';
import { dealsService } from '../../src/modules/marketplace/deals.service';
import { merchantApprovalService } from '../../src/modules/marketplace/merchant-approval.service';
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { ruleSetService } from '../../src/modules/rules/rule-set.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer();

describe('marketplace browse', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function household() {
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
    return { principal, agent, sw };
  }

  async function retailerWithItem(
    name: string,
    category: string,
    section: string,
    price = 300_000n,
  ) {
    const r = await retailersRepo.insert(testDb, {
      businessName: name,
      payoutBankCode: '011',
      payoutAccountNumber: '9988776655',
      onboardingStatus: 'approved',
    });
    const item = await catalogItemsRepo.insert(testDb, {
      retailerId: r.id,
      name: `${name} service`,
      priceKobo: kobo(price),
      section,
      category,
    });
    return { retailer: r, item };
  }

  it('shows a principal the whole marketplace', async () => {
    const { principal } = await household();
    await retailerWithItem('Ada Salon', 'health', 'hair');
    await retailerWithItem('Bola Stores', 'food', 'grocery');

    const res = await app.request('/marketplace/items', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ retailerName: string }> };
    expect(body.items.map((i) => i.retailerName).sort()).toEqual(['Ada Salon', 'Bola Stores']);
  });

  // §8: "agents only ever see what they're already allowed to buy". The filter comes from the
  // same rule set the purchase path enforces, so browse cannot show what buying would refuse.
  it('shows an agent only categories their parent allowed', async () => {
    const { principal, agent, sw } = await household();
    await retailerWithItem('Ada Salon', 'health', 'hair');
    await retailerWithItem('Danfo Co', 'transport', 'rides');

    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [
        {
          kind: 'category',
          priority: 10,
          config: { mode: 'allowlist', categories: ['transport'] },
        },
      ],
    });

    const res = await app.request('/marketplace/items', { headers: await bearerHeaders(agent) });
    const body = (await res.json()) as { items: Array<{ retailerName: string }> };
    expect(body.items.map((i) => i.retailerName)).toEqual(['Danfo Co']);
  });

  it('shows an agent only merchants their parent approved', async () => {
    const { principal, agent, sw } = await household();
    const ada = await retailerWithItem('Ada Salon', 'health', 'hair');
    await retailerWithItem('Bola Stores', 'health', 'grocery');

    await merchantApprovalService.approve(testDb, {
      actorUserId: principal.id,
      subWalletId: sw.sub.id,
      retailerId: ada.retailer.id,
    });

    const res = await app.request('/marketplace/items', { headers: await bearerHeaders(agent) });
    const body = (await res.json()) as { items: Array<{ retailerName: string }> };
    expect(body.items.map((i) => i.retailerName)).toEqual(['Ada Salon']);
  });

  // An empty merchant rule denies everything, so an honest catalogue is an empty one.
  it('shows an agent nothing when their parent has revoked every merchant', async () => {
    const { principal, agent, sw } = await household();
    const ada = await retailerWithItem('Ada Salon', 'health', 'hair');
    const args = {
      actorUserId: principal.id,
      subWalletId: sw.sub.id,
      retailerId: ada.retailer.id,
    };
    await merchantApprovalService.approve(testDb, args);
    await merchantApprovalService.revoke(testDb, args);

    const res = await app.request('/marketplace/items', { headers: await bearerHeaders(agent) });
    expect((await res.json()) as { items: unknown[] }).toEqual({ items: [] });
    const sections = await app.request('/marketplace/sections', {
      headers: await bearerHeaders(agent),
    });
    expect((await sections.json()) as { sections: unknown[] }).toEqual({ sections: [] });
  });

  // Browsing must not become a way to read another household's approvals.
  it('ignores a sub-wallet id an agent supplies, using their own', async () => {
    const a = await household();
    const b = await household();
    await retailerWithItem('Ada Salon', 'health', 'hair');

    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: a.sw.sub.id,
      createdByUserId: a.principal.id,
      rules: [
        {
          kind: 'category',
          priority: 10,
          config: { mode: 'allowlist', categories: ['transport'] },
        },
      ],
    });

    // Agent A asks to browse as B's sub-wallet, which has no restrictions.
    const res = await app.request(`/marketplace/items?subWalletId=${b.sw.sub.id}`, {
      headers: await bearerHeaders(a.agent),
    });
    // A's own lock still applies: the health item stays hidden.
    expect((await res.json()) as { items: unknown[] }).toEqual({ items: [] });
  });

  it('refuses a principal previewing a sub-wallet they do not own', async () => {
    const a = await household();
    const b = await household();
    const res = await app.request(`/marketplace/items?subWalletId=${b.sw.sub.id}`, {
      headers: await bearerHeaders(a.principal),
    });
    expect(res.status).toBe(403);
  });

  it('400s a malformed sub-wallet id rather than 500ing', async () => {
    const { principal } = await household();
    const res = await app.request('/marketplace/items?subWalletId=not-a-uuid', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(400);
  });

  // A buyer screen that renders the list price quotes a number they will not be charged.
  it('prices items with the active deal, not the list price', async () => {
    const { principal } = await household();
    const ada = await retailerWithItem('Ada Salon', 'health', 'hair', 20_000n);
    await dealsService.createDeal(testDb, {
      retailerId: ada.retailer.id,
      catalogItemId: ada.item.id,
      discountBps: 2500,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
    });

    const res = await app.request('/marketplace/items', {
      headers: await bearerHeaders(principal),
    });
    const body = (await res.json()) as {
      items: Array<{ grossKobo: string; effectiveKobo: string; dealId: string | null }>;
    };
    expect(body.items[0]).toMatchObject({ grossKobo: '20000', effectiveKobo: '15000' });
    expect(body.items[0]?.dealId).toBeTruthy();
  });

  it('lists sections a buyer can actually reach', async () => {
    const { principal } = await household();
    await retailerWithItem('Ada Salon', 'health', 'hair');
    await retailerWithItem('Danfo Co', 'transport', 'rides');

    const res = await app.request('/marketplace/sections', {
      headers: await bearerHeaders(principal),
    });
    expect((await res.json()) as { sections: string[] }).toEqual({ sections: ['hair', 'rides'] });
  });
});
