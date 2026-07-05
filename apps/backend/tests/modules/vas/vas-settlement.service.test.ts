import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { vasPurchasesRepo } from '../../../src/modules/vas/vas-purchases.repo';
import { vasSettlementService } from '../../../src/modules/vas/vas-settlement.service';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
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

/** Reserve a VAS purchase exactly as `vasPurchaseService.create`'s reserve step does. */
async function reserveVas(s: Seeded, amount: bigint) {
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: s.mw.master.id,
    subWalletId: s.sw.sub.id,
    kind: 'vas_purchase',
    amountKobo: kobo(amount),
    idempotencyKey: factories.idempotencyKey(),
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: s.sw.ledgerAccountId, debitKobo: kobo(amount), creditKobo: kobo(0n) },
    {
      ledgerAccountId: s.mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(amount),
    },
  ]);
  const vas = await vasPurchasesRepo.insert(testDb, {
    transactionId: txn.id,
    buyerUserId: s.agent.id,
    masterWalletId: s.mw.master.id,
    subWalletId: s.sw.sub.id,
    category: 'airtime',
    provider: 'mtn',
    recipientKind: 'phone',
    recipient: '+2348010000000',
    amountKobo: kobo(amount),
    commissionKobo: kobo(0n),
    status: 'pending',
  });
  return { txn, vas };
}

describe('vasSettlementService.finalise — commission carve', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('carves: debit suspense=amount, credit external=amount−commission, credit commission', async () => {
    const s = await seed();
    const { txn } = await reserveVas(s, 100_000n);

    await vasSettlementService.finalise(testDb, {
      transactionId: txn.id,
      commissionKobo: 2_000n,
      token: 'TKN-1',
      settledAt: new Date(),
    });

    // reserve wrote 2 legs; settle writes 3 more (suspense + external + commission) → 5 total.
    const legs = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(legs.length).toBe(5);

    // Suspense drained: reserve +100k credit, settle 100k debit → net 0.
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);

    // Commission LA credit-normal → balance (debit−credit) is negative commission.
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(
      -2_000n,
    );

    // External LA (lazy-created) credited the net biller payout (amount − commission).
    const externalLA = await ledgerAccountsRepo.findByMasterAndKind(
      testDb,
      s.mw.master.id,
      'external',
    );
    expect(externalLA).toBeTruthy();
    expect(await postingsRepo.accountBalance(testDb, externalLA!.id)).toBe(-(100_000n - 2_000n));

    const settled = await transactionsRepo.findById(testDb, txn.id);
    expect(settled!.status).toBe('settled');

    const vasRow = await vasPurchasesRepo.findByTransactionId(testDb, txn.id);
    expect(vasRow!.status).toBe('successful');
    expect(vasRow!.token).toBe('TKN-1');
    expect(vasRow!.commissionKobo).toBe(2_000n);
    expect(vasRow!.completedAt).toBeTruthy();
  });

  it('is idempotent: a second finalise is a no-op (no double carve)', async () => {
    const s = await seed();
    const { txn } = await reserveVas(s, 50_000n);
    const input = {
      transactionId: txn.id,
      commissionKobo: 1_000n,
      token: null,
      settledAt: new Date(),
    };

    await vasSettlementService.finalise(testDb, input);
    await vasSettlementService.finalise(testDb, input); // second call must not re-post

    const legs = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(legs.length).toBe(5); // still just reserve(2) + one settle(3)
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(
      -1_000n,
    );
  });

  it('omits the zero commission leg (4 legs, no commission credit)', async () => {
    const s = await seed();
    const { txn } = await reserveVas(s, 30_000n);

    await vasSettlementService.finalise(testDb, {
      transactionId: txn.id,
      commissionKobo: 0n,
      token: null,
      settledAt: new Date(),
    });

    const legs = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(legs.length).toBe(4); // reserve(2) + settle: suspense debit + external credit only
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(0n);
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
  });

  it('clamps a commission larger than the amount to the amount (external leg omitted)', async () => {
    const s = await seed();
    const { txn } = await reserveVas(s, 10_000n);

    // Hostile/garbled Anchor value larger than the face amount must never invert the carve.
    await vasSettlementService.finalise(testDb, {
      transactionId: txn.id,
      commissionKobo: 999_999n,
      token: null,
      settledAt: new Date(),
    });

    const legs = await postingsRepo.listByTransaction(testDb, txn.id);
    expect(legs.length).toBe(4); // reserve(2) + settle: suspense debit + commission credit (external=0 omitted)
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.commission)).toBe(
      -10_000n,
    );
    expect(await postingsRepo.accountBalance(testDb, s.mw.ledgerAccountIds.suspense)).toBe(0n);
    const vasRow = await vasPurchasesRepo.findByTransactionId(testDb, txn.id);
    expect(vasRow!.commissionKobo).toBe(10_000n);
  });
});
