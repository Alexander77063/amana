import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { otpService } from '../../../src/modules/auth/otp.service';
import type { OtpPurpose } from '../../../src/modules/auth/types';
import { testDb, truncateAll } from '../../helpers/test-db';

beforeEach(async () => {
  await truncateAll();
  // biome-ignore lint/performance/noDelete: unsetting env var so the otp service takes its no-key skip path
  delete process.env.TERMII_API_KEY;
});

afterEach(() => vi.restoreAllMocks());

describe('otpService.requestCode', () => {
  it('returns a challenge id with future expiry', async () => {
    const r = await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    expect(r.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('a second request invalidates the first', async () => {
    const r1 = await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    const r2 = await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    expect(r2.challengeId).not.toBe(r1.challengeId);
  });
});

describe('otpService.verifyCode', () => {
  it('no_challenge when no pending request', async () => {
    const r = await otpService.verifyCode(testDb, {
      phone: '+2348012345678',
      code: '000000',
      allowedPurposes: ['login'],
    });
    expect(r.kind).toBe('no_challenge');
  });

  it('wrong_code increments attempts; too_many_attempts after MAX', async () => {
    await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    for (let i = 0; i < 5; i++) {
      const r = await otpService.verifyCode(testDb, {
        phone: '+2348012345678',
        code: '999999',
        allowedPurposes: ['login'],
      });
      expect(r.kind).toBe('wrong_code');
    }
    const blocked = await otpService.verifyCode(testDb, {
      phone: '+2348012345678',
      code: '999999',
      allowedPurposes: ['login'],
    });
    expect(blocked.kind).toBe('too_many_attempts');
  });

  it('verified path: spy generateOtpCode to know the code', async () => {
    const codesModule = await import('../../../src/modules/auth/codes');
    const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue('123456');
    await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    spy.mockRestore();
    const r = await otpService.verifyCode(testDb, {
      phone: '+2348012345678',
      code: '123456',
      allowedPurposes: ['login'],
    });
    expect(r.kind).toBe('verified');
  });

  it('verifying twice — second sees no active challenge (consumed)', async () => {
    const codesModule = await import('../../../src/modules/auth/codes');
    const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue('123456');
    await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
    spy.mockRestore();
    await otpService.verifyCode(testDb, {
      phone: '+2348012345678',
      code: '123456',
      allowedPurposes: ['login'],
    });
    const second = await otpService.verifyCode(testDb, {
      phone: '+2348012345678',
      code: '123456',
      allowedPurposes: ['login'],
    });
    expect(second.kind).toBe('no_challenge');
  });

  describe('purpose binding', () => {
    it('refuses a pair-minted challenge when only login is allowed', async () => {
      const codesModule = await import('../../../src/modules/auth/codes');
      const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue('123456');
      await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'pair' });
      spy.mockRestore();
      const r = await otpService.verifyCode(testDb, {
        phone: '+2348012345678',
        code: '123456',
        allowedPurposes: ['login'],
      });
      expect(r.kind).toBe('wrong_purpose');
    });

    it('accepts a login-minted challenge when both login and pair are allowed', async () => {
      const codesModule = await import('../../../src/modules/auth/codes');
      const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue('123456');
      await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'login' });
      spy.mockRestore();
      const r = await otpService.verifyCode(testDb, {
        phone: '+2348012345678',
        code: '123456',
        allowedPurposes: ['login', 'pair'],
      });
      expect(r.kind).toBe('verified');
    });

    it('a purpose mismatch does not consume the challenge — correct allowed set still succeeds after', async () => {
      const codesModule = await import('../../../src/modules/auth/codes');
      const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue('123456');
      await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'pair' });
      spy.mockRestore();
      const mismatched = await otpService.verifyCode(testDb, {
        phone: '+2348012345678',
        code: '123456',
        allowedPurposes: ['login'],
      });
      expect(mismatched.kind).toBe('wrong_purpose');
      const retried = await otpService.verifyCode(testDb, {
        phone: '+2348012345678',
        code: '123456',
        allowedPurposes: ['pair'],
      });
      expect(retried.kind).toBe('verified');
    });

    it('a purpose mismatch does not spend an attempt slot — correct call still succeeds after several mismatches', async () => {
      const codesModule = await import('../../../src/modules/auth/codes');
      const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue('123456');
      await otpService.requestCode(testDb, { phone: '+2348012345678', purpose: 'pair' });
      spy.mockRestore();
      // More mismatches than OTP_MAX_ATTEMPTS (default 5) would allow, if they burned attempts.
      for (let i = 0; i < 7; i++) {
        const r = await otpService.verifyCode(testDb, {
          phone: '+2348012345678',
          code: '123456',
          allowedPurposes: ['login'],
        });
        expect(r.kind).toBe('wrong_purpose');
      }
      const r = await otpService.verifyCode(testDb, {
        phone: '+2348012345678',
        code: '123456',
        allowedPurposes: ['pair'],
      });
      expect(r.kind).toBe('verified');
    });
  });
});

