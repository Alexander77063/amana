import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { refundService } from '../../../src/modules/transactions/refund.service';
import { settlementService } from '../../../src/modules/transactions/settlement.service';
import { topupService } from '../../../src/modules/transactions/topup.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

vi.mock('expo-server-sdk', () => ({
  Expo: vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  })),
  isExpoPushToken: () => true,
}));

async function seedFullySettledSpend() {
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
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  await nipOutService.send(testDb, adapter, {
    transactionId: txn.id,
    householdRef: hh.id,
    now: new Date('2026-05-04T10:00:00Z'),
  });
  await settlementService.finalise(testDb, {
    transactionId: txn.id,
    nibssSessionId: 'sess-1',
    settledAt: new Date('2026-05-04T10:00:30Z'),
  });
  return {
    masterId: mw.master.id,
    subWalletId: sw.sub.id,
    subLA: sw.ledgerAccountId,
    principalId: principal.id,
    agentId: agent.id,
    originalTxnId: txn.id,
  };
}

describe('refundService', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('findOriginatingSpend matches recent settled spend by amount + sender', async () => {
    const { masterId } = await seedFullySettledSpend();
    const found = await refundService.findOriginatingSpend(testDb, {
      masterWalletId: masterId,
      amountKobo: kobo(5_000n),
      senderBankCode: '058',
      senderAccountNumber: '0123456789',
    });
    expect(found).not.toBeNull();
  });

  it('handleRefund posts a refund txn that re-credits the source sub-wallet', async () => {
    const { masterId, subLA, originalTxnId } = await seedFullySettledSpend();
    const result = await refundService.handleRefund(testDb, {
      masterWalletId: masterId,
      amountKobo: kobo(5_000n),
      senderBankCode: '058',
      senderAccountNumber: '0123456789',
      nibssSessionId: 'sess-refund-1',
      receivedAt: new Date('2026-05-04T11:00:00Z'),
    });
    expect(result.kind).toBe('matched_and_refunded');
    if (result.kind === 'matched_and_refunded') {
      expect(result.originalTransactionId).toBe(originalTxnId);
    }
    // After refund: sub-wallet balance restored to 100K (105K from seed+spend, -5K from refund credit)
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });

  it('topupService routes to refund when sender matches a recent spend', async () => {
    const { masterId, principalId } = await seedFullySettledSpend();
    const result = await topupService.handle(testDb, {
      virtualAccountId: 'anchor-acct-test',
      amountKobo: kobo(5_000n),
      nibssSessionId: 'sess-refund-via-topup',
      senderBankCode: '058',
      senderAccountNumber: '0123456789',
      senderAccountName: 'M',
      receivedAt: new Date('2026-05-04T11:00:00Z'),
    });
    expect(result.kind).toBe('created');
    const list = await notificationsRepo.listByRecipient(testDb, principalId, 50);
    expect(list.some((n) => n.kind === 'refund_received')).toBe(true);
  });

  it('returns no_match when sender does not match any recent spend', async () => {
    const { masterId } = await seedFullySettledSpend();
    const result = await refundService.handleRefund(testDb, {
      masterWalletId: masterId,
      amountKobo: kobo(99_999n),
      senderBankCode: '058',
      senderAccountNumber: '9999999999',
      nibssSessionId: 's',
      receivedAt: new Date(),
    });
    expect(result.kind).toBe('no_match');
  });
});
