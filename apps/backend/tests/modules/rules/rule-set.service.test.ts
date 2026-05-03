import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { ruleSetsRepo } from '../../../src/modules/rules/rule-sets.repo';
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
  return { principalId: principal.id, subWalletId: sw.sub.id };
}

describe('ruleSetService.publishNewVersion', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('first publish creates v1 active', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    const out = await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } }],
    });
    expect(out.ruleSet.version).toBe(1);
    expect(out.ruleSet.status).toBe('active');
    expect(out.rules).toHaveLength(1);
  });

  it('subsequent publish supersedes the old set and bumps version', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } }],
    });
    const v2 = await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 75000n } }],
    });
    expect(v2.ruleSet.version).toBe(2);

    const allActive = await ruleSetsRepo.findActive(testDb, subWalletId);
    expect(allActive?.version).toBe(2);

    const v1 = await ruleSetsRepo.findByVersion(testDb, subWalletId, 1);
    expect(v1?.status).toBe('superseded');
  });

  it('atomicity: if rules.insertMany fails, no rule_set row is created', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await expect(
      ruleSetService.publishNewVersion(testDb, {
        subWalletId,
        createdByUserId: principalId,
        rules: [
          {
            kind: 'limit',
            priority: Number.NaN as unknown as number,
            config: { windowKind: 'daily', maxKobo: 50000n },
          },
        ],
      }),
    ).rejects.toThrow();
    const max = await ruleSetsRepo.maxVersion(testDb, subWalletId);
    expect(max).toBe(0);
  });
});
