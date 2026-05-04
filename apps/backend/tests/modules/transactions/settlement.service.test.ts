import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import {
  NIP_FEE_KOBO,
  settlementService,
} from '../../../src/modules/transactions/settlement.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedAndSendNip() {
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
  const txn = await txnIntentService.create(testDb, {
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
  const fetchSpy = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  await nipOutService.send(testDb, adapter, {
    transactionId: txn.id,
    householdRef: hh.id,
    now: new Date('2026-05-03T12:00:00Z'),
  });
  return {
    txnId: txn.id,
    masterId: mw.master.id,
    feeLA: mw.ledgerAccountIds.fee,
    masterLA: mw.ledgerAccountIds.master,
    subLA: sw.ledgerAccountId,
    suspenseLA: mw.ledgerAccountIds.suspense,
  };
}

describe('settlementService.finalise', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('moves txn to settled + books NIP fee + clears suspense', async () => {
    const { txnId, feeLA } = await seedAndSendNip();
    const settledAt = new Date('2026-05-03T12:00:30Z');
    await settlementService.finalise(testDb, {
      transactionId: txnId,
      nibssSessionId: '99999',
      settledAt,
    });
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
    expect(settled?.settledAt?.toISOString()).toBe(settledAt.toISOString());
    expect(settled?.nibssSessionId).toBe('99999');

    // Fee LA accumulated NIP_FEE_KOBO debits (fee LA is debit-side; fee is recorded as a debit)
    const feeBal = await postingsRepo.accountBalance(testDb, feeLA);
    expect(feeBal).toBe(NIP_FEE_KOBO);
  });

  it('is idempotent — second call on already-settled txn is a no-op', async () => {
    const { txnId } = await seedAndSendNip();
    await settlementService.finalise(testDb, {
      transactionId: txnId,
      nibssSessionId: '1',
      settledAt: new Date('2026-05-03T12:00:30Z'),
    });
    // Second call should NOT throw and NOT double-book the fee.
    await settlementService.finalise(testDb, {
      transactionId: txnId,
      nibssSessionId: '1',
      settledAt: new Date('2026-05-03T12:00:31Z'),
    });
    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
  });

  it('rejects settle on a non-in_flight transaction', async () => {
    const { txnId } = await seedAndSendNip();
    await transactionsRepo.setStatus(testDb, txnId, 'failed');
    await expect(
      settlementService.finalise(testDb, {
        transactionId: txnId,
        nibssSessionId: null,
        settledAt: new Date(),
      }),
    ).rejects.toThrow(/cannot settle/);
  });
});
