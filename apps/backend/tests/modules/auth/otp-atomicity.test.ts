import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as codes from '../../../src/modules/auth/codes';
import { otpService } from '../../../src/modules/auth/otp.service';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

// OTP_MAX_ATTEMPTS defaults to 5.
const MAX = 5;

describe('OTP verify enforces the attempt cap atomically', () => {
  beforeEach(async () => {
    await truncateAll();
    // biome-ignore lint/performance/noDelete: take the no-key / no-bypass path
    delete process.env.TERMII_API_KEY;
    // biome-ignore lint/performance/noDelete: ensure a real (spied) code, not the bypass
    delete process.env.DEV_OTP_BYPASS_CODE;
  });

  it('blocks further guesses after the cap, including a correct code', async () => {
    vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    const phone = factories.phone();
    await otpService.requestCode(testDb, { phone, purpose: 'login' });

    for (let i = 0; i < MAX; i++) {
      const r = await otpService.verifyCode(testDb, { phone, code: '000000' });
      expect(r.kind).toBe('wrong_code');
    }
    const blocked = await otpService.verifyCode(testDb, { phone, code: '000000' });
    expect(blocked.kind).toBe('too_many_attempts');
    // The cap holds even for the correct code once exhausted.
    const correct = await otpService.verifyCode(testDb, { phone, code: '123456' });
    expect(correct.kind).toBe('too_many_attempts');
  });

  it('never allows more than OTP_MAX_ATTEMPTS guesses under concurrency', async () => {
    vi.spyOn(codes, 'generateOtpCode').mockReturnValue('123456');
    const phone = factories.phone();
    await otpService.requestCode(testDb, { phone, purpose: 'login' });

    const results = await Promise.all(
      Array.from({ length: 12 }, () => otpService.verifyCode(testDb, { phone, code: '000000' })),
    );
    const wrong = results.filter((r) => r.kind === 'wrong_code').length;
    const tooMany = results.filter((r) => r.kind === 'too_many_attempts').length;
    expect(wrong).toBeLessThanOrEqual(MAX);
    expect(wrong + tooMany).toBe(12);
  });
});
