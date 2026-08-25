import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { otpService } from '../../../src/modules/auth/otp.service';
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
