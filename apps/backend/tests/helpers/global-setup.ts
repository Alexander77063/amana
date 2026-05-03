import { closeTestDb, testDb } from './test-db';
import { sql } from 'drizzle-orm';

export async function setup(): Promise<void> {
  // Verify the test DB is reachable. Migrations are applied separately via `db:migrate`
  // before the test run (see CI + the local-dev runbook).
  await testDb.execute(sql`SELECT 1`);
}

export async function teardown(): Promise<void> {
  await closeTestDb();
}
