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
});
