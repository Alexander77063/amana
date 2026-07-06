import { and, eq, sql } from 'drizzle-orm';
import * as fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transactions, vasPurchases } from '../../../src/db/schema';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import type { AnchorBillResponse } from '../../../src/integrations/anchor/types';
import { LimitExceededError } from '../../../src/lib/errors';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { reversalService } from '../../../src/modules/transactions/reversal.service';
import type { VasCreateInput, VasCreateOutput } from '../../../src/modules/vas/purchase.service';
import { vasPurchaseService } from '../../../src/modules/vas/purchase.service';
import { vasSettlementService } from '../../../src/modules/vas/vas-settlement.service';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

// A COMPLETED VAS bill settles inline → dispatches a best-effort buyer push notification. Stub the
// Expo SDK so it never reaches the network, exactly as the marketplace ledger property test does.
vi.mock('expo-server-sdk', () => {
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  }));
  (ExpoMock as unknown as Record<string, unknown>).isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

/** Seed a household + master wallet + agent sub-wallet (mirrors purchase.service.test.ts). */
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

/** Fake adapter whose `payBill` returns a canned response; `validateCustomer` is a passthrough. */
function fakeAdapter(
  payBill: () => Promise<AnchorBillResponse> | AnchorBillResponse,
): AnchorAdapter {
  return {
    payBill: vi.fn(payBill),
    validateCustomer: vi.fn(async (_p: string, account: string) => ({
      customerNumber: account,
      customerName: 'Test Customer',
    })),
  } as unknown as AnchorAdapter;
}

/** Airtime-to-own-phone input (recipient gate passes without a beneficiary). */
function ownPhoneInput(s: Seeded, over: Partial<VasCreateInput> = {}): VasCreateInput {
  return {
    actorUserId: s.agent.id,
    masterWalletId: s.mw.master.id,
    subWalletId: s.sw.sub.id,
    category: 'airtime',
    provider: 'mtn',
    recipient: s.agent.phone,
    amountKobo: 5_000n,
    idempotencyKey: factories.idempotencyKey(),
    now: new Date('2026-07-04T00:00:00Z'),
    ...over,
  };
}

/** Σ debit == Σ credit for a single transaction's postings, read straight from the DB. */
async function txnDebitsEqualCredits(transactionId: string): Promise<void> {
  const [row] = await testDb.execute<{ d: string; c: string }>(sql`
    SELECT COALESCE(SUM(debit_kobo), 0)::text AS d,
           COALESCE(SUM(credit_kobo), 0)::text AS c
    FROM postings
    WHERE transaction_id = ${transactionId}
  `);
  expect(BigInt(row.d), `txn ${transactionId} debits==credits`).toBe(BigInt(row.c));
}

