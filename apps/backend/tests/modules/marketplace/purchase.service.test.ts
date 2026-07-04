import { beforeEach, describe, expect, it } from 'vitest';
import { postings, redemptions, transactions } from '../../../src/db/schema';
import { ForbiddenError } from '../../../src/lib/errors';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { MARKETPLACE_COMMISSION_BPS } from '../../../src/modules/marketplace/config';
import { purchaseService } from '../../../src/modules/marketplace/purchase.service';
import { redemptionsRepo } from '../../../src/modules/marketplace/redemptions.repo';
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
