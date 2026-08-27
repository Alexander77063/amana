import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { otpService } from '../../../src/modules/auth/otp.service';
import { vendorClaimService } from '../../../src/modules/vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
import { CURRENT_TERMS_VERSION } from '../../../src/modules/vendors/vendor-consent.service';
import { vendorOwnershipService } from '../../../src/modules/vendors/vendor-ownership.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const adapter = {} as AnchorAdapter;

async function aPromotedVendor() {
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

function stubOtpRequest() {
  return vi
    .spyOn(otpService, 'requestCode')
    .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
}

/**
 * PRE-LAUNCH GATE 3 — the registry-membership oracle.
 *
 * The cheapest channel needed no `/verify` call at all: `/request` sent the OTP to the
 * CALLER-SUPPLIED phone only when the account resolved to a promoted, unclaimed vendor. So an
 * attacker submitted their OWN number against someone else's bank account and watched whether an
 * SMS arrived — one request, no Anchor call, and an unambiguous yes to "this account has been paid
 * by at least VENDOR_REGISTRY_MIN_HOUSEHOLDS Amana households and nobody has claimed it". The
 * uniform 202 could not hide it, because the SMS is not part of the HTTP response.
 *
 * The fix is to stop letting the account decide whether a code is sent: `/request` now takes only
 * a phone and ALWAYS sends. The account is named at `/verify`, which sits behind proof of phone
 * control and may therefore speak plainly — so the honest owner keeps the `409` that tells them to
 * contact support, which is what made the runbook's original proposal too expensive.
 */
describe('vendor claim — the registry-membership oracle (GATE 3)', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('sends a code for a phone with no account named at all', async () => {
    const otp = stubOtpRequest();
    const phone = factories.phone();

    const r = await vendorClaimService.request(testDb, { phone, now: NOW });

    expect(r.accepted).toBe(true);
    expect(otp).toHaveBeenCalledTimes(1);
    expect(otp.mock.calls[0]?.[1]).toMatchObject({ phone, purpose: 'vendor_claim' });
  });

  // The oracle itself. Before the reorder these two cases differed in whether an SMS went out,
  // which is the whole leak; the HTTP response was identical either way and always had been.
  it('sends a code identically whether or not any registry vendor exists', async () => {
    const otp = stubOtpRequest();

    await vendorClaimService.request(testDb, { phone: factories.phone(), now: NOW });
    const withoutRegistry = otp.mock.calls.length;

    await aPromotedVendor();
    otp.mockClear();
    await vendorClaimService.request(testDb, { phone: factories.phone(), now: NOW });

    expect(otp).toHaveBeenCalledTimes(withoutRegistry);
    expect(withoutRegistry).toBe(1);
  });

  it('names the account at verify, and claims it once the OTP and ownership both hold', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    stubOtpRequest();
    await vendorClaimService.request(testDb, { phone, now: NOW });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: true,
      proof: 'phone_lookup',
      accountName: 'MUSA ABDULLAHI',
    });

    const r = await vendorClaimService.verify(testDb, adapter, {
      phone,
      code: '123456',
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      category: 'food',
      now: NOW,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });

    expect(r.kind).toBe('claimed');
  });

  // The honest-failure path the runbook said the original fix would destroy. It survives here,
  // because the caller is past proof by the time the account is judged.
  it('still answers ownership_unproved — the honest owner is not left in silence', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    stubOtpRequest();
    await vendorClaimService.request(testDb, { phone, now: NOW });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false,
      reason: 'mismatch',
    });

    const r = await vendorClaimService.verify(testDb, adapter, {
      phone,
      code: '123456',
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      category: 'food',
      now: NOW,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });

    expect(r.kind).toBe('ownership_unproved');
  });

  // A refused proof is the ops queue's inbox, not a dead end — and the row is only created once
  // the phone is proven, so the queue no longer fills with unproven land-grabs.
  it('leaves a pending attempt for ops when ownership is refused', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    stubOtpRequest();
    await vendorClaimService.request(testDb, { phone, now: NOW });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false,
      reason: 'mismatch',
    });
    await vendorClaimService.verify(testDb, adapter, {
      phone,
      code: '123456',
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      category: 'food',
      now: NOW,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });

    const pending = await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW);
    expect(pending?.vendorId).toBe(v.id);
  });

  it('creates no attempt row before the OTP is proven', async () => {
    const phone = factories.phone();
    stubOtpRequest();
    await vendorClaimService.request(testDb, { phone, now: NOW });

    expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW)).toBeUndefined();
  });

  it('a wrong code is rejected before any account is looked at', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    const prove = vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup');
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });

    const r = await vendorClaimService.verify(testDb, adapter, {
      phone,
      code: '000000',
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      category: null,
      now: NOW,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });

    expect(r.kind).toBe('invalid_code');
    // No paid Anchor round trip on an unproven caller.
    expect(prove).not.toHaveBeenCalled();
  });
});
