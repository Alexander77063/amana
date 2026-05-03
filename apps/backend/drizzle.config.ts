import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://amana:amana_dev_only@localhost:5432/amana_dev',
  },
  verbose: true,
  strict: true,
});
