import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://amana:amana_dev_only@localhost:5432/amana_dev';

const queryClient = postgres(TEST_DATABASE_URL, {
  max: 5,
  idle_timeout: 10,
  connect_timeout: 10,
});

export const testDb: PostgresJsDatabase = drizzle(queryClient);

const TABLES_TO_TRUNCATE = [
  'postings',
  'transactions',
  'one_shot_tokens',
  'bump_requests',
  'rules',
  'rule_sets',
  'sub_wallets',
  'ledger_accounts',
  'master_wallets',
  'household_members',
  'households',
  'users',
  'idempotency_keys',
  'audit_log',
  'vendor_stickers',
] as const;

export async function truncateAll(): Promise<void> {
  // Some tables may not exist yet during early tasks — IF EXISTS guard.
  const existing = await queryClient<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY(${TABLES_TO_TRUNCATE as unknown as string[]})
  `;
  if (existing.length === 0) return;
  const names = existing.map((r) => `"${r.tablename}"`).join(', ');
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));
}

export async function closeTestDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
