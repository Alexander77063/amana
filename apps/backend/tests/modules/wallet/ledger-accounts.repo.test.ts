import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ledgerAccountsRepo } from '../../../src/modules/wallet/ledger-accounts.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedMasterWallet(): Promise<string> {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mwId = factories.walletId();
  await testDb.execute(sql`
    INSERT INTO master_wallets (id, household_id, anchor_virtual_account, anchor_bank_code)
    VALUES (${mwId}, ${hh.id}, '1234567890', '058')
  `);
  return mwId;
}

describe('ledger-accounts.repo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert + findByMasterAndKind round-trips', async () => {
    const mwId = await seedMasterWallet();
    const created = await ledgerAccountsRepo.insert(testDb, {
      masterWalletId: mwId,
      kind: 'master',
      normalSide: 'debit',
    });
    const found = await ledgerAccountsRepo.findByMasterAndKind(testDb, mwId, 'master');
    expect(found?.id).toBe(created.id);
  });

  it('findBySubWallet resolves the sub ledger account', async () => {
    const mwId = await seedMasterWallet();
    const swId = factories.walletId();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    await testDb.execute(sql`
      INSERT INTO sub_wallets (id, master_wallet_id, agent_user_id, name)
      VALUES (${swId}, ${mwId}, ${agent.id}, 'Driver')
    `);
    await ledgerAccountsRepo.insert(testDb, {
      masterWalletId: mwId,
      kind: 'sub',
      subWalletId: swId,
      normalSide: 'debit',
    });
    const found = await ledgerAccountsRepo.findBySubWallet(testDb, swId);
    expect(found?.subWalletId).toBe(swId);
    expect(found?.kind).toBe('sub');
  });
});
