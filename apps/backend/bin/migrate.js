import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
const db = drizzle(sql);
await migrate(db, { migrationsFolder: 'src/db/migrations' });
await sql.end();
