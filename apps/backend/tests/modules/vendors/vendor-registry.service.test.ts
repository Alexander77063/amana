import { beforeEach, describe, expect, it } from 'vitest';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import {
  type SweepConfig,
  vendorRegistryService,
} from '../../../src/modules/vendors/vendor-registry.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';
import { makeHousehold } from '../../helpers/vendor-seed';

const NOW = new Date('2026-08-25T10:00:00Z');

const CFG: SweepConfig = {
  minHouseholds: 3,
  consensusMinHouseholds: 4,
  consensusRatio: 0.6,
  sensitiveCategories: ['pharmacy'],
  retentionDays: 180,
};

async function observe(
  bankCode: string,
  accountNumber: string,
  category: string | null,
  households: number,
  when: Date = NOW,
): Promise<void> {
  for (let i = 0; i < households; i++) {
    const h = await makeHousehold(testDb);
    await vendorObservationsRepo.record(testDb, {
      bankCode,
      accountNumber,
      householdId: h.householdId,
      accountName: 'MAMA PUT KITCHEN',
      category,
      now: when,
    });
  }
}

describe('vendorRegistryService.sweep', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('promotes an account only once it clears the household threshold', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await observe(bankCode, accountNumber, 'food', 2);
    expect((await vendorRegistryService.sweep(testDb, NOW, CFG)).promoted).toBe(0);
    expect(await vendorsRepo.findByAccount(testDb, bankCode, accountNumber)).toBeUndefined();

    await observe(bankCode, accountNumber, 'food', 1);
    expect((await vendorRegistryService.sweep(testDb, NOW, CFG)).promoted).toBe(1);
    expect(await vendorsRepo.findByAccount(testDb, bankCode, accountNumber)).toBeDefined();
  });

  it('leaves a freshly promoted vendor uncategorised (promotion floor < consensus floor)', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'food', 3);

    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.promoted).toBe(1);
    expect(result.categorised).toBe(0);
    expect((await vendorsRepo.findByAccount(testDb, bankCode, accountNumber))?.category).toBeNull();
  });

  it('categorises on a later sweep once the consensus floor is reached', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'food', 3);
    await vendorRegistryService.sweep(testDb, NOW, CFG);

    await observe(bankCode, accountNumber, 'food', 1);
    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.promoted).toBe(0);
    expect(result.categorised).toBe(1);

    const v = await vendorsRepo.findByAccount(testDb, bankCode, accountNumber);
    expect(v?.category).toBe('food');
    expect(v?.categoryHouseholdCount).toBe(4);
  });

  it('never derives a sensitive category', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'pharmacy', 10);

    await vendorRegistryService.sweep(testDb, NOW, CFG);
    const v = await vendorsRepo.findByAccount(testDb, bankCode, accountNumber);
    expect(v).toBeDefined();
    expect(v?.category).toBeNull();
    expect(v?.categorySource).toBe('observed');
  });

  it('is idempotent — a second sweep over the same data changes nothing', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'food', 5);

    await vendorRegistryService.sweep(testDb, NOW, CFG);
    const second = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(second.promoted).toBe(0);
    expect(second.pruned).toBe(0);
  });

  it('prunes stale observations for accounts that never became vendors', async () => {
    const bankCode = factories.bankCode();
    const orphan = factories.bankAccount();
    const long = new Date('2025-01-01T00:00:00Z');
    await observe(bankCode, orphan, null, 1, long);

    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.pruned).toBe(1);
    expect(await vendorObservationsRepo.listForAccount(testDb, bankCode, orphan)).toEqual([]);
  });

  it('keeps observations for a promoted vendor however old they are', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const long = new Date('2025-01-01T00:00:00Z');
    await observe(bankCode, accountNumber, 'food', 5, long);

    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.promoted).toBe(1);
    expect(result.pruned).toBe(0);
    expect(
      await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber),
    ).toHaveLength(5);
  });
});