describe('vasPurchaseService.create — hardening', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ── Test 1 — ledger-balance property ────────────────────────────────────────────────────────
  it('settle conserves the buyer’s funds: balanced legs, external+commission==amount, suspense→0', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Random face value ₦1..₦100,000 (100..10_000_000 kobo) and a random Anchor commission in
        // [0, amount] — including the boundaries where a leg floors to 0 (finalise omits the zero leg).
        fc
          .bigInt({ min: 100n, max: 10_000_000n })
          .chain((amount) =>
            fc.bigInt({ min: 0n, max: amount }).map((commission) => ({ amount, commission })),
          ),
        async ({ amount, commission }) => {
          await truncateAll();
          // A limit safely above the max amount so the reserve always passes — this property is
          // about the settle carve, not the limit gate (that is Test 2).
          const s = await seedWithLimit(20_000_000n);
          const adapter = fakeAdapter(async () => ({
            id: 'bill_ok',
            status: 'COMPLETED',
            commissionKobo: commission,
            token: null,
          }));

          const out = await vasPurchaseService.create(
            testDb,
            adapter,
            ownPhoneInput(s, { amountKobo: amount }),
          );
          expect(out.status).toBe('settled');

          // (a) The txn's postings balance: Σ debit == Σ credit.
          await txnDebitsEqualCredits(out.transactionId);

          // (b) The carve conserves the buyer's face value: external + commission == amount.
          // accountBalance is debit−credit, so credit-normal LAs read NEGATIVE; negate to recover
          // the credited amount. external LA is lazy-created only when external > 0 (commission <
          // amount); when commission == amount it never exists → treat as 0.
          const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
            testDb,
            s.mw.master.id,
            'external',
          );
          const externalCredited = externalLA
            ? -(await postingsRepo.accountBalance(testDb, externalLA.id))
            : 0n;
          const commissionCredited = -(await postingsRepo.accountBalance(
            testDb,
            s.mw.ledgerAccountIds.commission,
          ));
          expect(externalCredited + commissionCredited).toBe(amount);

          // (c) The commission LA is credited exactly the (clamped) commission, and suspense — which
          // held the reserve — nets back to 0 after the drain.
          expect(commissionCredited).toBe(commission);
          expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(
            0n,
          );
        },
      ),
      { numRuns: 30 },
    );
  }, 120_000);

  // ── Test 2 — concurrency limit race ─────────────────────────────────────────────────────────
  it('serialises concurrent reserves: two ₦6,000 buys under a ₦10,000 limit → exactly one reserves', async () => {
    // Daily limit ₦10,000; each purchase ₦6,000. Together ₦12,000 > the limit, so at most one may
    // reserve. Both fire concurrently after each independently passes its pre-check — the advisory
    // xact lock in the reserve must serialise them so the second sees the first's committed hold.
    const s = await seedWithLimit(1_000_000n); // ₦10,000
    const pending = () =>
      fakeAdapter(async () => ({
        id: 'bill_pending',
        status: 'PENDING' as const,
        commissionKobo: 0n,
        token: null,
      }));

    const results = await Promise.allSettled([
      vasPurchaseService.create(
        testDb,
        pending(),
        ownPhoneInput(s, { amountKobo: 600_000n, idempotencyKey: factories.idempotencyKey() }),
      ),
      vasPurchaseService.create(
        testDb,
        pending(),
        ownPhoneInput(s, { amountKobo: 600_000n, idempotencyKey: factories.idempotencyKey() }),
      ),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<VasCreateOutput> => r.status === 'fulfilled',
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    // Exactly one succeeds (reserves, in_flight); the other is rejected with LimitExceededError.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(fulfilled[0].value.status).toBe('in_flight');
    expect(rejected[0].reason).toBeInstanceOf(LimitExceededError);

    // Only ONE reserve hit the ledger — the loser's transaction rolled back entirely.
    const vasRows = await testDb
      .select()
      .from(vasPurchases)
      .where(eq(vasPurchases.subWalletId, s.sw.sub.id));
    expect(vasRows.length).toBe(1);
    const txnRows = await testDb
      .select()
      .from(transactions)
      .where(and(eq(transactions.subWalletId, s.sw.sub.id), eq(transactions.kind, 'vas_purchase')));
    expect(txnRows.length).toBe(1);
    // The sub-wallet source LA reflects exactly one ₦6,000 reserve debit (not two).
    expect(await postingsRepo.accountBalance(testDb, s.sw.ledgerAccountId)).toBe(600_000n);
  });

  /** Reserve one in_flight VAS purchase (PENDING payBill) and return its txn id. */
  async function reserveInFlight(s: Seeded, amountKobo: bigint): Promise<string> {
    const out = await vasPurchaseService.create(
      testDb,
      fakeAdapter(async () => ({
        id: 'bill_pending',
        status: 'PENDING' as const,
        commissionKobo: 0n,
        token: null,
      })),
      ownPhoneInput(s, { amountKobo, idempotencyKey: factories.idempotencyKey() }),
    );
    expect(out.status).toBe('in_flight');
    return out.transactionId;
  }

  // ── Test 3 — concurrent settle-vs-settle serialises (the SELECT … FOR UPDATE row lock) ──────────
  it('two concurrent settles on one in_flight txn settle EXACTLY once (row lock)', async () => {
    const s = await seedWithLimit(1_000_000n);
    const txnId = await reserveInFlight(s, 500_000n); // ₦5,000 held in suspense

    const settle = () =>
      vasSettlementService.finalise(testDb, {
        transactionId: txnId,
        commissionKobo: 10_000n, // ₦100
        token: null,
        settledAt: new Date(),
      });
    // Two `bills.successful` (or an inline-COMPLETED racing a webhook) hit the SAME hold at once.
    await Promise.all([settle(), settle()]);

    // Without the FOR UPDATE lock both read `in_flight` under READ COMMITTED and both write a settle
    // leg-set: suspense drained twice (→ +₦5,000, not 0) and commission double-credited (₦200). The
    // lock forces the second to block, re-read `settled`, and no-op — so this asserts the fix.
    const [txn] = await testDb.select().from(transactions).where(eq(transactions.id, txnId));
    expect(txn.status).toBe('settled');
    await txnDebitsEqualCredits(txnId);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    // credit-normal → negate. A double-settle would read ₦200 (20_000n).
    expect(-(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission))).toBe(
      10_000n,
    );
  });

  // ── Test 4 — concurrent settle-vs-reverse serialises (no settle-AND-refund double-move) ─────────
  it('concurrent settle + reverse on one in_flight txn → exactly one terminal outcome, suspense→0', async () => {
    const s = await seedWithLimit(1_000_000n);
    const txnId = await reserveInFlight(s, 500_000n);

    // A `bills.successful` and a contradictory `bills.failed` race for the same hold. Without the
    // shared row lock both read `in_flight`: the bill is paid to the biller (settle credits external)
    // AND the buyer is refunded (reverse credits source) — free goods + a hole in suspense.
    await Promise.allSettled([
      vasSettlementService.finalise(testDb, {
        transactionId: txnId,
        commissionKobo: 10_000n,
        token: null,
        settledAt: new Date(),
      }),
      reversalService.reverse(testDb, {
        transactionId: txnId,
        reason: 'bill failed',
        failedAt: new Date(),
      }),
    ]);

    const [txn] = await testDb.select().from(transactions).where(eq(transactions.id, txnId));
    // Exactly one terminal state won — never both applied.
    expect(['settled', 'failed']).toContain(txn.status);
    // Whichever won drains suspense back to exactly 0 (settle → external+commission; reverse →
    // source). A settle-AND-reverse double-apply would leave suspense at +₦5,000.
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
  });
});
