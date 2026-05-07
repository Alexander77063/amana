import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { subwalletSnoozeRepo } from '../../../src/modules/notifications/subwallet-snooze.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedPrincipalAndSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, {
    principalUserId: principal.id,
    name: 'HH',
  });
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

describe('subwalletSnoozeRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('isActive', () => {
    it('returns false when no row exists', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      expect(await subwalletSnoozeRepo.isActive(testDb, principalId, subWalletId)).toBe(false);
    });

    it('returns true when expires_at is null (indefinite)', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      expect(await subwalletSnoozeRepo.isActive(testDb, principalId, subWalletId)).toBe(true);
    });

    it('returns true when expires_at is in the future', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, future);
      expect(await subwalletSnoozeRepo.isActive(testDb, principalId, subWalletId)).toBe(true);
    });

    it('returns false when expires_at is in the past (dead state, harmless)', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      const past = new Date(Date.now() - 60 * 1000);
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, past);
      expect(await subwalletSnoozeRepo.isActive(testDb, principalId, subWalletId)).toBe(false);
    });
  });

  describe('upsert', () => {
    it('is idempotent — second call updates expires_at', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      const first = new Date(Date.now() + 60 * 1000);
      const second = new Date(Date.now() + 120 * 1000);
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, first);
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, second);
      const rows = await subwalletSnoozeRepo.listForUser(testDb, principalId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.expiresAt?.toISOString()).toBe(second.toISOString());
    });
  });

  describe('delete', () => {
    it('removes the row', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      await subwalletSnoozeRepo.delete(testDb, principalId, subWalletId);
      expect(await subwalletSnoozeRepo.isActive(testDb, principalId, subWalletId)).toBe(false);
    });

    it('is idempotent when no row exists', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await expect(
        subwalletSnoozeRepo.delete(testDb, principalId, subWalletId),
      ).resolves.toBeUndefined();
    });
  });

  describe('listForUser', () => {
    it('returns all snoozed sub-wallets for a user (regardless of expiry)', async () => {
      const { principalId, subWalletId: a } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, a, null);
      const rows = await subwalletSnoozeRepo.listForUser(testDb, principalId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.subWalletId).toBe(a);
    });
  });
});
