import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { otpService } from '../../../src/modules/auth/otp.service';
import { vendorClaimService } from '../../../src/modules/vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
import { vendorOwnershipService } from '../../../src/modules/vendors/vendor-ownership.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const adapter = {} as AnchorAdapter;

async function aPromotedVendor(name = 'MAMA PUT KITCHEN') {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: name,
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

function stubOtp() {
  return vi
    .spyOn(otpService, 'requestCode')
    .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
}

async function request(v: { bankCode: string; accountNumber: string }, phone: string, now = NOW) {
  return vendorClaimService.request(testDb, adapter, {
    bankCode: v.bankCode,
    accountNumber: v.accountNumber,
    phone,
    now,
  });
}

/**
 * PRE-LAUNCH GATE 2 — the attacker-arrives-first race.
 *
 * Nothing at `/request` proves the caller controls the phone they submitted; it is a string in a
 * request body. While a `pending` row held an EXCLUSIVE slot, whoever called first — with any
 * phone at all — took it, and the real owner was locked out until it lapsed.
 *
 * The fix is to stop making an unproven request exclusive. Several attempts may be pending on one
 * vendor; the slot is won at `/verify`, by whoever actually receives the OTP. An attacker who
 * cannot receive the SMS therefore holds nothing, and the race stops existing rather than being
 * bounded by a timer.
 */
describe('vendor claim — the attacker-arrives-first race (GATE 2)', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('a second phone can open its own attempt on a vendor someone else already requested', async () => {
    const v = await aPromotedVendor();
    const attacker = factories.phone();
    const owner = factories.phone();
    const otp = stubOtp();

    await request(v, attacker);
    otp.mockClear();
    await request(v, owner);

    // The real owner must actually be sent a code. Before this fix the second caller was
    // swallowed into the uniform 202 with no SMS at all — indistinguishable, to them, from
    // success.
    expect(otp).toHaveBeenCalledTimes(1);
    expect(otp.mock.calls[0]?.[1]).toMatchObject({ phone: owner, purpose: 'vendor_claim' });
  });

  it('both attempts exist and are pending — neither displaces the other', async () => {
    const v = await aPromotedVendor();
    const attacker = factories.phone();
    const owner = factories.phone();
    stubOtp();

    await request(v, attacker);
    await request(v, owner);

    const forOwner = await vendorClaimsRepo.findPendingByPhone(testDb, owner, NOW);
    const forAttacker = await vendorClaimsRepo.findPendingByPhone(testDb, attacker, NOW);
    expect(forOwner?.vendorId).toBe(v.id);
    expect(forAttacker?.vendorId).toBe(v.id);
  });

  // The cross-vendor half of the grief: an attempt opened under a victim's phone number used to
  // block that number from starting a claim on any OTHER vendor.
  it('a phone already pending on one vendor can still start a claim on another', async () => {
    const v1 = await aPromotedVendor('MAMA PUT KITCHEN');
    const v2 = await aPromotedVendor('SUYA SPOT');
    const phone = factories.phone();
    const otp = stubOtp();

    await request(v1, phone);
    otp.mockClear();
    await request(v2, phone);

    expect(otp).toHaveBeenCalledTimes(1);
    const pending = await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW);
    // Newest-first: the code that just arrived belongs to the most recent request.
    expect(pending?.vendorId).toBe(v2.id);
  });

  it('a repeat request from the same phone on the same vendor renews rather than duplicating', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    stubOtp();

    await request(v, phone);
    await request(v, phone, new Date(NOW.getTime() + 60_000));

    const rows = await vendorClaimsRepo.listPendingForOps(testDb, NOW);
    expect(rows.filter((r) => r.vendorId === v.id && r.phone === phone)).toHaveLength(1);
  });

  it('a successful claim closes the other pending attempts on that vendor', async () => {
    const v = await aPromotedVendor();
    const attacker = factories.phone();
    const owner = factories.phone();
    stubOtp();
    await request(v, attacker);
    await request(v, owner);

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: true,
      proof: 'phone_lookup',
      accountName: 'MUSA ABDULLAHI',
    });

    const r = await vendorClaimService.verify(testDb, adapter, {
      phone: owner,
      code: '123456',
      category: 'food',
      now: NOW,
    });
    expect(r.kind).toBe('claimed');

    // A vendor left claimed with a stranger's attempt still `pending` is a phantom ops-queue
    // entry for a business that no longer needs review.
    const stillPending = await vendorClaimsRepo.findPendingByPhone(testDb, attacker, NOW);
    expect(stillPending).toBeUndefined();
  });
});
