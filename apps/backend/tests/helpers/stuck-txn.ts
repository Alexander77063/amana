import { sql } from 'drizzle-orm';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { txnIntentService } from '../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { factories } from './factories';
import { testDb } from './test-db';

export type StuckTxn = {
  txnId: string;
  idempotencyKey: string;
  masterWalletId: string;
  subWalletLedgerAccountId: string;
  suspenseLedgerAccountId: string;
};

let seedCounter = 0;

/** Unique per call: some suites seed two stuck transactions inside one test. */
const uniqueAccountNumber = (): string => {
  seedCounter += 1;
  return String(1_000_000_000 + seedCounter).slice(0, 10);
};

/**
 * An `in_flight` spend with its reservation postings written and `created_at` backdated so it
 * looks stuck.
 *
 * Extracted from `reconciliation.service.test.ts`, which held the only correct recipe. Two copies
 * would drift exactly where money correctness is asserted, so both suites share this one — and
 * the reconciliation suite staying green is the proof the extraction is faithful.
 */
export async function seedStuckTxn(createdAtIso: string): Promise<StuckTxn> {
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
    anchorVirtualAccount: uniqueAccountNumber(),
    anchorBankCode: '058',
    anchorAccountId: `anchor-acct-${factories.idempotencyKey()}`,
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
  // Top up, so there is a balance to spend against.
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    kind: 'topup',
    amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(100_000n),
    },
  ]);
  // Create the spend and force it into in_flight.
  const txn = await txnIntentService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n),
    idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  // Reservation postings, so settlement / reversal have something to unwind.
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(5_000n),
    },
  ]);
  await testDb.execute(
    sql`UPDATE transactions SET created_at = ${createdAtIso}::timestamptz WHERE id = ${txn.id}`,
  );
  return {
    txnId: txn.id,
    idempotencyKey: txn.idempotencyKey,
    masterWalletId: mw.master.id,
    subWalletLedgerAccountId: sw.ledgerAccountId,
    suspenseLedgerAccountId: mw.ledgerAccountIds.suspense,
  };
}
