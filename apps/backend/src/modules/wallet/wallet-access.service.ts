import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ForbiddenError } from '../../lib/errors';
import { householdsRepo } from '../identity/households.repo';
import { masterWalletsRepo } from './master-wallets.repo';
import { subWalletsRepo } from './sub-wallets.repo';

type DbOrTx = PostgresJsDatabase;

/**
 * Authorize a user against a money-movement target. Throws ForbiddenError
 * (→ HTTP 403) when the user may not act on it.
 *
 * Authorization is by **user identity vs. resource ownership**, never by the
 * JWT `role` claim — so it holds even if an access token's role were forged.
 *
 * Rules (locked decisions #7 delegated authority, #17 principal-direct spend):
 * - `subWalletId` set  → only the sub-wallet's owning AGENT may act, and the
 *   sub-wallet must belong to `masterWalletId`.
 * - `subWalletId` null → principal-direct spend: only the PRINCIPAL of the
 *   household that owns `masterWalletId` may act.
 */
export async function assertWalletAccess(
  db: DbOrTx,
  userId: string,
  target: { masterWalletId: string; subWalletId: string | null },
): Promise<void> {
  if (target.subWalletId !== null) {
    const sw = await subWalletsRepo.findById(db, target.subWalletId);
    if (!sw || sw.masterWalletId !== target.masterWalletId || sw.agentUserId !== userId) {
      throw new ForbiddenError();
    }
    return;
  }

  const mw = await masterWalletsRepo.findById(db, target.masterWalletId);
  if (!mw) throw new ForbiddenError();
  const hh = await householdsRepo.findById(db, mw.householdId);
  if (!hh || hh.principalUserId !== userId) throw new ForbiddenError();
}

/**
 * Authorize access to a single sub-wallet (the owning agent OR its household
 * principal). Throws ForbiddenError otherwise. Used by sub-wallet-scoped reads
 * such as vendor resolution / recents.
 */
export async function assertSubWalletAccess(
  db: DbOrTx,
  userId: string,
  subWalletId: string,
): Promise<void> {
  const sw = await subWalletsRepo.findById(db, subWalletId);
  if (!sw) throw new ForbiddenError();
  if (sw.agentUserId === userId) return;
  const mw = await masterWalletsRepo.findById(db, sw.masterWalletId);
  if (!mw) throw new ForbiddenError();
  const hh = await householdsRepo.findById(db, mw.householdId);
  if (!hh || hh.principalUserId !== userId) throw new ForbiddenError();
}

/** Resolve the principal user id that owns a sub-wallet's household, or null. */
export async function householdPrincipalForSubWallet(
  db: DbOrTx,
  subWalletId: string,
): Promise<string | null> {
  const sw = await subWalletsRepo.findById(db, subWalletId);
  if (!sw) return null;
  const mw = await masterWalletsRepo.findById(db, sw.masterWalletId);
  if (!mw) return null;
  const hh = await householdsRepo.findById(db, mw.householdId);
  return hh?.principalUserId ?? null;
}
