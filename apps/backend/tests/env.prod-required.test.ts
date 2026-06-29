import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

// Vars that have dev-safe defaults/fallbacks but are production essentials with
// NO safe default (CLAUDE.md "Environment"). The app must refuse to boot in
// production if any is missing, rather than booting and failing dangerously at
// runtime (webhooks → 503 = lost money; OTP send → no logins).
const base = {
  JWT_SECRET: 'x'.repeat(32),
  FIELD_ENCRYPTION_KEY: 'a'.repeat(64),
  DATABASE_URL: 'postgres://amana:amana_dev_only@localhost:5432/amana_dev',
};

const prodSecrets = {
  ANCHOR_API_KEY: 'anchor-test-key',
  ANCHOR_WEBHOOK_SECRET: 'whsec-test',
  TERMII_API_KEY: 'termii-test-key',
};

describe('env: production-required secrets', () => {
  it('boots in production when all required secrets are present', () => {
    expect(() => loadEnv({ ...base, ...prodSecrets, NODE_ENV: 'production' })).not.toThrow();
  });

  it('throws in production when ANCHOR_API_KEY is missing', () => {
    const { ANCHOR_API_KEY: _omit, ...rest } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).toThrow(/ANCHOR_API_KEY/);
  });

  it('throws in production when ANCHOR_WEBHOOK_SECRET is missing', () => {
    const { ANCHOR_WEBHOOK_SECRET: _omit, ...rest } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).toThrow(
      /ANCHOR_WEBHOOK_SECRET/,
    );
  });

  it('throws in production when TERMII_API_KEY is missing', () => {
    const { TERMII_API_KEY: _omit, ...rest } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).toThrow(/TERMII_API_KEY/);
  });

  it('lists every missing required secret in one error', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /ANCHOR_API_KEY.*ANCHOR_WEBHOOK_SECRET.*TERMII_API_KEY/s,
    );
  });

  it('does NOT require those secrets outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
