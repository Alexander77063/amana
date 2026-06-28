import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const base = {
  JWT_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgres://amana:amana_dev_only@localhost:5432/amana_dev',
};

describe('env: DEV_OTP_BYPASS_CODE production guard', () => {
  it('throws when DEV_OTP_BYPASS_CODE is set in production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', DEV_OTP_BYPASS_CODE: '123456' }),
    ).toThrow(/DEV_OTP_BYPASS_CODE/);
  });

  it('allows DEV_OTP_BYPASS_CODE outside production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', DEV_OTP_BYPASS_CODE: '123456' }),
    ).not.toThrow();
  });
});
