import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as pool } from '../../../src/db/client';
import type { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { drainBackgroundTasks } from '../../../src/lib/background';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { otpService } from '../../../src/modules/auth/otp.service';
import { vendorClaimService } from '../../../src/modules/vendors/vendor-claim.service';
import { vendorClaimsRepo } from '../../../src/modules/vendors/vendor-claims.repo';
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

function proveOwnership(proved: boolean) {
  return vi
    .spyOn(vendorOwnershipService, 'proveByPhoneLookup')
    .mockResolvedValue(
      proved
        ? { proved: true, proof: 'phone_lookup', accountName: 'MUSA ABDULLAHI' }
        : { proved: false, reason: 'mismatch' },
    );
}

describe('vendorClaimService', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  describe('request', () => {
    it('opens an attempt and sends an OTP for a promoted vendor', async () => {
      const v = await aPromotedVendor();
      const phone = factories.phone();
      const otp = vi
        .spyOn(otpService, 'requestCode')
        .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

      const r = await vendorClaimService.request(testDb, adapter, {
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
        phone,
        now: NOW,
      });

      expect(r.accepted).toBe(true);
      // The send is detached (runInBackground) so the response time can't leak whether an SMS
      // went out — drain before asserting it actually happened, on the pool, not the caller's db.
      await drainBackgroundTasks();
      expect(otp).toHaveBeenCalledWith(pool, { phone, purpose: 'vendor_claim' });
      expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW)).toBeDefined();
    });

    // Inverted closing PRE-LAUNCH GATE 2. This asserted that a phone already pending on v1 got
    // NO second code for v2 — the cross-vendor guard. Because `/request` proves nothing about
    // phone ownership, that guard was equally available to an attacker: opening an attempt under
    // a victim's number blocked that number from claiming anywhere else, for as long as the hold
    // lasted. Exclusivity now waits for `/verify`, so the guard is gone and both requests stand.
    it('lets a phone already pending on one vendor start a claim on another', async () => {
      const phone = factories.phone();
      const v1 = await aPromotedVendor();
      const otp = vi
        .spyOn(otpService, 'requestCode')
        .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

      const r1 = await vendorClaimService.request(testDb, adapter, {
        bankCode: v1.bankCode,
        accountNumber: v1.accountNumber,
        phone,
        now: NOW,
      });
      await drainBackgroundTasks();
      expect(r1.accepted).toBe(true);
      expect(otp).toHaveBeenCalledTimes(1);

      const v2 = await aPromotedVendor();
      const r2 = await vendorClaimService.request(testDb, adapter, {
        bankCode: v2.bankCode,
        accountNumber: v2.accountNumber,
        phone,
        now: NOW,
      });
      await drainBackgroundTasks();

      expect(r2.accepted).toBe(true);
      // A second code really is sent now — the caller asked about a different vendor.
      expect(otp).toHaveBeenCalledTimes(2);

      // Newest-first: the live `vendor_claim` code belongs to the most recent request, because
      // `requestCode` supersedes the previous challenge of the same purpose. So `verify` must
      // resolve v2, not v1.
      const pending = await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW);
      expect(pending?.vendorId).toBe(v2.id);
    });

    it('sends NO OTP for an account that is not in the registry', async () => {
      const otp = vi.spyOn(otpService, 'requestCode');
      const r = await vendorClaimService.request(testDb, adapter, {
        bankCode: factories.bankCode(),
        accountNumber: factories.bankAccount(),
        phone: factories.phone(),
        now: NOW,
      });
      // The RESULT is indistinguishable from the success case — that is the non-oracle contract.
      expect(r.accepted).toBe(true);
      expect(otp).not.toHaveBeenCalled();
    });

    it('sends no OTP for a vendor that is already claimed', async () => {
      const v = await aPromotedVendor();
      await vendorsRepo.claim(testDb, {
        vendorId: v.id,
        phone: factories.phone(),
        category: 'food',
        // Setup only: this test does not exercise the claim-time name write, so `null` keeps
        // the promoted `displayName` exactly as it was before that field became required.
        displayName: null,
        publicCode: 'AMNV-AAAAA-BBBBB',
        now: NOW,
      });
      const otp = vi.spyOn(otpService, 'requestCode');

      const r = await vendorClaimService.request(testDb, adapter, {
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
        phone: factories.phone(),
        now: NOW,
      });
      expect(r.accepted).toBe(true);
      expect(otp).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    async function openAttempt(phone: string) {
      const v = await aPromotedVendor();
      vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
      await vendorClaimService.request(testDb, adapter, {
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
        phone,
        now: NOW,
      });
      return v;
    }

    it('claims the vendor and mints a code on a good OTP and a proved account', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'food',
        now: NOW,
      });

      expect(r.kind).toBe('claimed');
      if (r.kind !== 'claimed') throw new Error('unreachable');
      expect(r.publicCode).toMatch(/^AMNV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);

      const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
      expect(after?.status).toBe('claimed');
      expect(after?.categorySource).toBe('claimed');
      expect(after?.category).toBe('food');
    });

    it('accepts a sensitive category from a claim — only inference is barred', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'pharmacy',
        now: NOW,
      });
      expect(r.kind).toBe('claimed');
      const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
      expect(after?.category).toBe('pharmacy');
    });

    it('does not claim when the OTP is wrong', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
      const prove = proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '000000',
        category: 'food',
        now: NOW,
      });
      expect(r.kind).toBe('invalid_code');
      // Ownership must not even be attempted before the OTP passes — it is a paid Anchor call.
      expect(prove).not.toHaveBeenCalled();
      expect((await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber))?.status).toBe(
        'observed',
      );
    });

    it('does not claim when ownership is unproved, even with a good OTP', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      proveOwnership(false);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'food',
        now: NOW,
      });
      expect(r.kind).toBe('ownership_unproved');
      expect((await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber))?.status).toBe(
        'observed',
      );
    });

    it('does not claim on an OTP minted for a different purpose', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      // What a real login OTP looks like coming back from the purpose-bound verifyCode.
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_purpose' });
      const prove = proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'food',
        now: NOW,
      });
      expect(r.kind).toBe('invalid_code');
      expect(prove).not.toHaveBeenCalled();
      expect((await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber))?.status).toBe(
        'observed',
      );
    });

    it('returns no_attempt when the phone has no pending claim', async () => {
      const r = await vendorClaimService.verify(testDb, adapter, {
        phone: factories.phone(),
        code: '123456',
        category: 'food',
        now: NOW,
      });
      expect(r.kind).toBe('no_attempt');
    });

    it('returns vendor_unavailable, not no_attempt, when the vendor is suspended mid-flow', async () => {
      // Site 2 of the old `no_attempt`. It sits BEHIND the verified OTP — the same gate that
      // protects the deliberately-retained 409 — so a distinct outcome reintroduces no oracle,
      // while collapsing it stranded the claimant: their code is already spent and their retry
      // `/request` early-returns on `status !== 'observed'` into the uniform 202, so "invalid
      // code" was permanent with no way out.
      const phone = factories.phone();
      const v = await openAttempt(phone);
      expect(await vendorsRepo.setStatus(testDb, v.id, 'suspended')).toBe(true);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      const prove = proveOwnership(true);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'food',
        now: NOW,
      });
      expect(r.kind).toBe('vendor_unavailable');
      // Decided before the paid Anchor lookup.
      expect(prove).not.toHaveBeenCalled();
    });

    it('returns vendor_unavailable when the claim compare-and-set loses the race', async () => {
      // Site 3: someone else claimed the vendor between the status read and the transaction. Same
      // reasoning as site 2 — post-OTP, so it may speak plainly.
      const phone = factories.phone();
      await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      proveOwnership(true);
      vi.spyOn(vendorsRepo, 'claim').mockResolvedValue(null);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'food',
        now: NOW,
      });
      expect(r.kind).toBe('vendor_unavailable');
    });

    it('audits every claim', async () => {
      const phone = factories.phone();
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      proveOwnership(true);
      await vendorClaimService.verify(testDb, adapter, {
        phone,
        code: '123456',
        category: 'food',
        now: NOW,
      });

      const entries = await auditRepo.listByAction(testDb, 'vendor.claimed');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.subjectId).toBe(v.id);
      const payload = entries[0]?.payloadJson as Record<string, unknown>;
      expect(payload.ownershipProof).toBe('phone_lookup');
      // The claimant's phone must not be echoed into the audit payload in the clear.
      expect(JSON.stringify(payload)).not.toContain(phone);
    });
  });
});
