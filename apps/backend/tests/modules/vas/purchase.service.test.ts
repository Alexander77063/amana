import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postings, transactions, vasPurchases } from '../../../src/db/schema';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorHttpError } from '../../../src/integrations/anchor/client';
import type { AnchorBillResponse } from '../../../src/integrations/anchor/types';
import { ConflictError, ForbiddenError, LimitExceededError } from '../../../src/lib/errors';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { reversalService } from '../../../src/modules/transactions/reversal.service';
import { beneficiariesService } from '../../../src/modules/vas/beneficiaries.service';
import { vasPurchaseService } from '../../../src/modules/vas/purchase.service';
import { vasPurchasesRepo } from '../../../src/modules/vas/vas-purchases.repo';
import { vasSettlementService } from '../../../src/modules/vas/vas-settlement.service';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
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

type Seeded = Awaited<ReturnType<typeof seed>>;

async function seedWithLimit(maxKobo: bigint): Promise<Seeded> {
  const s = await seed();
  await ruleSetService.publishNewVersion(testDb, {
    subWalletId: s.sw.sub.id,
    createdByUserId: s.principal.id,
    rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo } }],
  });
  return s;
}

/** Fake adapter: `payBill` returns a canned response (or runs a side-effect); `validateCustomer` stubbable. */
function fakeAdapter(opts: {
  payBill?: (input: unknown) => Promise<AnchorBillResponse> | AnchorBillResponse;
  validateCustomer?: (
    provider: string,
    account: string,
  ) => Promise<{ customerNumber: string; customerName: string }>;
}): AnchorAdapter {
  return {
    payBill: vi.fn(
      opts.payBill ??
        (async () => ({ id: 'bill_1', status: 'PENDING', commissionKobo: 0n, token: null })),
    ),
    validateCustomer: vi.fn(
      opts.validateCustomer ??
        (async (_p: string, account: string) => ({
          customerNumber: account,
          customerName: 'Test Customer',
        })),
    ),
  } as unknown as AnchorAdapter;
}

function ownPhoneInput(
  s: Seeded,
  over: Partial<Parameters<typeof vasPurchaseService.create>[2]> = {},
) {
  return {
    actorUserId: s.agent.id,
    masterWalletId: s.mw.master.id,
    subWalletId: s.sw.sub.id as string | null,
    category: 'airtime' as const,
    provider: 'mtn',
    recipient: s.agent.phone,
    amountKobo: 5_000n,
    idempotencyKey: factories.idempotencyKey(),
    now: new Date('2026-07-04T00:00:00Z'),
    ...over,
  };
}

async function countRows() {
  const txns = await testDb.select().from(transactions);
  const vas = await testDb.select().from(vasPurchases);
  const posts = await testDb.select().from(postings);
  return { txns: txns.length, vas: vas.length, posts: posts.length };
}

