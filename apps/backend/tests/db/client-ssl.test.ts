import { describe, expect, it } from 'vitest';
import { postgresOptions } from '../../src/db/client';

/**
 * The one setting here that matters is whether production negotiates TLS.
 *
 * `bin/migrate.mjs` has always passed `ssl: 'require'`; `client.ts` — the connection production
 * actually serves traffic on — passed nothing, and `postgres-js` defaults to no TLS. Against a
 * managed provider that shows up as a refused connection, which is loud. Against a provider
 * configured to permit both, it shows up as nothing at all: credentials and every row in clear,
 * with a working app.
 *
 * These assertions are cheap and the property is not observable anywhere else, because building
 * the pool is a side effect of importing the module.
 */
describe('postgres connection options', () => {
  it('requires TLS in production', () => {
    expect(postgresOptions('production').ssl).toBe('require');
  });

  // Not laziness — the Docker Postgres these run against has no TLS and refuses an encrypted
  // connection, so requiring it here would fail every DB-backed test in the suite rather than
  // this one assertion.
  it.each(['development', 'test'] as const)('does not require TLS in %s', (nodeEnv) => {
    expect(postgresOptions(nodeEnv).ssl).toBe(false);
  });

  it('leaves the pool settings alone', () => {
    const opts = postgresOptions('production');
    expect(opts.max).toBe(10);
    expect(opts.idle_timeout).toBe(20);
    expect(opts.connect_timeout).toBe(10);
  });
});
