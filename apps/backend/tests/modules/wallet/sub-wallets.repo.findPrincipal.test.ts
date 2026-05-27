import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('subWalletsRepo.findPrincipalAndAgent', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns principalUserId and agentDisplayName for a valid sub-wallet', async () => {
    const principal = await usersRepo.insert(testDb, { role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn() });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'Test HH' });
    const { wallet: mw } = await masterWalletsRepo.provision(testDb, { householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058', anchorAccountId: 'anchor-acct-test' });
    const agent = await usersRepo.insert(testDb, { role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1' });
    const { sub } = await subWalletsRepo.provision(testDb, { masterWalletId: mw.id, agentUserId: agent.id, name: 'My Sub Wallet' });

    const result = await subWalletsRepo.findPrincipalAndAgent(testDb, sub.id);

    expect(result).not.toBeNull();
    expect(result?.principalUserId).toBe(principal.id);
    expect(result?.agentDisplayName).toBe('My Sub Wallet');
  });

  it('returns null for unknown sub-wallet id', async () => {
    const result = await subWalletsRepo.findPrincipalAndAgent(testDb, 'non-existent-id');
    expect(result).toBeNull();
  });
});
