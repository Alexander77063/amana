import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedSubWallet() {
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
  return {
    masterId: mw.master.id,
    subWalletId: sw.sub.id,
    agentId: agent.id,
    principalId: principal.id,
  };
}

describe('txnIntentService.create', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates a DRAFT spend with all vendor fields', async () => {
    const { masterId, subWalletId, agentId } = await seedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      actorUserId: agentId,
      masterWalletId: masterId,
      subWalletId,
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MUSA ABDULLAHI',
      category: 'groceries',
      agentNote: 'fix tyre',
    });
    expect(txn.status).toBe('draft');
    expect(txn.kind).toBe('spend');
    expect(txn.vendorBankCode).toBe('058');
    expect(txn.category).toBe('groceries');
    expect(txn.agentNote).toBe('fix tyre');
  });

  it('creates a principal-direct DRAFT (subWalletId=null)', async () => {
    const { masterId, principalId } = await seedSubWallet();
    const txn = await txnIntentService.create(testDb, {
      actorUserId: principalId,
      masterWalletId: masterId,
      subWalletId: null,
      amountKobo: kobo(50_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MUSA',
      category: null,
      agentNote: null,
    });
    expect(txn.subWalletId).toBeNull();
  });

  it('rejects duplicate idempotency keys (DB unique constraint)', async () => {
    const { masterId, subWalletId, agentId } = await seedSubWallet();
    const key = factories.idempotencyKey();
    await txnIntentService.create(testDb, {
      actorUserId: agentId,
      masterWalletId: masterId,
      subWalletId,
      amountKobo: kobo(100n),
      idempotencyKey: key,
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'M',
      category: null,
      agentNote: null,
    });
    await expect(
      txnIntentService.create(testDb, {
        actorUserId: agentId,
        masterWalletId: masterId,
        subWalletId,
        amountKobo: kobo(100n),
        idempotencyKey: key,
        vendorBankCode: '058',
        vendorAccountNumber: '0123456789',
        vendorResolvedName: 'M',
        category: null,
        agentNote: null,
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
