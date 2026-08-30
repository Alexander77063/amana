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
  GOOGLE_OAUTH_CLIENT_ID: 'amana-admin.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
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

  it('throws in production when the Workspace OAuth client is missing', () => {
    // Inverted by the Task 4 cutover, exactly as the note that used to sit here said it would be.
    // `ADMIN_API_KEY` is gone, so Google Workspace is now the ONLY way into the ops surfaces: a
    // missing OAuth app means no claim queue, no retailer KYB, no suspensions. Booting a portal
    // nobody can sign in to is worse than refusing to boot.
    const { GOOGLE_OAUTH_CLIENT_ID: _id, ...rest } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).toThrow(
      /GOOGLE_OAUTH_CLIENT_ID/,
    );
  });

  it('throws in production when GOOGLE_OAUTH_CLIENT_SECRET is missing', () => {
    const { GOOGLE_OAUTH_CLIENT_SECRET: _secret, ...rest } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).toThrow(
      /GOOGLE_OAUTH_CLIENT_SECRET/,
    );
  });

  it('no longer knows about ADMIN_API_KEY at all', () => {
    // Not merely optional — removed. Setting it is inert, so a stale deploy that still exports the
    // old secret boots fine and gains nothing from it, which is exactly what should happen.
    expect(() =>
      loadEnv({ ...base, ...prodSecrets, ADMIN_API_KEY: 'short', NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it('refuses a bootstrap owner outside the Workspace domain, in every environment', () => {
    // The portal refuses any address outside `ADMIN_WORKSPACE_DOMAIN`, so an owner configured
    // outside it is an owner who can never sign in — a system that looks configured and admits
    // nobody. That is a misconfiguration worth failing the boot for, not a runtime surprise, and
    // it is wrong in development too, so it is checked in the schema rather than the prod block.
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'development',
        ADMIN_WORKSPACE_DOMAIN: 'amana-ng.com',
        ADMIN_BOOTSTRAP_OWNER_EMAIL: 'david@elitesolutionshub.com',
      }),
    ).toThrow(/ADMIN_BOOTSTRAP_OWNER_EMAIL/);
  });

  it('accepts a bootstrap owner inside the Workspace domain', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'development',
        ADMIN_WORKSPACE_DOMAIN: 'amana-ng.com',
        ADMIN_BOOTSTRAP_OWNER_EMAIL: 'David@Amana-NG.com',
      }),
    ).not.toThrow();
  });

  it('lists every missing required secret in one error', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /ANCHOR_API_KEY.*ANCHOR_WEBHOOK_SECRET.*TERMII_API_KEY.*GOOGLE_OAUTH_CLIENT_ID/s,
    );
  });

  it('does NOT require those secrets outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
