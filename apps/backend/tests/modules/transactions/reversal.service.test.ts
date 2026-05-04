import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { reversalService } from '../../../src/modules/transactions/reversal.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedAndSendNip() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  const txn = await txnIntentService.create(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058', vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M', category: null, agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey }),
      { status: 202, headers: { 'content-type': 'application/json' } }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  await nipOutService.send(testDb, adapter, {
    transactionId: txn.id, householdRef: hh.id, now: new Date('2026-05-03T12:00:00Z'),
  });
  return { txnId: txn.id, subLA: sw.ledgerAccountId };
}

describe('reversalService.reverse', () => {
  beforeEach(async () => { await truncateAll(); });

  it('marks txn failed and restores source balance', async () => {
    const { txnId, subLA } = await seedAndSendNip();
    // Before reverse: sub-wallet should have 100K + 5K = 105K (topup debited sub, send debited sub again)
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(105_000n);

    await reversalService.reverse(testDb, {
      transactionId: txnId, reason: 'insufficient funds at recipient',
      failedAt: new Date('2026-05-03T12:01:00Z'),
    });

    const failed = await transactionsRepo.findById(testDb, txnId);
    expect(failed?.status).toBe('failed');
    // After reverse: credits source 5K, so 105K - 5K = 100K
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });

  it('is idempotent — second call on already-failed txn is a no-op', async () => {
    const { txnId, subLA } = await seedAndSendNip();
    await reversalService.reverse(testDb, {
      transactionId: txnId, reason: null, failedAt: new Date('2026-05-03T12:01:00Z'),
    });
    await reversalService.reverse(testDb, {
      transactionId: txnId, reason: null, failedAt: new Date('2026-05-03T12:01:30Z'),
    });
    // Sub-wallet should still be 100K (not double-restored to 105K).
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });
});
