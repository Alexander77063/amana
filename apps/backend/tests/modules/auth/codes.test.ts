import { describe, expect, it } from 'vitest';
import { generateOtpCode, hashCode, verifyCode } from '../../../src/modules/auth/codes';

describe('codes', () => {
  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('hash + verify round trip', async () => {
    const code = '123456';
    const hash = await hashCode(code);
    expect(await verifyCode(code, hash)).toBe(true);
    expect(await verifyCode('654321', hash)).toBe(false);
  });

  it('verifyCode returns false on invalid hash, never throws', async () => {
    expect(await verifyCode('123456', 'not-a-real-hash')).toBe(false);
  });
});
