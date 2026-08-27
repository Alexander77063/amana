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

  // Inverted closing PRE-LAUNCH GATE 2. This test used to assert that a second phone got `null`
  // — "the land-grab guard" — which is the vulnerability stated as a requirement: `/request`
  // proves nothing about phone ownership, so that guard protected whoever called first, attacker
  // included. Concurrency is still bounded, just per (vendor, phone) rather than per vendor.
  it('lets a SECOND phone open its own attempt on the same vendor', async () => {
    const v = await aVendor();
    const first = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: LATER,
      now: NOW,
    });
    if (!first) throw new Error('open failed');
    expect(first.status).toBe('pending');

    const second = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date('2026-09-01T23:00:00Z'),
      now: NOW,
    });
    expect(second).not.toBeNull();
    expect(second?.status).toBe('pending');

    // The incumbent is untouched — a second caller neither displaces nor re-dates it.
    const incumbent = await vendorClaimsRepo.findPendingByPhone(testDb, first.phone, NOW);
    expect(incumbent?.id).toBe(first.id);
    expect(incumbent?.expiresAt.getTime()).toBe(LATER.getTime());
  });

  it('a repeat open from the SAME phone renews its own row rather than adding another', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    const first = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: LATER,
      now: NOW,
    });
    if (!first) throw new Error('open failed');

    const renewed = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: new Date('2026-09-01T23:00:00Z'),
      now: NOW,
    });
    expect(renewed?.id).toBe(first.id);
    expect(renewed?.expiresAt.getTime()).toBe(new Date('2026-09-01T23:00:00Z').getTime());
  });

  // The honest-owner trap the old ceiling created: a row past the ceiling that had not yet lapsed
  // could not be renewed, so `openAttempt` returned null and the OWNER — whose row it was — got
  // the uniform 202 with no code. With no exclusivity there is nothing left to ration, so an old
  // row simply renews.
  it('renews the same phone even on a very old row — no ceiling to strand the owner', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    const ancient = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: LATER,
      now: NOW,
    });
    if (!ancient) throw new Error('open failed');

    const muchLater = new Date('2026-09-02T18:00:00Z');
    const renewed = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: new Date('2026-09-02T18:30:00Z'),
      now: muchLater,
    });
    expect(renewed).not.toBeNull();
    expect(renewed?.id).toBe(ancient.id);
  });

  it('closes the other pending attempts on a vendor when one is verified', async () => {
    const v = await aVendor();
    const winnerPhone = factories.phone();
    const loserPhone = factories.phone();
    const winner = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: winnerPhone,
      expiresAt: LATER,
      now: NOW,
    });
    const loser = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: loserPhone,
      expiresAt: LATER,
      now: NOW,
    });
    if (!winner || !loser) throw new Error('open failed');

    const closed = await vendorClaimsRepo.rejectOtherPendingForVendor(testDb, v.id, winner.id);
    expect(closed).toBe(1);

    expect(await vendorClaimsRepo.findPendingByPhone(testDb, loserPhone, NOW)).toBeUndefined();
    // The winner is deliberately left alone — `markVerified` is what moves it on.
    expect((await vendorClaimsRepo.findPendingByPhone(testDb, winnerPhone, NOW))?.id).toBe(
      winner.id,
    );
  });

  it('finds a pending attempt by phone, but not an expired one', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: LATER,
      now: NOW,
    });

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
      now: NOW,
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
      now: NOW,
    });
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v2.id,
      phone: factories.phone(),
      expiresAt: new Date('2026-09-02T00:00:00Z'),
      now: NOW,
    });
    expect(await vendorClaimsRepo.expireOverdue(testDb, LATER)).toBe(1);
  });

  // The hold ceiling and the inline expiry below work off the row's own `created_at`, which is a
  // Postgres `defaultNow()` — the real wall clock, NOT the frozen NOW the rest of this file uses.
  // These tests therefore build their instants from `new Date()`, or the ceiling would be crossed
  // by six days of calendar skew rather than by the thing under test.
  const HOUR = 3_600_000;

  it('claims a vendor from observed and refuses a second claim', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    const claimed = await vendorsRepo.claim(testDb, {
      vendorId: v.id,
      phone,
      category: 'food',
      // Setup only: this test does not exercise the claim-time name write, so `null` keeps
      // the promoted `displayName` exactly as it was before that field became required.
      displayName: null,
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
      // Setup only: this test does not exercise the claim-time name write, so `null` keeps
      // the promoted `displayName` exactly as it was before that field became required.
      displayName: null,
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
      // Setup only: this test does not exercise the claim-time name write, so `null` keeps
      // the promoted `displayName` exactly as it was before that field became required.
      displayName: null,
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
