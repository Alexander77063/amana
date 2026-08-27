import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

describe('loadEnv', () => {
  it('uses defaults when only NODE_ENV is set', () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.ANCHOR_API_BASE_URL).toBe('https://api.sandbox.getanchor.co');
  });

  it('coerces PORT from a string', () => {
    const env = loadEnv({ NODE_ENV: 'test', PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('throws a descriptive error when DATABASE_URL is malformed', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('ANCHOR_WEBHOOK_SECRET parses when set', () => {
    const env = loadEnv({ NODE_ENV: 'test', ANCHOR_WEBHOOK_SECRET: 'whsec_x' });
    expect(env.ANCHOR_WEBHOOK_SECRET).toBe('whsec_x');
  });

  it('ANCHOR_WEBHOOK_SECRET is optional (undefined when unset)', () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    expect(env.ANCHOR_WEBHOOK_SECRET).toBeUndefined();
  });
});

describe('vendor registry config', () => {
  it('defaults enforcement OFF and supplies registry thresholds', () => {
    const parsed = loadEnv({ NODE_ENV: 'test' });
    expect(parsed.VENDOR_CATEGORY_ENFORCE_DEFAULT).toBe(false);
    expect(parsed.VENDOR_REGISTRY_MIN_HOUSEHOLDS).toBe(5);
    expect(parsed.VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS).toBe(8);
    expect(parsed.VENDOR_REGISTRY_CONSENSUS_RATIO).toBe(0.6);
    expect(parsed.VENDOR_OBSERVATION_RETENTION_DAYS).toBe(180);
  });

  it('only the exact string "true" enables enforcement', () => {
    expect(
      loadEnv({ NODE_ENV: 'test', VENDOR_CATEGORY_ENFORCE_DEFAULT: 'true' })
        .VENDOR_CATEGORY_ENFORCE_DEFAULT,
    ).toBe(true);
    for (const v of ['false', '1', 'yes', 'TRUE', '']) {
      expect(
        loadEnv({ NODE_ENV: 'test', VENDOR_CATEGORY_ENFORCE_DEFAULT: v })
          .VENDOR_CATEGORY_ENFORCE_DEFAULT,
      ).toBe(false);
    }
  });

  it('parses sensitive categories to a trimmed lowercase list', () => {
    const parsed = loadEnv({
      NODE_ENV: 'test',
      VENDOR_SENSITIVE_CATEGORIES: ' Pharmacy , CLINIC ,, alcohol ',
    });
    expect(parsed.VENDOR_SENSITIVE_CATEGORIES).toEqual(['pharmacy', 'clinic', 'alcohol']);
  });

  it('ships a non-empty sensitive default that includes pharmacy', () => {
    expect(loadEnv({ NODE_ENV: 'test' }).VENDOR_SENSITIVE_CATEGORIES).toContain('pharmacy');
  });
});
