import { beforeEach, describe, expect, it } from 'vitest';
import { postings, redemptions, transactions } from '../../../src/db/schema';
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { catalogItemsRepo } from '../../../src/modules/marketplace/catalog-items.repo';
import { MARKETPLACE_COMMISSION_BPS } from '../../../src/modules/marketplace/config';
import { dealsService } from '../../../src/modules/marketplace/deals.service';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { redemptionsRepo } from '../../../src/modules/marketplace/redemptions.repo';
import {
  type RetailerOnboardingStatus,
  retailersRepo,
} from '../../../src/modules/marketplace/retailers.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seed() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
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
    name: 'Driver',
  });
  return { principal, agent, mw, sw };
}

function baseInput(over: Record<string, unknown>) {
  return {
    retailerId: 'retailer-1',
    catalogItemId: 'item-1',
    retailerBankCode: '058',
    retailerAccount: '0123456789',
    grossKobo: kobo(20_000n),
    discountedKobo: kobo(12_345n),
    idempotencyKey: factories.idempotencyKey(),
    now: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
}

async function countRows() {
  const txns = await testDb.select().from(transactions);
  const reds = await testDb.select().from(redemptions);
  const posts = await testDb.select().from(postings);
  return { txns: txns.length, reds: reds.length, posts: posts.length };
}

describe('purchaseService.create — reserve', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(a) writes the two reserve legs: debits source, credits suspense by discounted', async () => {
    const { agent, mw, sw } = await seed();
    const beforeSource = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);
    const beforeSuspense = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);

    const { transaction, redemption } = await purchaseService.create(
      testDb,
      baseInput({
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
      }),
    );

    // Exactly two postings for this reserve txn.
    const legs = await postingsRepo.listByTransaction(testDb, transaction.id);
    expect(legs.length).toBe(2);

    // Source is debit-normal → balance rises by discounted; suspense credit-normal → falls.
    const afterSource = await postingsRepo.accountBalance(testDb, sw.ledgerAccountId);
    const afterSuspense = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    expect(afterSource - beforeSource).toBe(12_345n);
    expect(afterSuspense - beforeSuspense).toBe(-12_345n);

    expect(transaction.kind).toBe('marketplace_purchase');
    expect(transaction.amountKobo).toBe(12_345n);
    expect(redemption.status).toBe('reserved');
  });

  it('(b) creates a reserved redemption with code/qr/expiry and 5% floored commission', async () => {
    const { agent, mw, sw } = await seed();
    const now = new Date('2026-07-01T00:00:00Z');

    const { redemption } = await purchaseService.create(
      testDb,
      baseInput({
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        now,
      }),
    );

    const row = await redemptionsRepo.findById(testDb, redemption.id);
    expect(row?.status).toBe('reserved');
    expect(row?.code).toMatch(/^AMN-/);
    expect(row?.qrToken).toBeTruthy();
    expect(row?.grossKobo).toBe(20_000n);
    expect(row?.discountedKobo).toBe(12_345n);
    // 12_345 * 500 / 10000 = 617.25 → floor 617
    expect(MARKETPLACE_COMMISSION_BPS).toBe(500);
    expect(row?.commissionKobo).toBe(617n);
    // expiresAt = now + 168h exactly.
    expect(row?.expiresAt.getTime()).toBe(now.getTime() + 168 * 3600 * 1000);
  });

  it('(c) same idempotencyKey twice → one reservation, legs written once', async () => {
    const { agent, mw, sw } = await seed();
    const input = baseInput({
      actorUserId: agent.id,
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
    });

    const first = await purchaseService.create(testDb, input);
    const second = await purchaseService.create(testDb, input);

    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.redemption.id).toBe(first.redemption.id);

    const c = await countRows();
    expect(c.txns).toBe(1);
    expect(c.reds).toBe(1);
    expect(c.posts).toBe(2);
  });

  it('(d) a non-owner actor → ForbiddenError, nothing written', async () => {
    const { mw, sw } = await seed();
    const stranger = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });

    await expect(
      purchaseService.create(
        testDb,
        baseInput({
          actorUserId: stranger.id,
          masterWalletId: mw.master.id,
          subWalletId: sw.sub.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const c = await countRows();
    expect(c.txns).toBe(0);
    expect(c.reds).toBe(0);
    expect(c.posts).toBe(0);
  });

  it('(e) principal-direct (subWalletId null): source is masterLA; principal ok, stranger Forbidden', async () => {
    const { principal, mw } = await seed();
    const beforeMaster = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.master);
    const beforeSuspense = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);

    const { transaction } = await purchaseService.create(
      testDb,
      baseInput({
        actorUserId: principal.id,
        masterWalletId: mw.master.id,
        subWalletId: null,
      }),
    );

    expect(transaction.subWalletId).toBeNull();
    const afterMaster = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.master);
    const afterSuspense = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
    expect(afterMaster - beforeMaster).toBe(12_345n);
    expect(afterSuspense - beforeSuspense).toBe(-12_345n);

    const stranger = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await expect(
      purchaseService.create(
        testDb,
        baseInput({
          actorUserId: stranger.id,
          masterWalletId: mw.master.id,
          subWalletId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('purchaseService.create — spend-limit enforcement (SP5)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedWithLimit(maxKobo: bigint) {
    const s = await seed();
    // Daily limit on the agent's sub-wallet.
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: s.sw.sub.id,
      createdByUserId: s.principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo } }],
    });
    return s;
  }

  it('(a) agent purchase over the daily limit → LimitExceededError, nothing written', async () => {
    const { agent, mw, sw } = await seedWithLimit(10_000n);

    await expect(
      purchaseService.create(
        testDb,
        baseInput({
          actorUserId: agent.id,
          masterWalletId: mw.master.id,
          subWalletId: sw.sub.id,
          grossKobo: kobo(20_000n),
          discountedKobo: kobo(15_000n), // > 10_000 limit
        }),
      ),
    ).rejects.toBeInstanceOf(LimitExceededError);

    const c = await countRows();
    expect(c.txns).toBe(0);
    expect(c.reds).toBe(0);
    expect(c.posts).toBe(0);
  });

  it('(b) agent purchase under the daily limit → reserves normally', async () => {
    const { agent, mw, sw } = await seedWithLimit(10_000n);

    const { transaction, redemption } = await purchaseService.create(
      testDb,
      baseInput({
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        grossKobo: kobo(20_000n),
        discountedKobo: kobo(5_000n), // under 10_000
      }),
    );

    expect(transaction.kind).toBe('marketplace_purchase');
    expect(redemption.status).toBe('reserved');
    const c = await countRows();
    expect(c.txns).toBe(1);
    expect(c.reds).toBe(1);
    expect(c.posts).toBe(2);
  });

  it('(c) two purchases each under the limit but together over it → the second throws', async () => {
    const { agent, mw, sw } = await seedWithLimit(10_000n);

    // First 6_000 hold: 0 + 6_000 <= 10_000 → reserves.
    await purchaseService.create(
      testDb,
      baseInput({
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        grossKobo: kobo(20_000n),
        discountedKobo: kobo(6_000n),
      }),
    );

    // Second 6_000: window already holds 6_000 → 12_000 > 10_000 → throws (the window gate).
    await expect(
      purchaseService.create(
        testDb,
        baseInput({
          actorUserId: agent.id,
          masterWalletId: mw.master.id,
          subWalletId: sw.sub.id,
          grossKobo: kobo(20_000n),
          discountedKobo: kobo(6_000n),
        }),
      ),
    ).rejects.toBeInstanceOf(LimitExceededError);

    // Only the first reserve persisted.
    const c = await countRows();
    expect(c.txns).toBe(1);
    expect(c.reds).toBe(1);
    expect(c.posts).toBe(2);
  });

  it('(d) principal-direct purchase (subWalletId null) ignores the limit', async () => {
    // Publish a tiny limit on the sub-wallet, then buy principal-direct off the master LA.
    const { principal, mw } = await seedWithLimit(1n);

    const { transaction, redemption } = await purchaseService.create(
      testDb,
      baseInput({
        actorUserId: principal.id,
        masterWalletId: mw.master.id,
        subWalletId: null,
        grossKobo: kobo(20_000n),
        discountedKobo: kobo(15_000n), // would blow the sub-wallet limit, but no sub-wallet here
      }),
    );

    expect(transaction.subWalletId).toBeNull();
    expect(redemption.status).toBe('reserved');
  });
});

