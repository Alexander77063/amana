import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
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

describe('rule_sets table (schema)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rule_sets has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rule_sets' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id',
      'sub_wallet_id',
      'version',
      'status',
      'effective_from',
      'created_by_user_id',
      'created_at',
    ]);
  });

  it('rules has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rules' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id',
      'rule_set_id',
      'kind',
      'config_json',
      'priority',
    ]);
  });
});

describe('ruleSetsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('insert + findActive picks latest active', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    const v1 = await ruleSetsRepo.insert(testDb, {
      subWalletId,
      version: 1,
      createdByUserId: principalId,
    });
    await ruleSetsRepo.markSuperseded(testDb, v1.id);
    const v2 = await ruleSetsRepo.insert(testDb, {
      subWalletId,
      version: 2,
      createdByUserId: principalId,
    });
    const active = await ruleSetsRepo.findActive(testDb, subWalletId);
    expect(active?.id).toBe(v2.id);
    expect(active?.version).toBe(2);
  });

  it('maxVersion returns 0 when no rule sets exist', async () => {
    const { subWalletId } = await seedSubWallet();
    expect(await ruleSetsRepo.maxVersion(testDb, subWalletId)).toBe(0);
  });

  it('maxVersion returns the highest version even across superseded sets', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await ruleSetsRepo.insert(testDb, { subWalletId, version: 1, createdByUserId: principalId });
    await ruleSetsRepo.insert(testDb, { subWalletId, version: 2, createdByUserId: principalId });
    expect(await ruleSetsRepo.maxVersion(testDb, subWalletId)).toBe(2);
  });
});
