import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { fetchActiveRuleSet } from '../../../src/modules/rules/rule-set.fetcher';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
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
  return { principalId: principal.id, subWalletId: sw.sub.id };
}

describe('fetchActiveRuleSet', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns undefined when no rule set published', async () => {
    const { subWalletId } = await seedSubWallet();
    expect(await fetchActiveRuleSet(testDb, subWalletId)).toBeUndefined();
  });

  it('returns the active set with rules; bigints coerced from strings', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId,
      createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } }],
    });
    const fetched = await fetchActiveRuleSet(testDb, subWalletId);
    expect(fetched?.version).toBe(1);
    expect(fetched?.rules).toHaveLength(1);
    const r = fetched?.rules[0];
    expect(r?.kind).toBe('limit');
    if (r?.kind === 'limit') {
      expect(typeof r.config.maxKobo).toBe('bigint');
      expect(r.config.maxKobo).toBe(50000n);
    }
  });
});
