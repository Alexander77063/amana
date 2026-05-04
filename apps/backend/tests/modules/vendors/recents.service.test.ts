import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { recentsRepo } from '../../../src/modules/vendors/recents.repo';
import { recentsService } from '../../../src/modules/vendors/recents.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
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
  return sw.sub.id;
}

describe('recentsService.touch', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('caps recents at MAX_RECENTS=10 per sub-wallet', async () => {
    const subWalletId = await seedSubWallet();
    for (let i = 0; i < 12; i++) {
      await recentsService.touch(testDb, {
        subWalletId,
        bankCode: '058',
        accountNumber: `${String(i).padStart(10, '0')}`,
        accountName: `V${i}`,
        now: new Date(`2026-05-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`),
      });
    }
    const all = await recentsRepo.listTop(testDb, subWalletId, 100);
    expect(all.length).toBeLessThanOrEqual(10);
  });

  it('listTop10 returns at most 10 entries', async () => {
    const subWalletId = await seedSubWallet();
    for (let i = 0; i < 5; i++) {
      await recentsService.touch(testDb, {
        subWalletId,
        bankCode: '058',
        accountNumber: `${String(i).padStart(10, '0')}`,
        accountName: `V${i}`,
        now: new Date(`2026-05-0${i + 1}T10:00:00Z`),
      });
    }
    const top = await recentsService.listTop10(testDb, subWalletId);
    expect(top).toHaveLength(5);
  });
});
