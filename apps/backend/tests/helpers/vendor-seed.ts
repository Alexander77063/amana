import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { factories } from './factories';

/**
 * A minimal principal + the household they own. Shared seed for the vendor registry suites
 * (SP-V1+), which only need a real `household_id` to hang observations/enforcement off of and
 * don't care about wallets, sub-wallets or agents.
 *
 * Kept intentionally thin: later vendor tasks are expected to extend this file with
 * `makeHouseholdWithWallet`, `makeFundedSubWallet`, etc. rather than each test hand-rolling the
 * insert.
 */
export async function makeHousehold(
  db: PostgresJsDatabase,
): Promise<{ householdId: string; principalUserId: string }> {
  const principal = await usersRepo.insert(db, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    bvn: factories.bvn(),
    kycTier: '2',
  });
  const household = await householdsRepo.insert(db, {
    principalUserId: principal.id,
    name: 'Test household',
  });
  return { householdId: household.id, principalUserId: principal.id };
}

/**
 * A principal + household + master wallet. Used by vendor observation tests.
 */
export async function makeHouseholdWithWallet(
  db: PostgresJsDatabase,
): Promise<{ householdId: string; principalUserId: string; masterWalletId: string }> {
  const { householdId, principalUserId } = await makeHousehold(db);
  const provisioned = await masterWalletsRepo.provision(db, {
    householdId,
    anchorVirtualAccount: factories.bankAccount(),
    anchorBankCode: '058',
    anchorAccountId: `test-acct-${factories.householdId()}`,
  });
  return {
    householdId,
    principalUserId,
    masterWalletId: provisioned.master.id,
  };
}
