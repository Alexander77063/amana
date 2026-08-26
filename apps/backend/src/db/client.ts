import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';

/**
 * Connection options for the app's Postgres pool.
 *
 * Exported as a function so the TLS decision is assertable. Creating the pool is a side effect of
 * importing this module, so without this seam the one setting that determines whether production
 * credentials cross the network in clear could not be tested at all.
 *
 * **Why TLS is conditional.** Managed Postgres refuses an unencrypted connection; the Docker
 * Postgres in `docker-compose.yml` has no TLS and refuses an encrypted one. This module is the
 * connection used by production, by local dev AND by every backend test — hardcoding `'require'`
 * takes the whole suite down, hardcoding `false` sends production credentials in clear.
 *
 * **Why not read `sslmode=` from the URL.** `postgres-js` does parse it, but then whether
 * production traffic is encrypted depends on a query string inside a secret that can be edited
 * without review — and it fails *open* and silently, because a URL missing the parameter connects
 * happily to a server that permits both. Deriving it from `NODE_ENV` puts the guarantee in code,
 * and leaves `sslmode=require` in the URL as belt-and-braces rather than the mechanism.
 *
 * **Why `'require'` and not `'verify-full'`.** This encrypts but does not verify the server
 * certificate against a CA. It matches `bin/migrate.mjs`, which has always used `'require'`.
 * Moving to `verify-full` means shipping the provider's CA bundle — a deliberate change, not a
 * default to drift into.
 */
export function postgresOptions(nodeEnv: typeof env.NODE_ENV = env.NODE_ENV) {
  return {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: nodeEnv === 'production' ? ('require' as const) : (false as const),
  };
}

const queryClient = postgres(env.DATABASE_URL, postgresOptions());

export const db = drizzle(queryClient);

export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
