import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { transactionListService } from '../../../src/modules/transactions/list.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedSubWallet(): Promise<string> {
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
  return sw.sub.id;
}

async function seedTxns(masterWalletId: string, subWalletId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await transactionsRepo.insert(testDb, {
      masterWalletId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(BigInt((i + 1) * 1000)),
      idempotencyKey: factories.idempotencyKey(),
    });
  }
}

async function masterFor(subWalletId: string): Promise<string> {
  const sw = await subWalletsRepo.findById(testDb, subWalletId);
  if (!sw) throw new Error('sub wallet missing');
  return sw.masterWalletId;
}

describe('transactionListService.listForSubWallet', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty page with no cursor when there are no transactions', async () => {
    const subWalletId = await seedSubWallet();
    const r = await transactionListService.listForSubWallet(testDb, {
      subWalletId,
      limit: 10,
      cursor: null,
    });
    expect(r.transactions).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });

  it('paginates with a forward cursor and stops at the end', async () => {
    const subWalletId = await seedSubWallet();
    const masterWalletId = await masterFor(subWalletId);
    await seedTxns(masterWalletId, subWalletId, 3);

    const firstPage = await transactionListService.listForSubWallet(testDb, {
      subWalletId,
      limit: 2,
      cursor: null,
    });
    expect(firstPage.transactions).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await transactionListService.listForSubWallet(testDb, {
      subWalletId,
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.transactions).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = [...firstPage.transactions, ...secondPage.transactions].map((t) => t.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it('serialises amount as a string and exposes a masked vendor account field', async () => {
    const subWalletId = await seedSubWallet();
    const masterWalletId = await masterFor(subWalletId);
    await seedTxns(masterWalletId, subWalletId, 1);
    const r = await transactionListService.listForSubWallet(testDb, {
      subWalletId,
      limit: 10,
      cursor: null,
    });
    const [txn] = r.transactions;
    expect(typeof txn?.amountKobo).toBe('string');
    expect(txn).toHaveProperty('vendorAccountMasked');
    expect(typeof txn?.initiatedAt).toBe('string');
  });

  it('only returns transactions for the requested sub-wallet', async () => {
    const swA = await seedSubWallet();
    const swB = await seedSubWallet();
    await seedTxns(await masterFor(swA), swA, 2);
    await seedTxns(await masterFor(swB), swB, 1);
    const r = await transactionListService.listForSubWallet(testDb, {
      subWalletId: swA,
      limit: 10,
      cursor: null,
    });
    expect(r.transactions).toHaveLength(2);
  });
});
