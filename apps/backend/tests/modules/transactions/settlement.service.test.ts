import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorObservations } from '../../../src/db/schema';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { drainBackgroundTasks } from '../../../src/lib/background';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import {
  SPEND_FEE_KOBO,
  settlementService,
} from '../../../src/modules/transactions/settlement.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { vendorObservationService } from '../../../src/modules/vendors/vendor-observation.service';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

vi.mock('expo-server-sdk', () => {
  const ExpoMock = vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  }));
  (ExpoMock as unknown as Record<string, unknown>).isExpoPushToken = () => true;
  return { Expo: ExpoMock };
});

async function seedAndSendNip(
  opts: { vendorBankCode?: string; vendorAccountNumber?: string; category?: string | null } = {},
) {
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
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n),
    idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: opts.vendorBankCode ?? '058',
    vendorAccountNumber: opts.vendorAccountNumber ?? '0123456789',
    vendorResolvedName: 'M',
    category: opts.category ?? null,
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
    actorUserId: agent.id,
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
    principalId: principal.id,
    agentId: agent.id,
    householdId: hh.id,
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

    // Fee LA accumulated SPEND_FEE_KOBO debits (fee LA is debit-side; fee is recorded as a debit)
    const feeBal = await postingsRepo.accountBalance(testDb, feeLA);
    expect(feeBal).toBe(SPEND_FEE_KOBO);
    // Pin the confirmed pricing: ₦100 per spend (PRICING.md 2026-06-30), not the ₦25 MVP value.
    expect(SPEND_FEE_KOBO).toBe(kobo(10_000n));
    expect(feeBal).toBe(kobo(10_000n));
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

  it('dispatches txn_settled notifications to principal and agent', async () => {
    const { txnId, principalId, agentId } = await seedAndSendNip();
    await settlementService.finalise(testDb, {
      transactionId: txnId,
      nibssSessionId: 'sess-1',
      settledAt: new Date('2026-05-04T12:00:00Z'),
    });
    const principalRow = await notificationsRepo.findByDedupeKey(
      testDb,
      principalId,
      'in_app',
      `txn-settled:${txnId}`,
    );
    const agentRow = await notificationsRepo.findByDedupeKey(
      testDb,
      agentId,
      'in_app',
      `txn-settled:${txnId}`,
    );
    expect(principalRow?.status).toBe('sent');
    expect(agentRow?.status).toBe('sent');
  });
});

describe('settlement → vendor registry observation', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('records exactly one observation after the settle commits', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const { txnId, householdId } = await seedAndSendNip({
      vendorBankCode: bankCode,
      vendorAccountNumber: accountNumber,
      category: 'food',
    });

    await settlementService.finalise(testDb, {
      transactionId: txnId,
      nibssSessionId: factories.nibssSessionId(),
      settledAt: new Date('2026-08-25T10:00:00Z'),
    });
    await drainBackgroundTasks();

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.householdId).toBe(householdId);
    expect(rows[0]?.settledCount).toBe(1);
    expect(rows[0]?.categoryCounts).toEqual({ food: 1 });
  });

  it('does not double-observe when the webhook fires twice', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const { txnId } = await seedAndSendNip({
      vendorBankCode: bankCode,
      vendorAccountNumber: accountNumber,
      category: 'food',
    });
    const input = {
      transactionId: txnId,
      nibssSessionId: factories.nibssSessionId(),
      settledAt: new Date('2026-08-25T10:00:00Z'),
    };

    await settlementService.finalise(testDb, input);
    await settlementService.finalise(testDb, input); // idempotent replay
    await drainBackgroundTasks();

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows[0]?.settledCount).toBe(1);
  });

  it('settles successfully even when the observation write throws', async () => {
    const { txnId } = await seedAndSendNip({
      vendorBankCode: factories.bankCode(),
      vendorAccountNumber: factories.bankAccount(),
      category: 'food',
    });
    const spy = vi
      .spyOn(vendorObservationService, 'recordSettlement')
      .mockRejectedValue(new Error('boom'));

    await settlementService.finalise(testDb, {
      transactionId: txnId,
      nibssSessionId: null,
      settledAt: new Date(),
    });
    await drainBackgroundTasks();

    const settled = await transactionsRepo.findById(testDb, txnId);
    expect(settled?.status).toBe('settled');
    spy.mockRestore();
  });

  it('records no observation for a transaction with no vendor account', async () => {
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
      anchorVirtualAccount: '1234567891',
      anchorBankCode: '058',
      anchorAccountId: 'anchor-acct-test-2',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      kind: 'spend',
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: null,
      vendorAccount: null,
      vendorResolvedName: null,
      category: null,
    });
    await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');

    await settlementService.finalise(testDb, {
      transactionId: txn.id,
      nibssSessionId: null,
      settledAt: new Date(),
    });
    await drainBackgroundTasks();

    const all = await testDb.select().from(vendorObservations);
    expect(all).toEqual([]);
  });

  it('observes a settlement driven through an OPEN transaction, as the webhook does', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const { txnId, householdId } = await seedAndSendNip({
      vendorBankCode: bankCode,
      vendorAccountNumber: accountNumber,
      category: 'food',
    });

    // Mirrors routes/webhooks.ts:102 — finalise runs INSIDE the caller's transaction.
    await testDb.transaction(async (tx) => {
      await settlementService.finalise(tx as typeof testDb, {
        transactionId: txnId,
        nibssSessionId: factories.nibssSessionId(),
        settledAt: new Date('2026-08-25T10:00:00Z'),
      });
    });
    await drainBackgroundTasks();

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.householdId).toBe(householdId);
  });
});
