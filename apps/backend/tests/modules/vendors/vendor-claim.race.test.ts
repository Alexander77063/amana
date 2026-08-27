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

function ownership(proved: boolean) {
  return vi
    .spyOn(vendorOwnershipService, 'proveByPhoneLookup')
    .mockResolvedValue(
      proved
        ? { proved: true, proof: 'phone_lookup', accountName: 'MUSA ABDULLAHI' }
        : { proved: false, reason: 'mismatch' },
    );
}

async function verifyFor(
  v: { bankCode: string; accountNumber: string },
  phone: string,
  category: string | null = 'food',
) {
  return vendorClaimService.verify(testDb, adapter, {
    phone,
    code: '123456',
    bankCode: v.bankCode,
    accountNumber: v.accountNumber,
    category,
    now: NOW,
  });
}

/**
 * PRE-LAUNCH GATE 2 — the attacker-arrives-first race, re-expressed for the GATE 3 flow.
 *
 * Gate 2 removed the exclusive hold that `/request` used to hand out with no proof. Gate 3 then
 * moved attempt creation behind the OTP entirely, so an attempt now exists only for a caller who
 * has proved they hold the phone. The race is therefore structurally unreachable rather than
 * merely fixed — but the per-(vendor, phone) shape still has to hold, because two DIFFERENT proven
 * phones can legitimately both be waiting in the ops queue for the same vendor after a refused
 * ownership proof.
 */
describe('vendor claim — concurrent attempts on one vendor (GATE 2, under the GATE 3 flow)', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'verified' });
  });

  it('two proven phones can both be pending on one vendor after a refused proof', async () => {
    const v = await aPromotedVendor();
    const a = factories.phone();
    const b = factories.phone();
    ownership(false);

    expect((await verifyFor(v, a)).kind).toBe('ownership_unproved');
    expect((await verifyFor(v, b)).kind).toBe('ownership_unproved');

    expect((await vendorClaimsRepo.findPendingByPhone(testDb, a, NOW))?.vendorId).toBe(v.id);
    expect((await vendorClaimsRepo.findPendingByPhone(testDb, b, NOW))?.vendorId).toBe(v.id);
  });

  it('a repeat attempt from the same phone renews its own row rather than adding another', async () => {
    const v = await aPromotedVendor();
    const phone = factories.phone();
    ownership(false);

    await verifyFor(v, phone);
    await verifyFor(v, phone);

    const rows = await vendorClaimsRepo.listPendingForOps(testDb, NOW);
    expect(rows.filter((r) => r.vendorId === v.id && r.phone === phone)).toHaveLength(1);
  });

  it('a successful claim closes the other pending attempts on that vendor', async () => {
    const v = await aPromotedVendor();
    const loser = factories.phone();
    const winner = factories.phone();

    const refused = ownership(false);
    expect((await verifyFor(v, loser)).kind).toBe('ownership_unproved');
    refused.mockRestore();

    ownership(true);
    expect((await verifyFor(v, winner)).kind).toBe('claimed');

    // A vendor left claimed with a stranger's attempt still `pending` is a phantom ops-queue
    // entry for a business that no longer needs review.
    expect(await vendorClaimsRepo.findPendingByPhone(testDb, loser, NOW)).toBeUndefined();
  });

  it('one phone may be pending on several vendors at once', async () => {
    const v1 = await aPromotedVendor('MAMA PUT KITCHEN');
    const v2 = await aPromotedVendor('SUYA SPOT');
    const phone = factories.phone();
    ownership(false);

    await verifyFor(v1, phone);
    await verifyFor(v2, phone);

    const rows = await vendorClaimsRepo.listPendingForOps(testDb, NOW);
    expect(
      rows
        .filter((r) => r.phone === phone)
        .map((r) => r.vendorId)
        .sort(),
    ).toEqual([v1.id, v2.id].sort());
  });
});
