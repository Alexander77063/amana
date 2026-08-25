import { beforeEach, describe, expect, it, vi } from 'vitest';
import { otpService } from '../../src/modules/auth/otp.service';
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
});
