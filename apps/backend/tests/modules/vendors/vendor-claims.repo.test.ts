import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const LATER = new Date('2026-09-01T10:30:00Z');
// `now - VENDOR_CLAIM_MAX_HOLD_SECONDS` for a caller at NOW: any row created before this
// instant is past the absolute hold ceiling and may no longer be renewed.
const RENEWABLE_SINCE = new Date('2026-09-01T09:00:00Z');

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
      now: NOW,
      renewableSince: RENEWABLE_SINCE,
    });
    if (!first) throw new Error('open failed');
    expect(first.status).toBe('pending');
    const second = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      // A LATER expiry than the incumbent's would be the giveaway if the different-phone branch
      // ever started re-dating: the land-grab guard must be a pure no-op, not a silent renewal.
      expiresAt: new Date('2026-09-01T23:00:00Z'),
      now: NOW,
      renewableSince: RENEWABLE_SINCE,
    });
    expect(second).toBeNull();
    const incumbent = await vendorClaimsRepo.findPendingByPhone(testDb, first.phone, NOW);
    expect(incumbent?.expiresAt.getTime()).toBe(LATER.getTime());
  });

  it('finds a pending attempt by phone, but not an expired one', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: LATER,
      now: NOW,
      renewableSince: RENEWABLE_SINCE,
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
      renewableSince: RENEWABLE_SINCE,
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
      renewableSince: RENEWABLE_SINCE,
    });
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v2.id,
      phone: factories.phone(),
      expiresAt: new Date('2026-09-02T00:00:00Z'),
      now: NOW,
      renewableSince: RENEWABLE_SINCE,
    });
    expect(await vendorClaimsRepo.expireOverdue(testDb, LATER)).toBe(1);
  });

  // The hold ceiling and the inline expiry below work off the row's own `created_at`, which is a
  // Postgres `defaultNow()` — the real wall clock, NOT the frozen NOW the rest of this file uses.
  // These tests therefore build their instants from `new Date()`, or the ceiling would be crossed
  // by six days of calendar skew rather than by the thing under test.
  const HOUR = 3_600_000;

  it('renews a hold inside the ceiling, and refuses to extend it past the ceiling', async () => {
    const v = await aVendor();
    const phone = factories.phone();
    const t0 = new Date();
    // A deliberately long TTL so the row stays UNEXPIRED throughout. If it lapsed, the inline
    // expiry would release the slot and this test would prove that instead of the ceiling.
    const opened = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: new Date(t0.getTime() + 10 * HOUR),
      now: t0,
      renewableSince: new Date(t0.getTime() - HOUR),
    });
    if (!opened) throw new Error('open failed');

    // Ten minutes on, well inside VENDOR_CLAIM_MAX_HOLD_SECONDS: the same phone renews, which is
    // what unlocks the legitimate retry after `409 ownership_unproved`.
    const inside = new Date(t0.getTime() + 10 * 60_000);
    const renewed = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: new Date(t0.getTime() + 11 * HOUR),
      now: inside,
      renewableSince: new Date(inside.getTime() - HOUR),
    });
    expect(renewed?.id).toBe(opened.id);
    expect(renewed?.expiresAt.getTime()).toBe(t0.getTime() + 11 * HOUR);

    // Two hours on, past the ceiling. Renewal is refused and — the part that matters — the slot's
    // expiry is NOT pushed out. Without this an attacker holding a phone STRING they do not
    // control renews for ever, squatting the vendor and blocking that number from every other one.
    const past = new Date(t0.getTime() + 2 * HOUR);
    const refused = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone,
      expiresAt: new Date(past.getTime() + 15 * 60_000),
      now: past,
      renewableSince: new Date(past.getTime() - HOUR),
    });
    expect(refused).toBeNull();
    const held = await vendorClaimsRepo.findPendingByPhone(testDb, phone, past);
    expect(held?.expiresAt.getTime()).toBe(t0.getTime() + 11 * HOUR);

    // And once that un-extended expiry lapses the slot really is claimable again — by anyone,
    // released inline rather than by the hourly sweep.
    const afterLapse = new Date(t0.getTime() + 12 * HOUR);
    const other = factories.phone();
    const taken = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: other,
      expiresAt: new Date(afterLapse.getTime() + 15 * 60_000),
      now: afterLapse,
      renewableSince: new Date(afterLapse.getTime() - HOUR),
    });
    expect(taken?.phone).toBe(other);
  });

  it('expires a lapsed pending row inline instead of waiting for the hourly sweep', async () => {
    const v = await aVendor();
    const first = factories.phone();
    const t0 = new Date();
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: first,
      expiresAt: new Date(t0.getTime() + 30 * 60_000),
      now: t0,
      renewableSince: new Date(t0.getTime() - HOUR),
    });

    // An hour on the row has lapsed, but `vendor-registry-sweep.job` only runs at 17 past, so up
    // to ~59 minutes of the old behaviour was a slot nobody could take.
    const later = new Date(t0.getTime() + HOUR);
    const second = factories.phone();
    const fresh = await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: second,
      expiresAt: new Date(later.getTime() + 15 * 60_000),
      now: later,
      renewableSince: new Date(later.getTime() - HOUR),
    });
    expect(fresh?.phone).toBe(second);

    // The lapsed row was moved to `expired`, not merely stepped over. `findPendingByPhone` at the
    // epoch matches on status alone (every `expires_at` is after 1970), so an undefined result
    // here means the status really changed.
    expect(await vendorClaimsRepo.findPendingByPhone(testDb, first, new Date(0))).toBeUndefined();
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
