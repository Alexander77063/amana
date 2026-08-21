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

  it('updateOnboardingStatus transitions the row unconditionally', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'applied' }));
    const updated = await retailersRepo.updateOnboardingStatus(testDb, r.id, 'kyb_pending');
    expect(updated?.onboardingStatus).toBe('kyb_pending');
  });

  it('transitionOnboardingStatus applies the move when the guard holds', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'applied' }));
    const updated = await retailersRepo.transitionOnboardingStatus(
      testDb,
      r.id,
      ['applied', 'kyb_pending'],
      'kyb_pending',
      { anchorBusinessCustomerId: 'biz-cas' },
    );
    expect(updated?.onboardingStatus).toBe('kyb_pending');
    expect(updated?.anchorBusinessCustomerId).toBe('biz-cas');
  });

  it('transitionOnboardingStatus is a no-op (undefined) when the guard fails', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'suspended' }));
    const updated = await retailersRepo.transitionOnboardingStatus(
      testDb,
      r.id,
      ['applied', 'kyb_pending'],
      'approved',
    );
    expect(updated).toBeUndefined();
    const after = await retailersRepo.findById(testDb, r.id);
    expect(after?.onboardingStatus).toBe('suspended');
  });

  it('transitionOnboardingStatus lets exactly one of two concurrent callers win', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'kyb_pending' }));
    const [a, b] = await Promise.all([
      retailersRepo.transitionOnboardingStatus(testDb, r.id, ['kyb_pending'], 'approved'),
      retailersRepo.transitionOnboardingStatus(testDb, r.id, ['kyb_pending'], 'approved'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('setAnchorBusinessCustomerId stores the id', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer());
    const updated = await retailersRepo.setAnchorBusinessCustomerId(testDb, r.id, 'biz-9');
    expect(updated?.anchorBusinessCustomerId).toBe('biz-9');
  });

  it('findByAnchorBusinessCustomerId resolves the retailer, undefined when unknown', async () => {
    const r = await retailersRepo.insert(
      testDb,
      newRetailer({ anchorBusinessCustomerId: 'biz-7' }),
    );
    const found = await retailersRepo.findByAnchorBusinessCustomerId(testDb, 'biz-7');
    expect(found?.id).toBe(r.id);
    expect(await retailersRepo.findByAnchorBusinessCustomerId(testDb, 'biz-nope')).toBeUndefined();
  });
});
