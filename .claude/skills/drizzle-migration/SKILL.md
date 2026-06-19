---
name: drizzle-migration
description: Generate and apply a Drizzle ORM migration for the Amana backend. Handles the full workflow - generate SQL, show it for review, then apply. Run from the repo root (amana/).
---

## When to use

Use whenever you've changed a file in `apps/backend/src/db/schema/` and need to produce and apply the corresponding migration.

## Pre-flight checks

Before generating, verify:
1. Docker is running: `docker info > /dev/null 2>&1` — if it fails, tell the user to start Docker Desktop
2. Postgres is reachable: `pg_isready -h localhost -p 5432` — if it fails, run `docker compose up -d` and wait ~5 seconds

## Step 1 — Get the migration name

If the user didn't provide a name, ask:
> "What should the migration be named? Use snake_case (e.g. `add_transaction_error_message`, `add_vendor_category_lock`)."

## Step 2 — Generate the migration

Run from the repo root:

```bash
pnpm --filter @amana/backend exec drizzle-kit generate --name={{migration_name}}
```

- Output lands in `apps/backend/src/db/migrations/`
- Drizzle names the file `NNNN_{{migration_name}}.sql` (e.g. `0017_add_vendor_category_lock.sql`)
- `strict: true` is set in drizzle.config.ts — if Drizzle detects a potentially destructive operation (DROP COLUMN, etc.) it will error. Show the user the error and ask them to confirm they intend the data-loss change before proceeding.

## Step 3 — Show the generated SQL

Read the new `.sql` file and show it to the user. Wait for confirmation before applying.

Example prompt:
> "Generated `0017_add_vendor_category_lock.sql`. Here's the SQL — does it look right?"

## Step 4 — Apply the migration

Once confirmed, run:

```bash
pnpm --filter @amana/backend run db:migrate
```

The `db:migrate` script runs `drizzle-kit migrate` which uses the DATABASE_URL from the environment, falling back to `postgres://amana:amana_dev_only@localhost:5432/amana_dev` if unset (safe for local dev).

## Step 5 — Confirm success

Check the command output for `[✓] ... migrations applied` (or equivalent). If it fails:
- `relation already exists` → migration was already applied; tell the user
- `column X does not exist` → schema/migration mismatch; show the error and offer to investigate
- Connection refused → Postgres isn't running; run `docker compose up -d`

## Important notes

- Never run `drizzle-kit push` — it bypasses the migration file history and is not used in this project
- Never delete or edit existing migration files — they are the source of truth for schema history
- Migrations run in numeric order; if the user is on a branch, remind them to pull and re-migrate after merging to avoid conflicts
