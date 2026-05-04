import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedFundedSubWallet() {
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
  // Top up sub-wallet (100K kobo, debit sub / credit suspense per scaffold convention)
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
  return {
    masterId: mw.master.id,
    subWalletId: sw.sub.id,
    subLA: sw.ledgerAccountId,
    suspenseLA: mw.ledgerAccountIds.suspense,
    householdId: hh.id,
  };
}

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

describe('nipOutService.send', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('writes reservation postings and calls Anchor with idempotency key', async () => {
    const { masterId, subWalletId, subLA, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId,
      subWalletId,
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M',
      category: null,
      agentNote: null,
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tr-1',
          status: 'PENDING',
          reference: txn.idempotencyKey,
          nibssSessionId: '12345',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await nipOutService.send(testDb, makeAdapter(fetchSpy), {
      transactionId: txn.id,
      householdRef: householdId,
      now: new Date('2026-05-03T12:00:00Z'),
    });

    expect(result.status).toBe('PENDING');

    // Sub-wallet ledger: topup debit 100K + reservation debit 5K = 105K total debits.
    // accountBalance returns SUM(debit) - SUM(credit), so 105K.
    const subBal = await postingsRepo.accountBalance(testDb, subLA);
    expect(subBal).toBe(105_000n);

    // Anchor called with idempotency key in headers
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(txn.idempotencyKey);

    // NIBSS session id persisted
    const updated = await transactionsRepo.findById(testDb, txn.id);
    expect(updated?.nibssSessionId).toBe('12345');
  });

  it('rejects when transaction is not in in_flight status', async () => {
    const { masterId, subWalletId, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId,
      subWalletId,
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M',
      category: null,
      agentNote: null,
    });
    // status is 'draft', not 'in_flight'
    const fetchSpy = vi.fn();
    await expect(
      nipOutService.send(testDb, makeAdapter(fetchSpy), {
        transactionId: txn.id,
        householdRef: householdId,
        now: new Date(),
      }),
    ).rejects.toThrow(/not in_flight/);
  });

  it('handles principal-direct spend (subWalletId=null) by debiting master directly', async () => {
    const { masterId, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId,
      subWalletId: null,
      amountKobo: kobo(2_000n),
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
          JSON.stringify({ id: 'tr-2', status: 'PENDING', reference: txn.idempotencyKey }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        ),
      );

    const result = await nipOutService.send(testDb, makeAdapter(fetchSpy), {
      transactionId: txn.id,
      householdRef: householdId,
      now: new Date(),
    });
    expect(result.status).toBe('PENDING');
  });

  it('reverses immediately on Anchor 4xx (sync failure path, B5)', async () => {
    const { masterId, subWalletId, subLA, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId,
      subWalletId,
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M',
      category: null,
      agentNote: null,
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"invalid_account"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await nipOutService.send(testDb, makeAdapter(fetchSpy), {
      transactionId: txn.id,
      householdRef: householdId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.status).toBe('FAILED');
    expect(result.reversed).toBe(true);
    expect(result.anchorTransferId).toBeNull();

    // Sub-wallet balance restored to topup-only (100K)
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
    const final = await transactionsRepo.findById(testDb, txn.id);
    expect(final?.status).toBe('failed');
  });

  it('reverses on a 200 response with status=FAILED (B5 second branch)', async () => {
    const { masterId, subWalletId, subLA, householdId } = await seedFundedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      masterWalletId: masterId,
      subWalletId,
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M',
      category: null,
      agentNote: null,
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tr-3',
          status: 'FAILED',
          reference: txn.idempotencyKey,
          failureReason: 'beneficiary account closed',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await nipOutService.send(testDb, makeAdapter(fetchSpy), {
      transactionId: txn.id,
      householdRef: householdId,
      now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.status).toBe('FAILED');
    expect(result.reversed).toBe(true);
    expect(result.anchorTransferId).toBe('tr-3');

    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
    const final = await transactionsRepo.findById(testDb, txn.id);
    expect(final?.status).toBe('failed');
  });
});
