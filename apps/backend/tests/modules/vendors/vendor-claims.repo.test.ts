import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const LATER = new Date('2026-09-01T10:30:00Z');

async function aVendor() {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'MAMA PUT KITCHEN',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

describe('vendorClaimsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('opens one attempt and refuses a concurrent second', async () => {
    const v = await aVendor();
    const first = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: LATER,
    });
    expect(first?.status).toBe('pending');
    const second = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: LATER,
    });
    expect(second).toBeNull();
  });

  it('finds a pending attempt by phone, but not an expired one', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    await vendorClaimsRepo.openAttempt(testDb, { vendorId: v.id, phone, expiresAt: LATER });

    expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW)).toBeDefined();
    const past = new Date('2026-09-01T11:00:00Z');
    expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, past)).toBeUndefined();
  });

  it('marks verified exactly once', async () => {
    const v = await aVendor();
    const a = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: LATER,
    });
    if (!a) throw new Error('open failed');
    expect(await vendorClaimsRepo.markVerified(testDb, a.id, 'phone_lookup', NOW)).toBe(true);
    expect(await vendorClaimsRepo.markVerified(testDb, a.id, 'phone_lookup', NOW)).toBe(false);
  });

  it('expires overdue pending attempts and leaves fresh ones alone', async () => {
    const v1 = await aVendor();
    const v2 = await aVendor();
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v1.id,
      phone: factories.phone(),
      expiresAt: NOW,
    });
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v2.id,
      phone: factories.phone(),
      expiresAt: new Date('2026-09-02T00:00:00Z'),
    });
    expect(await vendorClaimsRepo.expireOverdue(testDb, LATER)).toBe(1);
  });

  it('claims a vendor from observed and refuses a second claim', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    const claimed = await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone,
      category: 'food',
      publicCode: 'AMNV-AAAAA-BBBBB',
      now: NOW,
    });
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.categorySource).toBe('claimed');
    expect(claimed?.category).toBe('food');
    expect(claimed?.publicCode).toBe('AMNV-AAAAA-BBBBB');
    expect(claimed?.claimedByPhone).toBe(phone);

    const again = await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'transport',
      publicCode: 'AMNV-CCCCC-DDDDD',
      now: NOW,
    });
    expect(again).toBeNull();
  });

  it('lets ops set a category on a claimed vendor and suspend it', async () => {
    const v = await aVendor();
    await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      category: 'food',
      publicCode: 'AMNV-EEEEE-FFFFF',
      now: NOW,
    });
    expect(await vendorsRepo.setOpsCategory(testDb, v.id, 'pharmacy')).toBe(true);
    const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(after?.category).toBe('pharmacy');
    expect(after?.categorySource).toBe('ops');

    expect(await vendorsRepo.setStatus(testDb, v.id, 'suspended')).toBe(true);
    const suspended = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(suspended?.status).toBe('suspended');
  });
});