// PRE-LAUNCH GATE 1 (docs/runbook/vendor-claim.md). `requestCode` invalidated EVERY unconsumed
// challenge for a phone regardless of purpose. `/vendor-claim/request` is unauthenticated and a
// promoted vendor's account number is printed on shop stickers rather than secret, so anyone could
// cancel any user's in-flight login OTP by requesting a claim against that user's phone number.
// The purpose binding in `verifyCode` stops a claim code COMPLETING a login; it does nothing about
// a claim request CANCELLING one. That cancellation half is what these cover.
describe('otpService cross-purpose isolation', () => {
  const PHONE = '+2348012345678';

  async function requestWithCode(purpose: OtpPurpose, code: string) {
    const codesModule = await import('../../../src/modules/auth/codes');
    const spy = vi.spyOn(codesModule, 'generateOtpCode').mockReturnValue(code);
    const r = await otpService.requestCode(testDb, { phone: PHONE, purpose });
    spy.mockRestore();
    return r;
  }

  it('a vendor_claim request does not cancel a pending login challenge', async () => {
    await requestWithCode('login', '111111');
    await requestWithCode('vendor_claim', '222222');

    const r = await otpService.verifyCode(testDb, {
      phone: PHONE,
      code: '111111',
      allowedPurposes: ['login'],
    });
    expect(r.kind).toBe('verified');
  });

  it('a login request does not cancel a pending vendor_claim challenge', async () => {
    await requestWithCode('vendor_claim', '222222');
    await requestWithCode('login', '111111');

    const r = await otpService.verifyCode(testDb, {
      phone: PHONE,
      code: '222222',
      allowedPurposes: ['vendor_claim'],
    });
    expect(r.kind).toBe('verified');
  });

  // Scoping the invalidate is what makes two live challenges for one phone possible at all, which
  // is exactly why the lookup needs to care about purpose too: an unordered `limit 1` across both
  // rows would hand verifyCode the wrong one and reject a code that is genuinely correct.
  it('verifyCode picks the challenge matching allowedPurposes when both are active', async () => {
    await requestWithCode('login', '111111');
    await requestWithCode('vendor_claim', '222222');

    const claim = await otpService.verifyCode(testDb, {
      phone: PHONE,
      code: '222222',
      allowedPurposes: ['vendor_claim'],
    });
    expect(claim.kind).toBe('verified');
  });

  // The lookup must PREFER a matching purpose, not filter to one. If the only live challenge is the
  // wrong purpose there is still a challenge, and saying `no_challenge` would both break the
  // documented contract above and leak a different shape than `wrong_purpose` does.
  it('still reports wrong_purpose when the only active challenge is another purpose', async () => {
    await requestWithCode('vendor_claim', '222222');

    const r = await otpService.verifyCode(testDb, {
      phone: PHONE,
      code: '222222',
      allowedPurposes: ['login'],
    });
    expect(r.kind).toBe('wrong_purpose');
  });

  it('a second request of the SAME purpose still invalidates the first', async () => {
    await requestWithCode('login', '111111');
    await requestWithCode('login', '333333');

    const stale = await otpService.verifyCode(testDb, {
      phone: PHONE,
      code: '111111',
      allowedPurposes: ['login'],
    });
    expect(stale.kind).not.toBe('verified');
  });
});
