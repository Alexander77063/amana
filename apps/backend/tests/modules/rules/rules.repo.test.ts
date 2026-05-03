import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { ruleSetsRepo } from '../../../src/modules/rules/rule-sets.repo';
import { rulesRepo } from '../../../src/modules/rules/rules.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedRuleSet() {
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
  const rs = await ruleSetsRepo.insert(testDb, {
    subWalletId: sw.sub.id, version: 1, createdByUserId: principal.id,
  });
  return rs.id;
}

describe('rulesRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insertMany + listByRuleSet round-trips', async () => {
    const rsId = await seedRuleSet();
    await rulesRepo.insertMany(testDb, rsId, [
      { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } },
      { kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['groceries'] } },
    ]);
    const list = await rulesRepo.listByRuleSet(testDb, rsId);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.kind).sort()).toEqual(['category', 'limit']);
  });

  it('jsonb config_json stores bigint maxKobo as string (Postgres jsonb has no bigint)', async () => {
    const rsId = await seedRuleSet();
    await rulesRepo.insertMany(testDb, rsId, [
      { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 30000n } },
    ]);
    const list = await rulesRepo.listByRuleSet(testDb, rsId);
    const cfg = list[0]?.configJson as { maxKobo: string };
    expect(cfg.maxKobo).toBe('30000');
  });

  it('inserting zero rules is a no-op', async () => {
    const rsId = await seedRuleSet();
    const result = await rulesRepo.insertMany(testDb, rsId, []);
    expect(result).toHaveLength(0);
  });
});
