import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: 'src/db/migrations' });
  await sql.end();
  process.exit(0);
} catch (err) {
  console.error('Migration failed:', err.message);
  await sql.end().catch((e) => console.error('Connection close failed:', e.message));
  process.exit(1);
}
