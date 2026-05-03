import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedHouseholdWithMaster() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const provisioned = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
  });
  return { principal, hh, master: provisioned.master };
}

describe('sub-wallets.repo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('provision creates sub-wallet + 1 ledger account', async () => {
    const { master } = await seedHouseholdWithMaster();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const provisioned = await subWalletsRepo.provision(testDb, {
      masterWalletId: master.id,
      agentUserId: agent.id,
      name: 'Driver',
    });
    expect(provisioned.sub.name).toBe('Driver');
    expect(provisioned.ledgerAccountId).toBeDefined();
  });

  it('listByMaster returns all sub-wallets', async () => {
    const { master } = await seedHouseholdWithMaster();
    const a1 = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const a2 = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    await subWalletsRepo.provision(testDb, {
      masterWalletId: master.id,
      agentUserId: a1.id,
      name: 'Driver',
    });
    await subWalletsRepo.provision(testDb, {
      masterWalletId: master.id,
      agentUserId: a2.id,
      name: 'Cook',
    });
    const subs = await subWalletsRepo.listByMaster(testDb, master.id);
    expect(subs.map((s) => s.name).sort()).toEqual(['Cook', 'Driver']);
  });

  it('setStatus suspends a sub-wallet', async () => {
    const { master } = await seedHouseholdWithMaster();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
    });
    const provisioned = await subWalletsRepo.provision(testDb, {
      masterWalletId: master.id,
      agentUserId: agent.id,
      name: 'Driver',
    });
    await subWalletsRepo.setStatus(testDb, provisioned.sub.id, 'suspended');
    const found = await subWalletsRepo.findById(testDb, provisioned.sub.id);
    expect(found?.status).toBe('suspended');
  });
});
