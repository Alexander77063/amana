import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { otpService } from '../../../src/modules/auth/otp.service';
import { vendorClaimService } from '../../../src/modules/vendors/vendor-claim.service';
import {
  CURRENT_TERMS_VERSION,
  vendorConsentService,
} from '../../../src/modules/vendors/vendor-consent.service';
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

function primeProvenClaim() {
  vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
  vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
  vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
    proved: true,
    proof: 'phone_lookup',
    accountName: 'MUSA ABDULLAHI',
  });
}

async function claim(
  v: { bankCode: string; accountNumber: string },
  phone: string,
  consent: {
    acceptedTermsVersion?: string;
    consentToLenderIntroduction?: boolean;
  },
) {
  return vendorClaimService.verify(testDb, adapter, {
    phone,
    code: '123456',
    bankCode: v.bankCode,
    accountNumber: v.accountNumber,
    category: 'food',
    now: NOW,
    ...consent,
  });
}

/**
 * NDPA 2023 lawful basis for the claim rail.
 *
 * Before this, a merchant proved phone control, was NIBSS-matched, became `claimed` — and agreed to
 * NOTHING. No terms, no privacy notice, and certainly no agreement to being introduced to a lender
 * on the strength of the payment regularity Amana observes (`PRICING.md` §8, by-product #1).
 *
 * The load-bearing property is that the two consents are SEPARATE. A consent bundled with a
 * different purpose is not consent under the NDPA, so refusing the optional one must cost the
 * merchant nothing.
 */
describe('vendor claim consent', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('refuses to claim without accepted service terms', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();

    const r = await claim(v, factories.phone(), {});

    expect(r.kind).toBe('terms_not_accepted');
  });

  it('refuses a stale terms version — a grant is only meaningful against the text shown', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();

    const r = await claim(v, factories.phone(), { acceptedTermsVersion: 'v0-ancient' });

    expect(r.kind).toBe('terms_not_accepted');
  });

  it('claims with terms accepted, and records the grant against that version', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    primeProvenClaim();

    const r = await claim(v, phone, { acceptedTermsVersion: CURRENT_TERMS_VERSION });
    expect(r.kind).toBe('claimed');

    const state = await vendorConsentService.currentState(testDb, v.id);
    expect(state.service_terms).toMatchObject({
      granted: true,
      termsVersion: CURRENT_TERMS_VERSION,
      source: 'claim',
    });
  });

  // The separation. Refusing the optional purpose must not cost the merchant the claim.
  it('claims fine when the lender introduction is refused, and records the refusal', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();

    const r = await claim(v, factories.phone(), {
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      consentToLenderIntroduction: false,
    });
    expect(r.kind).toBe('claimed');

    const state = await vendorConsentService.currentState(testDb, v.id);
    expect(state.lender_introduction?.granted).toBe(false);
  });

  it('defaults the lender introduction to OFF when it is not mentioned at all', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();

    await claim(v, factories.phone(), { acceptedTermsVersion: CURRENT_TERMS_VERSION });

    expect(await vendorConsentService.mayIntroduceToLender(testDb, v.id)).toBe(false);
  });

  it('records an opt-in when the merchant gives one', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();

    await claim(v, factories.phone(), {
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      consentToLenderIntroduction: true,
    });

    expect(await vendorConsentService.mayIntroduceToLender(testDb, v.id)).toBe(true);
  });

  // "Withdrawable as easily as it was given." A revocation is a new row; the grant is never erased,
  // because the evidence question is what they had agreed to AT THE TIME data was processed.
  it('revocation flips the answer and leaves the original grant in the log', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();
    await claim(v, factories.phone(), {
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      consentToLenderIntroduction: true,
    });
    expect(await vendorConsentService.mayIntroduceToLender(testDb, v.id)).toBe(true);

    await vendorConsentService.revoke(testDb, {
      vendorId: v.id,
      purpose: 'lender_introduction',
      source: 'ops',
      now: NOW,
    });

    expect(await vendorConsentService.mayIntroduceToLender(testDb, v.id)).toBe(false);
    const history = await vendorConsentService.history(testDb, v.id);
    const lender = history.filter((h) => h.purpose === 'lender_introduction');
    expect(lender).toHaveLength(2);
    expect(lender.some((h) => h.granted)).toBe(true);
  });

  it('revoking the lender introduction does not revoke the service terms', async () => {
    const v = await aPromotedVendor();
    primeProvenClaim();
    await claim(v, factories.phone(), {
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      consentToLenderIntroduction: true,
    });

    await vendorConsentService.revoke(testDb, {
      vendorId: v.id,
      purpose: 'lender_introduction',
      source: 'ops',
      now: NOW,
    });

    const state = await vendorConsentService.currentState(testDb, v.id);
    expect(state.service_terms?.granted).toBe(true);
  });

  // An `observed` vendor never agreed to anything at all — that is the whole point of the
  // observed/claimed line in PRICING.md §8.1.
  it('an unclaimed vendor may never be introduced', async () => {
    const v = await aPromotedVendor();
    expect(await vendorConsentService.mayIntroduceToLender(testDb, v.id)).toBe(false);
  });
});
