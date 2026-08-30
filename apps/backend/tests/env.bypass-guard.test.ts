import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const base = {
  JWT_SECRET: 'x'.repeat(32),
  FIELD_ENCRYPTION_KEY: 'a'.repeat(64),
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

/**
 * The same class of defect as the OTP bypass: one env var, set once, that quietly removes a
 * production safety property. `RATE_LIMIT_ENABLED=false` makes `attachRateLimiters` return before
 * registering anything AND makes every route-level limiter's key function return the `null` skip
 * sentinel — so it disables the OTP surfaces (an SMS bill and a phone-enumeration oracle), the
 * vendor claim rail, the public vendor page's only protection for Postgres, and the per-account
 * bound on our paid Anchor calls, all at once. It is a dev/test escape hatch; in production it is
 * a single-character outage.
 */
describe('env: RATE_LIMIT_ENABLED production guard', () => {
  const prodSecrets = {
    ANCHOR_API_KEY: 'anchor-test-key',
    ANCHOR_WEBHOOK_SECRET: 'whsec-test',
    TERMII_API_KEY: 'termii-test-key',
    GOOGLE_OAUTH_CLIENT_ID: 'amana-admin.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
  };

  it('throws when RATE_LIMIT_ENABLED is false in production', () => {
    expect(() =>
      loadEnv({ ...base, ...prodSecrets, NODE_ENV: 'production', RATE_LIMIT_ENABLED: 'false' }),
    ).toThrow(/RATE_LIMIT_ENABLED/);
  });

  it('boots in production when RATE_LIMIT_ENABLED is unset (it defaults ON)', () => {
    expect(() => loadEnv({ ...base, ...prodSecrets, NODE_ENV: 'production' })).not.toThrow();
  });

  /**
   * The transform is `v !== 'false'`, so ONLY the exact string turns it off. Pinned because the
   * neighbouring `VENDOR_CATEGORY_ENFORCE_DEFAULT` uses the inverted `v === 'true'`, and a guard
   * copied against the wrong one would reject every production boot.
   */
  it('does not reject other truthy-ish values in production', () => {
    expect(() =>
      loadEnv({ ...base, ...prodSecrets, NODE_ENV: 'production', RATE_LIMIT_ENABLED: 'true' }),
    ).not.toThrow();
  });

  it('allows RATE_LIMIT_ENABLED=false outside production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', RATE_LIMIT_ENABLED: 'false' }),
    ).not.toThrow();
  });
});
