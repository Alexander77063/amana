# 4. Postgres 16 + PostGIS + Drizzle ORM

Date: 2026-05-03
Status: Accepted

## Context

The Amana backend stores a double-entry ledger, append-only audit log,
versioned rule sets, sub-wallets, and (per Decision #16) GPS coordinates for
ad-hoc transactions. We need ACID transactions, append-only enforcement
through DB roles, and a way to write the schema in TypeScript.

## Decision

Postgres 16 with the PostGIS extension. Drizzle ORM for schema-as-code and
type-safe queries. drizzle-kit for migrations. postgres-js as the driver.

## Alternatives considered

- **Prisma.** Mature, but heavier runtime and historically poor performance
  on complex queries; also a separate generated client step. Drizzle is
  closer to raw SQL when we want it.
- **TypeORM.** Older, decorator-based, less TypeScript-idiomatic.
- **Raw SQL via Kysely or pg-typed.** Plausible alternatives if Drizzle ever
  becomes a bottleneck. Drizzle gives us a slightly better type story today.
- **MySQL / MariaDB.** No technical reason to prefer over Postgres for our
  workload.

## Consequences

Schema lives in TypeScript files under `src/db/schema/`. Migrations are SQL
files under `src/db/migrations/` (drizzle-kit generates them from the
schema). We can drop into raw SQL whenever needed via the postgres-js client.
Cost: Drizzle is younger than Prisma; minor APIs may shift.
