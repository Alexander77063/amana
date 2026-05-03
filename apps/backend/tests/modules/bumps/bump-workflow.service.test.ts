import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';

async function seedTxn() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    kind: 'spend', amountKobo: kobo(50_000n), idempotencyKey: factories.idempotencyKey(),
  });
  return {
    principalId: principal.id, agentId: agent.id, subWalletId: sw.sub.id, txnId: txn.id,
  };
}

describe('bumpWorkflowService.create', () => {
  beforeEach(async () => { await truncateAll(); });

  it('creates a pending bump_request + sets transaction.status=bump_pending + sets transaction.bump_request_id', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now,
    });
    expect(created.bumpRequest.status).toBe('pending');
    expect(created.bumpRequest.expiresAt.getTime() - now.getTime()).toBe(30 * 60 * 1000);
    const txn = await transactionsRepo.findById(testDb, txnId);
    expect(txn?.status).toBe('bump_pending');
    expect(txn?.bumpRequestId).toBe(created.bumpRequest.id);
  });

  it('respects custom TTL minutes', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now, ttlMinutes: 5,
    });
    expect(created.bumpRequest.expiresAt.getTime() - now.getTime()).toBe(5 * 60 * 1000);
  });
});
