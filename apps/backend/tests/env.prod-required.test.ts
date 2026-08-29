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
  ADMIN_API_KEY: 'z'.repeat(32),
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

  it('throws in production when ADMIN_API_KEY is missing', () => {
    const { ADMIN_API_KEY: _omit, ...rest } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).toThrow(/ADMIN_API_KEY/);
  });

  it('rejects a too-short ADMIN_API_KEY outright (schema, not just presence)', () => {
    expect(() =>
      loadEnv({ ...base, ...prodSecrets, ADMIN_API_KEY: 'short', NODE_ENV: 'production' }),
    ).toThrow(/ADMIN_API_KEY/);
  });

  it('does NOT yet require the Workspace OAuth client in production — Task 4 adds that', () => {
    // Deliberate, and the deliberation is the point of the test.
    //
    // A boot-required secret is a precondition for the app existing at all, and `amana-api` has
    // never booted in production. Until Task 4 deletes `ADMIN_API_KEY`, the 13 ops endpoints
    // still authenticate with the shared key, so a missing Workspace degrades nothing that works
    // — it would just be two more secrets standing between this app and its first boot.
    //
    // When Task 4 removes that fallback, a missing OAuth app means no ops access at all, and this
    // test should be inverted in the same change. If you are reading it because you deleted
    // `ADMIN_API_KEY`, that is the change: move both into `required` and flip this to `toThrow`.
    const {
      GOOGLE_OAUTH_CLIENT_ID: _id,
      GOOGLE_OAUTH_CLIENT_SECRET: _secret,
      ...rest
    } = prodSecrets;
    expect(() => loadEnv({ ...base, ...rest, NODE_ENV: 'production' })).not.toThrow();
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
      /ANCHOR_API_KEY.*ANCHOR_WEBHOOK_SECRET.*TERMII_API_KEY.*ADMIN_API_KEY/s,
    );
  });

  it('does NOT require those secrets outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
