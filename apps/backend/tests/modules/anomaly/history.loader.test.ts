import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { loadHistoryForSubWallet } from '../../../src/modules/anomaly/history.loader';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
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
  return { masterId: mw.master.id, subWalletId: sw.sub.id };
}

describe('loadHistoryForSubWallet', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns empty for a sub-wallet with no settled txns', async () => {
    const { subWalletId } = await seedSubWallet();
    const history = await loadHistoryForSubWallet(
      testDb,
      subWalletId,
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(history.txns).toEqual([]);
  });

  it('returns settled spend txns within the lookback window, with vendor info', async () => {
    const { masterId, subWalletId } = await seedSubWallet();
    const settledTxn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(5000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058',
      vendorAccount: '0123456789',
    });
    await transactionsRepo.setStatus(
      testDb,
      settledTxn.id,
      'settled',
      new Date('2026-05-02T12:00:00Z'),
    );
    const history = await loadHistoryForSubWallet(
      testDb,
      subWalletId,
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(history.txns).toHaveLength(1);
    expect(history.txns[0]?.amountKobo).toBe(5000n);
    expect(history.txns[0]?.vendorBankCode).toBe('058');
  });

  it('excludes non-settled txns and txns older than 90 days', async () => {
    const { masterId, subWalletId } = await seedSubWallet();
    await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(1n),
      idempotencyKey: factories.idempotencyKey(),
    });
    const old = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId,
      subWalletId,
      kind: 'spend',
      amountKobo: kobo(2n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await transactionsRepo.setStatus(testDb, old.id, 'settled', new Date('2026-01-01T12:00:00Z'));
    const history = await loadHistoryForSubWallet(
      testDb,
      subWalletId,
      new Date('2026-05-03T12:00:00Z'),
    );
    expect(history.txns).toHaveLength(0);
  });
});