describe('vasPurchaseService.create', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('(a) under-limit airtime to own phone, PENDING → reserve legs, in_flight, vas pending, billId set', async () => {
    const s = await seedWithLimit(100_000n);
    const beforeSource = await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId);
    const beforeSuspense = await postingsRepo.accountBalance(
      testDb,
      s.mw.ledgerAccountIds.suspense,
    );
    const adapter = fakeAdapter({
      payBill: async () => ({
        id: 'bill_pending',
        status: 'PENDING',
        commissionKobo: 100n,
        token: null,
      }),
    });

    const out = await vasPurchaseService.create(testDb, adapter, ownPhoneInput(s));

    expect(out.status).toBe('in_flight');
    const legs = await postingsRepo.listByTransaction(testDb, out.transactionId);
    expect(legs.length).toBe(2);
    expect((await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId)) - beforeSource).toBe(
      5_000n,
    );
    expect(
      (await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)) - beforeSuspense,
    ).toBe(-5_000n);

    const txn = await transactionsRepo.findById(testDb, out.transactionId);
    expect(txn!.status).toBe('in_flight');
    expect(txn!.kind).toBe('vas_purchase');

    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas!.status).toBe('pending');
    expect(vas!.anchorBillId).toBe('bill_pending');
    // The reserve counts in the spend-limit window now.
    const { wouldExceedSpendLimit } = await import('../../../src/modules/transactions/spend-limit');
    expect(
      await wouldExceedSpendLimit(testDb, s.sw.sub.id, 96_000n, new Date('2026-07-04T00:00:00Z')),
    ).toBe(true);
  });

  it('(b) COMPLETED → settled inline (suspense drained, commission credited, vas successful)', async () => {
    const s = await seedWithLimit(100_000n);
    const adapter = fakeAdapter({
      payBill: async () => ({
        id: 'bill_ok',
        status: 'COMPLETED',
        commissionKobo: 100n,
        token: 'TKN',
      }),
    });

    const out = await vasPurchaseService.create(testDb, adapter, ownPhoneInput(s));

    expect(out.status).toBe('settled');
    const txn = await transactionsRepo.findById(testDb, out.transactionId);
    expect(txn!.status).toBe('settled');
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(-100n);
    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas!.status).toBe('successful');
    expect(vas!.token).toBe('TKN');
  });

  it('(c) payBill throws AnchorHttpError → reversed/refunded, txn failed, vas failed', async () => {
    const s = await seedWithLimit(100_000n);
    const beforeSource = await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId);
    const adapter = fakeAdapter({
      payBill: async () => {
        throw new AnchorHttpError(502, 'bad gateway');
      },
    });

    const out = await vasPurchaseService.create(testDb, adapter, ownPhoneInput(s));

    expect(out.status).toBe('failed');
    const txn = await transactionsRepo.findById(testDb, out.transactionId);
    expect(txn!.status).toBe('failed');
    // The reserve legs stay on the original txn (2); the refund legs live on a separate reversal txn.
    expect((await postingsRepo.listByTransaction(testDb, out.transactionId)).length).toBe(2);
    // Source restored to its pre-reserve balance, suspense drained back to 0.
    expect(await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId)).toBe(beforeSource);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas!.status).toBe('failed');
  });

  it('(d) 200 status=FAILED → reversed/refunded, vas failed', async () => {
    const s = await seedWithLimit(100_000n);
    const beforeSource = await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId);
    const adapter = fakeAdapter({
      payBill: async () => ({
        id: 'bill_fail',
        status: 'FAILED',
        commissionKobo: 0n,
        token: null,
        failureReason: 'insufficient biller funds',
      }),
    });

    const out = await vasPurchaseService.create(testDb, adapter, ownPhoneInput(s));

    expect(out.status).toBe('failed');
    expect((await transactionsRepo.findById(testDb, out.transactionId))!.status).toBe('failed');
    expect(await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId)).toBe(beforeSource);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas!.status).toBe('failed');
    // anchorBillId was recorded before the reverse.
    expect(vas!.anchorBillId).toBe('bill_fail');
  });

  it('(e) over the daily limit → LimitExceededError, nothing written, no Anchor call', async () => {
    const s = await seedWithLimit(10_000n);
    const adapter = fakeAdapter({});

    await expect(
      vasPurchaseService.create(testDb, adapter, ownPhoneInput(s, { amountKobo: 15_000n })),
    ).rejects.toBeInstanceOf(LimitExceededError);

    expect(await countRows()).toEqual({ txns: 0, vas: 0, posts: 0 });
    expect(adapter.payBill).not.toHaveBeenCalled();
    expect(adapter.validateCustomer).not.toHaveBeenCalled();
  });

  it('(f) recipient not allowed → ForbiddenError, nothing written, no Anchor call', async () => {
    const s = await seedWithLimit(100_000n);
    const adapter = fakeAdapter({});

    await expect(
      vasPurchaseService.create(testDb, adapter, ownPhoneInput(s, { recipient: '+2348099999999' })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await countRows()).toEqual({ txns: 0, vas: 0, posts: 0 });
    expect(adapter.payBill).not.toHaveBeenCalled();
  });

  it('(g) electricity validateCustomer throws → rejected before reserve, nothing written', async () => {
    const s = await seedWithLimit(1_000_000n);
    // Approve the meter so the recipient gate passes and the rejection comes from validation.
    await beneficiariesService.add(testDb, {
      actorUserId: s.principal.id,
      subWalletId: s.sw.sub.id,
      kind: 'meter',
      value: '01234567890',
      label: 'Home meter',
    });
    const adapter = fakeAdapter({
      validateCustomer: async () => {
        throw new AnchorHttpError(404, 'unknown meter');
      },
    });

    await expect(
      vasPurchaseService.create(
        testDb,
        adapter,
        ownPhoneInput(s, {
          category: 'electricity',
          provider: 'ikeja-electric',
          recipient: '01234567890',
          amountKobo: 50_000n,
        }),
      ),
    ).rejects.toBeInstanceOf(AnchorHttpError);

    expect(await countRows()).toEqual({ txns: 0, vas: 0, posts: 0 });
    expect(adapter.payBill).not.toHaveBeenCalled();
  });

  it('(h) same idempotencyKey twice → second returns existing, no double debit', async () => {
    const s = await seedWithLimit(100_000n);
    const adapter = fakeAdapter({
      payBill: async () => ({
        id: 'bill_pending',
        status: 'PENDING',
        commissionKobo: 100n,
        token: null,
      }),
    });
    const input = ownPhoneInput(s);

    const first = await vasPurchaseService.create(testDb, adapter, input);
    const second = await vasPurchaseService.create(testDb, adapter, input);

    expect(second.transactionId).toBe(first.transactionId);
    expect(second.vasPurchaseId).toBe(first.vasPurchaseId);
    expect(await countRows()).toEqual({ txns: 1, vas: 1, posts: 2 });
    // payBill called only once — the replay short-circuits before Anchor.
    expect(adapter.payBill).toHaveBeenCalledTimes(1);
  });

  it('(j) IDOR: another buyer reusing an idempotency key is rejected, not leaked', async () => {
    // Buyer A creates a purchase with key K.
    const a = await seedWithLimit(100_000n);
    const adapter = fakeAdapter({
      payBill: async () => ({ id: 'bill_a', status: 'PENDING', commissionKobo: 100n, token: null }),
    });
    const key = factories.idempotencyKey();
    const first = await vasPurchaseService.create(
      testDb,
      adapter,
      ownPhoneInput(a, { idempotencyKey: key }),
    );

    // Buyer B (separate household/wallet) submits the SAME key against B's own wallet. The short-
    // circuit must NOT return A's row — it re-authorizes the found resource against the actor and
    // throws ConflictError instead (no cross-tenant leak of recipient/amount/token).
    const b = await seedWithLimit(100_000n);
    await expect(
      vasPurchaseService.create(testDb, adapter, ownPhoneInput(b, { idempotencyKey: key })),
    ).rejects.toBeInstanceOf(ConflictError);

    // Only A's purchase exists; B triggered no reserve and no second Anchor call for A's txn.
    const aRow = await vasPurchasesRepo.findById(testDb, first.vasPurchaseId);
    expect(aRow?.buyerUserId).toBe(a.agent.id);
    expect(await countRows()).toEqual({ txns: 1, vas: 1, posts: 2 });
  });

  it('(i) sync/webhook race COMPLETED: webhook already settled → no throw, no double-settle', async () => {
    const s = await seedWithLimit(100_000n);
    // The fake payBill simulates a `bills.successful` webhook landing DURING the Anchor round-trip:
    // it settles the txn via the webhook path, then returns COMPLETED.
    const adapter = fakeAdapter({
      payBill: async () => {
        const txn = (await testDb.select().from(transactions))[0];
        await vasSettlementService.finalise(testDb, {
          transactionId: txn.id,
          commissionKobo: 100n,
          token: 'WEBHOOK-TKN',
          settledAt: new Date(),
        });
        return { id: 'bill_ok', status: 'COMPLETED', commissionKobo: 100n, token: null };
      },
    });

    const out = await vasPurchaseService.create(testDb, adapter, ownPhoneInput(s));

    expect(out.status).toBe('settled');
    // Exactly one settle happened (reserve 2 + settle 3 = 5), NOT a double carve.
    expect((await postingsRepo.listByTransaction(testDb, out.transactionId)).length).toBe(5);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(-100n);
    const vas = await vasPurchasesRepo.findByTransactionId(testDb, out.transactionId);
    expect(vas!.status).toBe('successful');
    // The webhook's token survived — the inline branch did not overwrite it.
    expect(vas!.token).toBe('WEBHOOK-TKN');
  });

  it('(i) sync/webhook race FAILED: webhook already reversed → no throw, no double-reverse', async () => {
    const s = await seedWithLimit(100_000n);
    const beforeSource = await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId);
    const adapter = fakeAdapter({
      payBill: async () => {
        const txn = (await testDb.select().from(transactions))[0];
        await reversalService.reverse(testDb, {
          transactionId: txn.id,
          reason: 'webhook bills.failed',
          failedAt: new Date(),
        });
        return { id: 'bill_fail', status: 'FAILED', commissionKobo: 0n, token: null };
      },
    });

    const out = await vasPurchaseService.create(testDb, adapter, ownPhoneInput(s));

    expect(out.status).toBe('failed');
    // Exactly one reversal txn exists (the webhook's) — the inline branch did not create a second.
    const reversals = (await testDb.select().from(transactions)).filter(
      (t) => t.kind === 'reversal',
    );
    expect(reversals.length).toBe(1);
    expect(await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId)).toBe(beforeSource);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
  });

  it('principal-direct (subWalletId null) skips the recipient gate and settles inline', async () => {
    const s = await seed();
    const adapter = fakeAdapter({
      payBill: async () => ({
        id: 'bill_ok',
        status: 'COMPLETED',
        commissionKobo: 50n,
        token: null,
      }),
    });

    const out = await vasPurchaseService.create(
      testDb,
      adapter,
      ownPhoneInput(s, {
        actorUserId: s.principal.id,
        subWalletId: null,
        recipient: '+2348012345678', // not a beneficiary, but principal-direct skips the gate
      }),
    );

    expect(out.status).toBe('settled');
    const txn = await transactionsRepo.findById(testDb, out.transactionId);
    expect(txn!.subWalletId).toBeNull();
    // Source was the master LA (debit-normal): reserve debited it 5_000; settle drains suspense only.
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.master)).toBe(5_000n);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
  });
});
