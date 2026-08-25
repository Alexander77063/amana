import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorObservationService } from '../../../src/modules/vendors/vendor-observation.service';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';
import { makeHouseholdWithWallet } from '../../helpers/vendor-seed';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorObservationService.recordSettlement', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('resolves the household from the master wallet and records one observation', async () => {
    const { householdId, masterWalletId } = await makeHouseholdWithWallet(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await vendorObservationService.recordSettlement(testDb, {
      masterWalletId,
      bankCode,
      accountNumber,
      accountName: 'MAMA PUT KITCHEN',
      category: 'food',
      now: NOW,
    });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.householdId).toBe(householdId);
  });

  it('records nothing when the master wallet is unknown, and does not throw', async () => {
    await expect(
      vendorObservationService.recordSettlement(testDb, {
        masterWalletId: factories.walletId(),
        bankCode: factories.bankCode(),
        accountNumber: factories.bankAccount(),
        accountName: 'GHOST',
        category: 'food',
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows a repo failure — the registry must never surface an error to settlement', async () => {
    const { masterWalletId } = await makeHouseholdWithWallet(testDb);
    const spy = vi
      .spyOn(vendorObservationsRepo, 'record')
      .mockRejectedValue(new Error('registry exploded'));

    await expect(
      vendorObservationService.recordSettlement(testDb, {
        masterWalletId,
        bankCode: factories.bankCode(),
        accountNumber: factories.bankAccount(),
        accountName: 'MAMA PUT',
        category: 'food',
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    spy.mockRestore();
  });
});
