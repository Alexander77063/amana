import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainBackgroundTasks } from '../../src/lib/background';
import { otpService } from '../../src/modules/auth/otp.service';
import { vendorClaimsRepo } from '../../src/modules/vendors/vendor-claims.repo';
import { vendorOwnershipService } from '../../src/modules/vendors/vendor-ownership.service';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

const NOW = new Date('2026-09-01T10:00:00Z');
const app = createServer();

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /vendor-claim', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('needs no authentication', async () => {
    const res = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    expect(res.status).not.toBe(401);
  });

  it('is a NON-ORACLE: byte-identical responses for registered and unregistered accounts', async () => {
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    const known = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    const unknown = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '9999999999',
      phone: '+2348019999999',
    });

    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  it('is a NON-ORACLE at /verify too: no attempt and a wrong code are byte-identical', async () => {
    // The whole point. `verify` looks the attempt up BEFORE it checks the code, so if the two
    // outcomes differed on the wire an unauthenticated caller with a junk code could ask "is this
    // account a promoted registry vendor?" in one request — the same aggregate `/request`'s
    // uniform 202 exists to hide. Modelled on the `/request` non-oracle test above.
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
    // Has a pending attempt, wrong code.
    const wrongCode = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '000000',
      category: 'food',
    });
    // No attempt at all — the service still returns the internal `no_attempt` kind here.
    const noAttempt = await post('/vendor-claim/verify', {
      phone: '+2348017654321',
      code: '000000',
      category: 'food',
    });

    expect(wrongCode.status).toBe(401);
    expect(noAttempt.status).toBe(wrongCode.status);
    expect(await noAttempt.text()).toBe(await wrongCode.text());
  });

  it('400s a category outside the shared spend vocabulary', async () => {
    // Free text here would let a vendor decide whether someone else's spending lock applies: the
    // claimed category REPLACES the app-supplied one before the rule engine compares it.
    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '123456',
      category: 'Food',
    });
    expect(res.status).toBe(400);
  });

  it('re-issues an OTP when the same phone retries after an ownership failure', async () => {
    // The 409 path consumes the OTP but deliberately leaves the attempt `pending` for the ops
    // queue. Before this fix the claimant's next `/request` collided with the one-pending index,
    // got no row, and silently sent no second code — a lockout lasting until the HOURLY sweep.
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const otp = vi
      .spyOn(otpService, 'requestCode')
      .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

    const first = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    expect(first.status).toBe(202);
    // The send is detached (`runInBackground`) so it must be drained before it can be counted.
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(1);

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    const proof = vi
      .spyOn(vendorOwnershipService, 'proveByPhoneLookup')
      .mockResolvedValue({ proved: false, reason: 'mismatch' });
    const unproved = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '123456',
      category: 'food',
    });
    expect(unproved.status).toBe(409);

    // Retry from the SAME phone: still the uniform 202, and now a second code actually goes out.
    const retry = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    expect(retry.status).toBe(202);
    expect(await retry.text()).toBe(await first.text());
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(2);

    // And the recovered attempt still completes the claim.
    proof.mockResolvedValue({ proved: true, proof: 'phone_lookup' });
    const claimed = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '123456',
      category: 'food',
    });
    expect(claimed.status).toBe(200);
    const body = (await claimed.json()) as { publicCode: string };
    expect(body.publicCode).toMatch(/^AMNV-/);
  });

  it('keeps the land-grab guard: a repeat /request from a DIFFERENT phone is a silent no-op', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    const otp = vi
      .spyOn(otpService, 'requestCode')
      .mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });

    const mine = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(1);

    const theirs = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348017654321',
    });
    // Indistinguishable response, no second code: whoever opened the attempt has proved nothing
    // yet, so letting a second caller take the slot is the attack the index exists to stop.
    expect(theirs.status).toBe(mine.status);
    expect(await theirs.text()).toBe(await mine.text());
    await drainBackgroundTasks();
    expect(otp).toHaveBeenCalledTimes(1);

    const now = new Date();
    const held = await vendorClaimsRepo.findPendingByPhone(testDb, '+2348012345678', now);
    expect(held?.vendorId).toBe(v.id);
    expect(
      await vendorClaimsRepo.findPendingByPhone(testDb, '+2348017654321', now),
    ).toBeUndefined();
  });

  it('400s a malformed phone rather than passing it downstream', async () => {
    const res = await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: 'not-a-phone',
    });
    expect(res.status).toBe(400);
  });

  it('returns the minted code on a successful verify', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });
    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: true,
      proof: 'phone_lookup',
    });

    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '123456',
      category: 'food',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicCode: string; displayName: string };
    expect(body.publicCode).toMatch(/^AMNV-/);
    expect(body.displayName).toBe('MAMA PUT KITCHEN');
  });

  it('401s a wrong code and 409s an unproved account', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({ kind: 'wrong_code' });
    const bad = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '000000',
      category: 'food',
    });
    expect(bad.status).toBe(401);

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false,
      reason: 'mismatch',
    });
    const unproved = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '123456',
      category: 'food',
    });
    expect(unproved.status).toBe(409);
  });

  it('503s when the ownership partner is down', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: '058',
      accountNumber: '0123456789',
      displayName: 'MAMA PUT',
      promotedHouseholdCount: 6,
      now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    vi.spyOn(otpService, 'requestCode').mockResolvedValue({ challengeId: 'c1', expiresAt: NOW });
    await post('/vendor-claim/request', {
      bankCode: '058',
      accountNumber: '0123456789',
      phone: '+2348012345678',
    });

    vi.spyOn(otpService, 'verifyCode').mockResolvedValue({
      kind: 'verified',
      challengeId: 'c1',
      purpose: 'vendor_claim',
    });
    vi.spyOn(vendorOwnershipService, 'proveByPhoneLookup').mockResolvedValue({
      proved: false,
      reason: 'partner_down',
    });
    const res = await post('/vendor-claim/verify', {
      phone: '+2348012345678',
      code: '123456',
      category: 'food',
    });
    expect(res.status).toBe(503);
  });
});
