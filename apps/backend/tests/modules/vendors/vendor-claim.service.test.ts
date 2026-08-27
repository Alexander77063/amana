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
    // GATE 3. `/request` takes a phone and nothing else, and ALWAYS sends a code. The tests this
    // replaces asserted the opposite — "sends NO OTP for an account that is not in the registry"
    // and "sends no OTP for a vendor that is already claimed" — which is the oracle written down
    // as a requirement: the HTTP response was uniform, but whether an SMS arrived answered "is
    // this account a promoted, unclaimed vendor" to anyone who supplied their own number.
    it('sends an OTP for a phone, with no account named', async () => {
      const phone = factories.phone();
      const otp = vi
        .spyOn(otpService, 'requestCode')
        .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

      const r = await vendorClaimService.request(testDb, { phone, now: NOW });
      await drainBackgroundTasks();

      expect(r.accepted).toBe(true);
      expect(otp).toHaveBeenCalledTimes(1);
      expect(otp.mock.calls[0]?.[1]).toMatchObject({ phone, purpose: 'vendor_claim' });
    });

    it('sends an OTP even when no registry vendor exists at all', async () => {
      const otp = vi
        .spyOn(otpService, 'requestCode')
        .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

      await vendorClaimService.request(testDb, { phone: factories.phone(), now: NOW });
      await drainBackgroundTasks();

      expect(otp).toHaveBeenCalledTimes(1);
    });

    it('creates no attempt row — nothing is bound until the phone is proved', async () => {
      const phone = factories.phone();
      vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

      await vendorClaimService.request(testDb, { phone, now: NOW });
      await drainBackgroundTasks();

      expect(await vendorClaimsRepo.findPendingByPhone(testDb, phone, NOW)).toBeUndefined();
    });
  });

  describe('verify', () => {
    // Under GATE 3 the request step binds nothing to a vendor — it only mints a code. The
    // vendor is named at verify, so this just promotes one and primes the OTP.
    async function openAttempt(phone: string) {
      const v = await aPromotedVendor();
      vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
      await vendorClaimService.request(testDb, { phone, now: NOW });
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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

    // Replaces 'returns no_attempt when the phone has no pending claim'. That kind no longer
    // exists: with the account named here rather than at /request, there is no pre-OTP lookup to
    // fail, so an unproven caller always lands on the same argon2-priced `invalid_code`. Removing
    // the early return closed a timing channel as well as a status one.
    it('answers invalid_code — not a cheaper, earlier kind — when nothing is pending', async () => {
      const v = await aPromotedVendor();
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
      const r = await vendorClaimService.verify(testDb, adapter, {
        phone: factories.phone(),
        code: '000000',
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
        category: null,
        now: NOW,
      });
      expect(r.kind).toBe('invalid_code');
    });

    it('returns vendor_unavailable when the vendor is suspended mid-flow', async () => {
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
      const v = await openAttempt(phone);
      vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
        kind: 'verified',
        challengeId: 'c1',
        purpose: 'vendor_claim',
      });
      proveOwnership(true);
      vi.spyOn(vendorsRepo, 'claim').mockResolvedValue(null);

      const r = await vendorClaimService.verify(testDb, adapter, {
        phone,
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
        bankCode: v.bankCode,
        accountNumber: v.accountNumber,
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