describe('purchaseService.createFromCatalog — server-side pricing', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  const NOW = new Date('2026-07-04T12:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  async function seedRetailer(
    onboardingStatus: RetailerOnboardingStatus = 'approved',
  ): Promise<{ id: string; payoutBankCode: string; payoutAccountNumber: string }> {
    const row = await retailersRepo.insert(testDb, {
      businessName: 'Mama Put',
      payoutBankCode: '011',
      payoutAccountNumber: '9988776655',
      onboardingStatus,
    });
    return {
      id: row.id,
      payoutBankCode: row.payoutBankCode,
      payoutAccountNumber: row.payoutAccountNumber,
    };
  }

  async function seedItem(
    retailerId: string,
    priceKobo: bigint,
    status: 'active' | 'inactive' = 'active',
  ): Promise<string> {
    const row = await catalogItemsRepo.insert(testDb, {
      retailerId,
      name: 'Jollof',
      priceKobo: kobo(priceKobo),
      section: 'Food',
      status,
    });
    return row.id;
  }

  it('(a) prices from an active deal and uses the retailer payout bank', async () => {
    const { agent, mw, sw } = await seed();
    const retailer = await seedRetailer();
    const itemId = await seedItem(retailer.id, 20_000n);
    // 25% off 20_000 = 5_000 discount → 15_000 discounted.
    const deal = await dealsService.createDeal(testDb, {
      retailerId: retailer.id,
      catalogItemId: itemId,
      discountBps: 2500,
      startsAt: new Date(NOW.getTime() - DAY),
      endsAt: new Date(NOW.getTime() + DAY),
    });

    const { transaction, redemption } = await purchaseService.createFromCatalog(testDb, {
      actorUserId: agent.id,
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      catalogItemId: itemId,
      idempotencyKey: factories.idempotencyKey(),
      now: NOW,
    });

    expect(redemption.grossKobo).toBe(20_000n);
    expect(redemption.discountedKobo).toBe(15_000n);
    expect(redemption.dealId).toBe(deal.id);
    expect(redemption.retailerId).toBe(retailer.id);
    expect(redemption.catalogItemId).toBe(itemId);
    expect(transaction.amountKobo).toBe(15_000n);
    // The reserve records the retailer's payout bank as the eventual NIP destination.
    expect(transaction.vendorBankCode).toBe(retailer.payoutBankCode);
    expect(transaction.vendorAccount).toBe(retailer.payoutAccountNumber);
  });

  it('(b) no active deal → discounted equals gross, dealId null', async () => {
    const { agent, mw, sw } = await seed();
    const retailer = await seedRetailer();
    const itemId = await seedItem(retailer.id, 20_000n);

    const { redemption } = await purchaseService.createFromCatalog(testDb, {
      actorUserId: agent.id,
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      catalogItemId: itemId,
      idempotencyKey: factories.idempotencyKey(),
      now: NOW,
    });

    expect(redemption.grossKobo).toBe(20_000n);
    expect(redemption.discountedKobo).toBe(20_000n);
    expect(redemption.dealId).toBeNull();
  });

  it('(c) unknown catalog item → NotFoundError, nothing written', async () => {
    const { agent, mw, sw } = await seed();
    await expect(
      purchaseService.createFromCatalog(testDb, {
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        catalogItemId: '00000000-0000-0000-0000-000000000000',
        idempotencyKey: factories.idempotencyKey(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const c = await countRows();
    expect(c.txns).toBe(0);
    expect(c.reds).toBe(0);
  });

  it('(d) inactive catalog item → ConflictError, nothing written', async () => {
    const { agent, mw, sw } = await seed();
    const retailer = await seedRetailer();
    const itemId = await seedItem(retailer.id, 20_000n, 'inactive');

    await expect(
      purchaseService.createFromCatalog(testDb, {
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        catalogItemId: itemId,
        idempotencyKey: factories.idempotencyKey(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const c = await countRows();
    expect(c.txns).toBe(0);
    expect(c.reds).toBe(0);
  });

  it('(e) unapproved retailer → ConflictError, nothing written', async () => {
    const { agent, mw, sw } = await seed();
    const retailer = await seedRetailer('applied');
    const itemId = await seedItem(retailer.id, 20_000n);

    await expect(
      purchaseService.createFromCatalog(testDb, {
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        catalogItemId: itemId,
        idempotencyKey: factories.idempotencyKey(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const c = await countRows();
    expect(c.txns).toBe(0);
    expect(c.reds).toBe(0);
  });

  it('(f) agent over the daily limit → LimitExceededError, nothing written', async () => {
    const { principal, agent, mw, sw } = await seed();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId: sw.sub.id,
      createdByUserId: principal.id,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 10_000n } }],
    });
    const retailer = await seedRetailer();
    const itemId = await seedItem(retailer.id, 20_000n); // no deal → discounted 20_000 > 10_000

    await expect(
      purchaseService.createFromCatalog(testDb, {
        actorUserId: agent.id,
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        catalogItemId: itemId,
        idempotencyKey: factories.idempotencyKey(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LimitExceededError);
    const c = await countRows();
    expect(c.txns).toBe(0);
    expect(c.reds).toBe(0);
    expect(c.posts).toBe(0);
  });

  it('(g) idempotent on idempotencyKey → one reservation', async () => {
    const { agent, mw, sw } = await seed();
    const retailer = await seedRetailer();
    const itemId = await seedItem(retailer.id, 20_000n);
    const input = {
      actorUserId: agent.id,
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      catalogItemId: itemId,
      idempotencyKey: factories.idempotencyKey(),
      now: NOW,
    };

    const first = await purchaseService.createFromCatalog(testDb, input);
    const second = await purchaseService.createFromCatalog(testDb, input);

    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.redemption.id).toBe(first.redemption.id);
    const c = await countRows();
    expect(c.txns).toBe(1);
    expect(c.reds).toBe(1);
    expect(c.posts).toBe(2);
  });
});
