import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../../src/lib/errors';
import type { BusinessKybClient } from '../../../src/modules/marketplace/retailer-onboarding.service';
import { retailerOnboardingService } from '../../../src/modules/marketplace/retailer-onboarding.service';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const createBusinessCustomer = vi.fn();
const anchor: BusinessKybClient = { createBusinessCustomer };

function bizResponse(id: string) {
  return { id, businessName: 'Ada Salon', kybStatus: 'PENDING' as const };
}

const applyInput = {
  businessName: 'Ada Salon',
  payoutBankCode: '000014',
  payoutAccountNumber: '0123456789',
};

beforeEach(async () => {
  await truncateAll();
  createBusinessCustomer.mockReset();
});

async function applyAndSubmit(bizId: string) {
  createBusinessCustomer.mockResolvedValue(bizResponse(bizId));
  const r = await retailerOnboardingService.apply(testDb, applyInput);
  await retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor);
  return r;
}

describe('retailerOnboardingService.apply', () => {
  it('creates an applied retailer — never live-approved', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    expect(r.onboardingStatus).toBe('applied');
    expect(r.anchorBusinessCustomerId).toBeNull();
  });
});

describe('retailerOnboardingService.submitKyb', () => {
  it('calls Anchor, stores the business customer id, sets kyb_pending', async () => {
    createBusinessCustomer.mockResolvedValue(bizResponse('biz-1'));
    const r = await retailerOnboardingService.apply(testDb, applyInput);

    const after = await retailerOnboardingService.submitKyb(
      testDb,
      r.id,
      { bvn: '22222222222', rcNumber: 'RC12345' },
      anchor,
    );

    expect(createBusinessCustomer).toHaveBeenCalledOnce();
    expect(createBusinessCustomer).toHaveBeenCalledWith(
      { businessName: 'Ada Salon', bvn: '22222222222', rcNumber: 'RC12345' },
      `kyb:${r.id}`,
    );
    expect(after.onboardingStatus).toBe('kyb_pending');
    expect(after.anchorBusinessCustomerId).toBe('biz-1');
  });

  it('is re-submittable from kyb_pending and reuses the same idempotency key', async () => {
    const r = await applyAndSubmit('biz-re');
    const again = await retailerOnboardingService.submitKyb(
      testDb,
      r.id,
      { bvn: '22222222222' },
      anchor,
    );
    expect(again.onboardingStatus).toBe('kyb_pending');
    expect(createBusinessCustomer.mock.calls.every((c) => c[1] === `kyb:${r.id}`)).toBe(true);
  });

  it('throws NotFoundError for an unknown retailer, without calling Anchor', async () => {
    await expect(
      retailerOnboardingService.submitKyb(
        testDb,
        factories.userId(),
        { bvn: '2'.repeat(11) },
        anchor,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(createBusinessCustomer).not.toHaveBeenCalled();
  });

  it('throws ConflictError on an approved retailer, without calling Anchor', async () => {
    const r = await applyAndSubmit('biz-4');
    await retailerOnboardingService.handleKybApproved(testDb, 'biz-4');
    createBusinessCustomer.mockClear();

    await expect(
      retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(createBusinessCustomer).not.toHaveBeenCalled();
  });

  it('cannot demote an approved retailer if approval lands mid-flight (CAS guard)', async () => {
    const r = await applyAndSubmit('biz-race');
    // Anchor "returns" only after the approval webhook has already landed: the read-side
    // guard passed, so only the compare-and-set can stop the demotion.
    createBusinessCustomer.mockImplementation(async () => {
      await retailerOnboardingService.handleKybApproved(testDb, 'biz-race');
      return bizResponse('biz-race');
    });

    await expect(
      retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor),
    ).rejects.toBeInstanceOf(ConflictError);
    const after = await retailersRepo.findById(testDb, r.id);
    expect(after?.onboardingStatus).toBe('approved');
  });
});

describe('retailerOnboardingService KYB webhooks', () => {
  it('handleKybApproved moves kyb_pending to approved', async () => {
    await applyAndSubmit('biz-2');
    const after = await retailerOnboardingService.handleKybApproved(testDb, 'biz-2');
    expect(after?.onboardingStatus).toBe('approved');
  });

  it('handleKybApproved is idempotent on re-delivery', async () => {
    await applyAndSubmit('biz-2b');
    await retailerOnboardingService.handleKybApproved(testDb, 'biz-2b');
    const again = await retailerOnboardingService.handleKybApproved(testDb, 'biz-2b');
    expect(again?.onboardingStatus).toBe('approved');
  });

  it('handleKybRejected moves kyb_pending to suspended', async () => {
    await applyAndSubmit('biz-3');
    const after = await retailerOnboardingService.handleKybRejected(testDb, 'biz-3', 'docs invalid');
    expect(after?.onboardingStatus).toBe('suspended');
  });

  it('handleKybRejected never un-approves an already-approved retailer', async () => {
    await applyAndSubmit('biz-3b');
    await retailerOnboardingService.handleKybApproved(testDb, 'biz-3b');
    const after = await retailerOnboardingService.handleKybRejected(testDb, 'biz-3b', 'late reject');
    expect(after?.onboardingStatus).toBe('approved');
  });

  it('returns undefined when no retailer matches the business customer id', async () => {
    expect(await retailerOnboardingService.handleKybApproved(testDb, 'biz-unknown')).toBeUndefined();
    expect(
      await retailerOnboardingService.handleKybRejected(testDb, 'biz-unknown', 'x'),
    ).toBeUndefined();
  });
});

describe('retailerOnboardingService ops overrides', () => {
  it('approve moves applied to approved without KYB', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    const after = await retailerOnboardingService.approve(testDb, r.id);
    expect(after.onboardingStatus).toBe('approved');
  });

  it('approve refuses to resurrect a suspended retailer', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    await retailerOnboardingService.suspend(testDb, r.id);
    await expect(retailerOnboardingService.approve(testDb, r.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('approve throws NotFoundError for an unknown retailer', async () => {
    await expect(
      retailerOnboardingService.approve(testDb, factories.userId()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('suspend works from approved and is idempotent', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    await retailerOnboardingService.approve(testDb, r.id);
    expect((await retailerOnboardingService.suspend(testDb, r.id)).onboardingStatus).toBe(
      'suspended',
    );
    expect((await retailerOnboardingService.suspend(testDb, r.id)).onboardingStatus).toBe(
      'suspended',
    );
  });

  it('suspend throws NotFoundError for an unknown retailer', async () => {
    await expect(
      retailerOnboardingService.suspend(testDb, factories.userId()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
