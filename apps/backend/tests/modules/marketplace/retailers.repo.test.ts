import { beforeEach, describe, expect, it } from 'vitest';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(truncateAll);

function newRetailer(overrides: Record<string, unknown> = {}) {
  return {
    businessName: 'Mama Ada Kitchen',
    payoutBankCode: factories.bankCode(),
    payoutAccountNumber: factories.bankAccount(),
    ...overrides,
  };
}

describe('retailersRepo', () => {
  it('insert returns the row with defaults (approved, no anchor customer)', async () => {
    const row = await retailersRepo.insert(testDb, newRetailer());
    expect(row.id).toBeTruthy();
    expect(row.businessName).toBe('Mama Ada Kitchen');
    expect(row.onboardingStatus).toBe('approved');
    expect(row.anchorBusinessCustomerId).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('insert honours explicit onboardingStatus + anchorBusinessCustomerId', async () => {
    const row = await retailersRepo.insert(
      testDb,
      newRetailer({ onboardingStatus: 'suspended', anchorBusinessCustomerId: 'anchor-biz-1' }),
    );
    expect(row.onboardingStatus).toBe('suspended');
    expect(row.anchorBusinessCustomerId).toBe('anchor-biz-1');
  });

  it('findById returns the row, or undefined for unknown id', async () => {
    const row = await retailersRepo.insert(testDb, newRetailer());
    const found = await retailersRepo.findById(testDb, row.id);
    expect(found?.id).toBe(row.id);
    expect(await retailersRepo.findById(testDb, factories.userId())).toBeUndefined();
  });

  it('listApproved returns only approved retailers', async () => {
    const approved = await retailersRepo.insert(testDb, newRetailer({ businessName: 'Approved' }));
    await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'applied' }));
    await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'suspended' }));

    const list = await retailersRepo.listApproved(testDb);
    expect(list.map((r) => r.id)).toEqual([approved.id]);
  });
});
