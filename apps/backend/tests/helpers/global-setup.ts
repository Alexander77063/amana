import { closeTestDb, testDb } from './test-db';
import { sql } from 'drizzle-orm';

export async function setup(): Promise<void> {
  try {
    // Verify the test DB is reachable. Migrations are applied separately via `db:migrate`
    // before the test run (see CI + the local-dev runbook).
    await testDb.execute(sql`SELECT 1`);
  } catch (error) {
    // Allow tests that don't need the database (e.g., pure unit tests) to proceed.
    // Tests requiring DB access will fail explicitly when they try to use it.
    console.warn('Note: Test database not available. Skipping DB-dependent tests.');
  }
}

export async function teardown(): Promise<void> {
  try {
    await closeTestDb();
  } catch {
    // Ignore errors during teardown if DB was never connected
  }
}
