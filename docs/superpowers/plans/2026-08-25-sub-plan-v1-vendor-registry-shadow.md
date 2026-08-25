# Sub-plan V1 — Passive Vendor Registry & Category Shadow Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vendor registry passively from settled transactions, derive a category for each registered vendor, and record — without enforcing — what would change if that category drove rule evaluation instead of the app-supplied one.

**Architecture:** Every settled spend writes a `vendor_observations` row keyed by `(bank_code, account_number, household_id)`, scheduled through the existing `runInBackground` seam *after* the settlement transaction commits so a registry fault can never roll back money. An hourly cron promotes accounts seen by ≥5 distinct households into a `vendors` row, derives a category by one-household-one-vote consensus, and prunes stale sub-threshold observations. `lifecycleService.evaluate` resolves the registry category and records it on the transaction, but continues to evaluate rules against the app-supplied category until enforcement is switched on per household.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Postgres 16, `postgres-js`, Zod, node-cron, Vitest + fast-check, Biome.

**Spec:** `docs/superpowers/specs/2026-08-25-vendor-registry-design.md`

## Global Constraints

- All money is `bigint` kobo. This sub-plan moves no money and must introduce no monetary arithmetic.
- Repos and services take the `db` handle (or an open transaction) as their **first argument**, cast `tx as DbOrTx`. Preserve this.
- HTTP routes live in `apps/backend/src/routes/`, never inside module folders. **SP-V1 adds no routes.**
- Biome: single quotes, 2-space indent, 100-column line width.
- Tests run against a **real Postgres**; `docker compose up -d` first, and migrations must be applied to the test DB before running (`global-setup.ts` only checks reachability).
- `truncateAll()` in `beforeEach`. New tables must be added to `TABLES_TO_TRUNCATE`.
- **Raw SQL in tests goes through drizzle's `sql` tag** — `sql\`… WHERE id = ${id}\``, never a template
  string interpolated into `db.execute(… as never)`. The `as never` form defeats drizzle's typing and
  builds the statement by string concatenation; parameters belong in the tag. Import `sql` from
  `drizzle-orm` in any test file that needs it.
- Coverage gate must hold: lines/statements 92, functions 90, branches 80.
- The registry must never be able to block or fail a spend. Every registry read in the money path is wrapped so that failure yields `null` and evaluation proceeds.
- Enforcement default is **off**. No task in this plan may make the registry category drive a rule outcome by default.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/db/schema/vendors.ts` | `vendor_observations` + `vendors` tables and their enums |
| `src/modules/vendors/vendor-observations.repo.ts` | Drizzle/SQL for the observation table only |
| `src/modules/vendors/vendor-observation.service.ts` | Resolves household, records one observation. Best-effort |
| `src/modules/vendors/vendors.repo.ts` | Drizzle/SQL for the `vendors` table only |
| `src/modules/vendors/consensus.ts` | Pure one-household-one-vote category consensus. No DB |
| `src/modules/vendors/vendor-registry.service.ts` | The sweep: promote, categorise, prune |
| `src/modules/vendors/vendor-category-resolver.service.ts` | Account → `{ vendorId, category, categorySource }` |
| `src/cron/jobs/vendor-registry-sweep.job.ts` | Hourly cron entry |
| `docs/runbook/vendor-registry.md` | Operator runbook |

**Modified**

| File | Change |
|---|---|
| `src/env.ts` | Six new registry vars |
| `src/db/schema/index.ts` | Export `./vendors` |
| `src/db/schema/transactions.ts` | `vendor_id`, `resolved_category` |
| `src/db/schema/identity.ts` | `households.vendor_category_enforced` |
| `src/modules/identity/households.repo.ts` | `findByMasterWalletId` |
| `src/modules/transactions/settlement.service.ts` | Post-commit observation write |
| `src/modules/rules/types.ts` | `TxnIntent.vendorId`, `TxnIntent.resolvedCategory` |
| `src/modules/transactions/lifecycle.service.ts` | Resolve registry category, shadow-evaluate, record |
| `src/modules/audit/events.ts` | `vendorCategoryShadow` |
| `src/modules/vendors/index.ts` | Barrel exports |
| `bin/cron.ts` | Register the sweep job |
| `tests/helpers/test-db.ts` | Truncate the two new tables |
| `docs/brainstorm/locked-decisions.md` | Append D-V1…D-V8 |

---

## Task 1: Registry configuration

**Files:**
- Modify: `apps/backend/src/env.ts`
- Test: `apps/backend/tests/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `env.VENDOR_CATEGORY_ENFORCE_DEFAULT: boolean`, `env.VENDOR_REGISTRY_MIN_HOUSEHOLDS: number`, `env.VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS: number`, `env.VENDOR_REGISTRY_CONSENSUS_RATIO: number`, `env.VENDOR_OBSERVATION_RETENTION_DAYS: number`, `env.VENDOR_SENSITIVE_CATEGORIES: string[]` (already lowercased and trimmed).

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/env.test.ts`:

```ts
describe('vendor registry config', () => {
  it('defaults enforcement OFF and supplies registry thresholds', () => {
    const parsed = loadEnv({ ...baseEnv });
    expect(parsed.VENDOR_CATEGORY_ENFORCE_DEFAULT).toBe(false);
    expect(parsed.VENDOR_REGISTRY_MIN_HOUSEHOLDS).toBe(5);
    expect(parsed.VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS).toBe(8);
    expect(parsed.VENDOR_REGISTRY_CONSENSUS_RATIO).toBe(0.6);
    expect(parsed.VENDOR_OBSERVATION_RETENTION_DAYS).toBe(180);
  });

  it('only the exact string "true" enables enforcement', () => {
    expect(loadEnv({ ...baseEnv, VENDOR_CATEGORY_ENFORCE_DEFAULT: 'true' })
      .VENDOR_CATEGORY_ENFORCE_DEFAULT).toBe(true);
    for (const v of ['false', '1', 'yes', 'TRUE', '']) {
      expect(loadEnv({ ...baseEnv, VENDOR_CATEGORY_ENFORCE_DEFAULT: v })
        .VENDOR_CATEGORY_ENFORCE_DEFAULT).toBe(false);
    }
  });

  it('parses sensitive categories to a trimmed lowercase list', () => {
    const parsed = loadEnv({ ...baseEnv, VENDOR_SENSITIVE_CATEGORIES: ' Pharmacy , CLINIC ,, alcohol ' });
    expect(parsed.VENDOR_SENSITIVE_CATEGORIES).toEqual(['pharmacy', 'clinic', 'alcohol']);
  });

  it('ships a non-empty sensitive default that includes pharmacy', () => {
    expect(loadEnv({ ...baseEnv }).VENDOR_SENSITIVE_CATEGORIES).toContain('pharmacy');
  });
});
```

> If `tests/env.test.ts` does not already expose `loadEnv` and a `baseEnv` fixture, read the top of that file and reuse whatever construction the existing tests use — do not invent a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/env.test.ts -t "vendor registry config"`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 3: Write minimal implementation**

In `apps/backend/src/env.ts`, inside the Zod object, after the `RATE_LIMIT_*` block:

```ts
  // Vendor registry (SP-V1). Enforcement is OFF unless explicitly enabled — the registry ships
  // as a measurement instrument and only becomes a control once shadow data justifies it.
  // Note the inverted transform vs RATE_LIMIT_ENABLED: that one defaults ON (`v !== 'false'`),
  // this one defaults OFF, so only the exact string 'true' switches it on.
  VENDOR_CATEGORY_ENFORCE_DEFAULT: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  VENDOR_REGISTRY_MIN_HOUSEHOLDS: z.coerce.number().int().positive().default(5),
  // Deliberately above MIN_HOUSEHOLDS: being listed is a weaker claim than being categorised,
  // so a vendor is always promoted before it can be categorised (never in the same sweep).
  VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS: z.coerce.number().int().positive().default(8),
  VENDOR_REGISTRY_CONSENSUS_RATIO: z.coerce.number().positive().max(1).default(0.6),
  VENDOR_OBSERVATION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  // Categories that may never be DERIVED from observation — only claimed or ops-set. Knowing a
  // vendor is a clinic supports a health inference about every household that pays it.
  VENDOR_SENSITIVE_CATEGORIES: z
    .string()
    .default('pharmacy,clinic,health,alcohol,gambling,religious,legal')
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/env.test.ts -t "vendor registry config"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/tests/env.test.ts
git commit -m "feat(vendors): registry configuration, enforcement defaulting off"
```

---

## Task 2: Schema and migration

**Files:**
- Create: `apps/backend/src/db/schema/vendors.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Modify: `apps/backend/src/db/schema/transactions.ts`
- Modify: `apps/backend/src/db/schema/identity.ts:36-42` (the `households` table)
- Modify: `apps/backend/tests/helpers/test-db.ts` (`TABLES_TO_TRUNCATE`)
- Test: `apps/backend/tests/db/vendors-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `vendorObservations`, `vendors`, `vendorStatusEnum`, `vendorCategorySourceEnum` from `src/db/schema`; `transactions.vendorId`, `transactions.resolvedCategory`, `households.vendorCategoryEnforced`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/db/vendors-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorObservations, vendors } from '../../src/db/schema';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';
import { makeHousehold } from '../helpers/fixtures';

describe('vendor registry schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stores an observation keyed by (bank, account, household)', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await testDb.insert(vendorObservations).values({
      bankCode,
      accountNumber,
      householdId,
      accountName: 'MAMA PUT KITCHEN',
    });

    const rows = await testDb.select().from(vendorObservations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settledCount).toBe(1);
    expect(rows[0]?.categoryCounts).toEqual({});
  });

  it('rejects a second vendors row for the same bank account', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const row = {
      bankCode,
      accountNumber,
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 5,
    };
    await testDb.insert(vendors).values(row);
    await expect(testDb.insert(vendors).values(row)).rejects.toThrow();
  });

  it('defaults a new vendor to observed status and observed category source', async () => {
    await testDb.insert(vendors).values({
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'SHOPRITE IKEJA',
      promotedHouseholdCount: 7,
    });
    const [row] = await testDb.select().from(vendors);
    expect(row?.status).toBe('observed');
    expect(row?.categorySource).toBe('observed');
    expect(row?.category).toBeNull();
    expect(row?.publicCode).toBeNull();
  });

  it('households.vendor_category_enforced defaults to NULL (inherit global)', async () => {
    const { householdId } = await makeHousehold(testDb);
    const rows = await testDb.execute<{ vendor_category_enforced: boolean | null }>(
      sql`SELECT vendor_category_enforced FROM households WHERE id = ${householdId}`,
    );
    expect(rows[0]?.vendor_category_enforced).toBeNull();
  });
});
```

> `makeHousehold` — check `tests/helpers/` for an existing household fixture and use it. If none exists, create the minimum inline (a `users` row with `role: 'principal'` then a `households` row) rather than adding a new shared helper in this task.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/db/vendors-schema.test.ts`
Expected: FAIL — `vendorObservations` is not exported from `src/db/schema`.

- [ ] **Step 3: Write the schema**

Create `apps/backend/src/db/schema/vendors.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { households } from './identity';

export const vendorStatusEnum = pgEnum('vendor_status', ['observed', 'claimed', 'suspended']);
export const vendorCategorySourceEnum = pgEnum('vendor_category_source', [
  'observed',
  'claimed',
  'ops',
]);

/**
 * Raw material for the registry. One row per (bank account, household) — never per sub-wallet,
 * and never per payment.
 *
 * `vendor_recents` cannot serve this purpose: `recentsService.touch` trims to the ten most recent
 * per sub-wallet on every write, so that table destroys its own history by design.
 *
 * This table is exposed by NO route. It is a payment graph over Nigerian bank accounts and is the
 * sensitive part of the design — the promotion threshold and the retention sweep are what keep it
 * from becoming a directory of private individuals.
 */
export const vendorObservations = pgTable(
  'vendor_observations',
  {
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    // household_id sits in the PRIMARY KEY so that COUNT(*) grouped by (bank_code, account_number)
    // IS the distinct-household count. No DISTINCT, no join to wallets at promotion time.
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // Last NIBSS-authoritative name seen from this household. Not trusted for display on its own;
    // the promotion pass picks the most recently seen name across all households.
    accountName: text('account_name').notNull(),
    settledCount: integer('settled_count').notNull().default(1),
    // { "<category>": <count> } as tagged by THIS household's payers — self-attested, and known
    // to be so. Consensus collapses this to a single vote per household; these counts must never
    // be summed across households or one frequent customer outvotes everyone else.
    categoryCounts: jsonb('category_counts')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, number>>(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bankCode, t.accountNumber, t.householdId] }),
    // The retention sweep scans by age; promotion scans by account via the PK's leading columns.
    lastSeenIdx: index('vendor_observations_last_seen_idx').on(t.lastSeenAt),
  }),
);

/**
 * The registry proper. A row exists only once the account has been paid by at least
 * VENDOR_REGISTRY_MIN_HOUSEHOLDS distinct households — that threshold IS the operational
 * definition of "public-facing merchant", so no vendor ever has to self-declare.
 */
export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    // NIBSS name at promotion. A claimed vendor may later override it with a trading name.
    displayName: text('display_name').notNull(),
    status: vendorStatusEnum('status').notNull().default('observed'),
    // Null until consensus is confident, or until the vendor claims and picks one.
    category: text('category'),
    // Authority marker. Only 'claimed' and 'ops' are ever ENFORCED, and only these two may ever
    // carry a category on the sensitive list.
    categorySource: vendorCategorySourceEnum('category_source').notNull().default('observed'),
    // How many distinct households voted to produce `category`. Null when category is null. Kept
    // because the confidence behind a consensus is not recoverable from the value alone.
    categoryHouseholdCount: integer('category_household_count'),
    // Human-typable display code (AMNV-7QK2H-9PZ0R), minted at claim in SP-V2. Null here because
    // an observed vendor has no code — nobody has proven they own the account.
    // Unique: this column is the lookup key for GET /vendors/code/:code in SP-V3.
    publicCode: text('public_code').unique(),
    claimedByPhone: text('claimed_by_phone'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Distinct-household count at the instant of promotion, for auditing the threshold decision.
    // The live count stays in vendor_observations.
    promotedHouseholdCount: integer('promoted_household_count').notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One registry row per bank account. Promotion is an idempotent upsert against this.
    acct: unique('vendors_bank_account_unique').on(t.bankCode, t.accountNumber),
  }),
);
```

- [ ] **Step 4: Wire the schema barrel and the two additive columns**

In `apps/backend/src/db/schema/index.ts`, append:

```ts
export * from './vendors';
```

In `apps/backend/src/db/schema/transactions.ts`, inside the `transactions` table after `category`:

```ts
  // SP-V1 registry attribution. Null for every pre-existing row and for any vendor not in the
  // registry. No FK to `vendors` here on purpose: a transaction must survive a vendor row being
  // removed, and adding a restrict-FK to the hot spend path buys nothing.
  vendorId: uuid('vendor_id'),
  // What the registry said the category was, recorded whether or not it was enforced. This column
  // IS the shadow record — it is how we learn what enforcement would have changed.
  resolvedCategory: text('resolved_category'),
```

In `apps/backend/src/db/schema/identity.ts`, inside the `households` table after `name`:

```ts
  // Three-state on purpose. TRUE = registry category enforced for this household, FALSE = never,
  // NULL = inherit env.VENDOR_CATEGORY_ENFORCE_DEFAULT. Nullable is what lets the rollout proceed
  // household by household without a backfill touching every row.
  vendorCategoryEnforced: boolean('vendor_category_enforced'),
```

Add `boolean` to the existing `drizzle-orm/pg-core` import in `identity.ts`.

In `apps/backend/tests/helpers/test-db.ts`, add to `TABLES_TO_TRUNCATE` — `vendor_observations` immediately before `'vendor_recents'`, and `'vendors'` immediately after `'transactions'`:

```ts
  'transactions',
  'vendors',
  ...
  'vendor_observations',
  'vendor_recents',
```

- [ ] **Step 5: Generate and apply the migration**

```bash
pnpm --filter @amana/backend exec drizzle-kit generate
```

Read the generated `apps/backend/src/db/migrations/0035_*.sql` before applying. It must contain: two `CREATE TYPE` statements, two `CREATE TABLE` statements, one `CREATE INDEX`, and three `ALTER TABLE ... ADD COLUMN`. It must contain **no** `DROP` and no `ALTER COLUMN ... SET NOT NULL` on an existing table. If it does, stop and reconcile the schema rather than editing the SQL by hand.

```bash
pnpm --filter @amana/backend db:migrate
```

> The `drizzle-migration` skill documents the full workflow if anything here is unclear.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/db/vendors-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db apps/backend/tests
git commit -m "feat(vendors): vendor_observations and vendors tables, additive txn/household columns"
```

---

## Task 3: Observation repository

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-observations.repo.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-observations.repo.test.ts`

**Interfaces:**
- Consumes: `vendorObservations` from Task 2.
- Produces:
  - `vendorObservationsRepo.record(db, { bankCode, accountNumber, householdId, accountName, category, now }): Promise<void>`
  - `vendorObservationsRepo.listForAccount(db, bankCode, accountNumber): Promise<ObservationRow[]>`
  - `vendorObservationsRepo.accountsAtOrAboveThreshold(db, minHouseholds): Promise<{ bankCode: string; accountNumber: string; householdCount: number; accountName: string }[]>`
  - `vendorObservationsRepo.pruneStaleUnpromoted(db, before: Date): Promise<number>`
  - `export type ObservationRow = typeof vendorObservations.$inferSelect`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-observations.repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendors } from '../../../src/db/schema';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import { factories } from '../../helpers/factories';
import { makeHousehold } from '../../helpers/fixtures';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorObservationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('records a first observation with count 1 and a one-entry category tally', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await vendorObservationsRepo.record(testDb, {
      bankCode, accountNumber, householdId,
      accountName: 'MAMA PUT KITCHEN', category: 'food', now: NOW,
    });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settledCount).toBe(1);
    expect(rows[0]?.categoryCounts).toEqual({ food: 1 });
  });

  it('increments the same household rather than inserting a second row', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const base = { bankCode, accountNumber, householdId, accountName: 'MAMA PUT', now: NOW };

    await vendorObservationsRepo.record(testDb, { ...base, category: 'food' });
    await vendorObservationsRepo.record(testDb, { ...base, category: 'food' });
    await vendorObservationsRepo.record(testDb, { ...base, category: 'transport' });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settledCount).toBe(3);
    expect(rows[0]?.categoryCounts).toEqual({ food: 2, transport: 1 });
  });

  it('records a null category without disturbing an existing tally', async () => {
    const { householdId } = await makeHousehold(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const base = { bankCode, accountNumber, householdId, accountName: 'MAMA PUT', now: NOW };

    await vendorObservationsRepo.record(testDb, { ...base, category: 'food' });
    await vendorObservationsRepo.record(testDb, { ...base, category: null });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows[0]?.settledCount).toBe(2);
    expect(rows[0]?.categoryCounts).toEqual({ food: 1 });
  });

  it('counts DISTINCT HOUSEHOLDS, not payments, against the threshold', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    // One household paying twenty times must NOT reach a threshold of 3.
    const solo = await makeHousehold(testDb);
    for (let i = 0; i < 20; i++) {
      await vendorObservationsRepo.record(testDb, {
        bankCode, accountNumber, householdId: solo.householdId,
        accountName: 'MAMA PUT', category: 'food', now: NOW,
      });
    }
    expect(await vendorObservationsRepo.accountsAtOrAboveThreshold(testDb, 3)).toEqual([]);

    // Two more households, one payment each, does.
    for (let i = 0; i < 2; i++) {
      const h = await makeHousehold(testDb);
      await vendorObservationsRepo.record(testDb, {
        bankCode, accountNumber, householdId: h.householdId,
        accountName: 'MAMA PUT KITCHEN', category: 'food', now: NOW,
      });
    }
    const found = await vendorObservationsRepo.accountsAtOrAboveThreshold(testDb, 3);
    expect(found).toHaveLength(1);
    expect(found[0]?.householdCount).toBe(3);
    expect(found[0]?.accountName).toBe('MAMA PUT KITCHEN');
  });

  it('prunes stale observations only for accounts with no vendors row', async () => {
    const stale = new Date('2026-01-01T00:00:00Z');
    const promotedAcct = factories.bankAccount();
    const orphanAcct = factories.bankAccount();
    const bankCode = factories.bankCode();

    const h1 = await makeHousehold(testDb);
    const h2 = await makeHousehold(testDb);
    await vendorObservationsRepo.record(testDb, {
      bankCode, accountNumber: promotedAcct, householdId: h1.householdId,
      accountName: 'SHOP', category: 'food', now: stale,
    });
    await vendorObservationsRepo.record(testDb, {
      bankCode, accountNumber: orphanAcct, householdId: h2.householdId,
      accountName: 'A PERSON', category: null, now: stale,
    });
    await testDb.insert(vendors).values({
      bankCode, accountNumber: promotedAcct, displayName: 'SHOP', promotedHouseholdCount: 5,
    });

    const deleted = await vendorObservationsRepo.pruneStaleUnpromoted(
      testDb, new Date('2026-08-01T00:00:00Z'),
    );
    expect(deleted).toBe(1);
    expect(await vendorObservationsRepo.listForAccount(testDb, bankCode, orphanAcct)).toEqual([]);
    expect(await vendorObservationsRepo.listForAccount(testDb, bankCode, promotedAcct)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-observations.repo.test.ts`
Expected: FAIL — cannot resolve `vendor-observations.repo`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/modules/vendors/vendor-observations.repo.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendorObservations } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type ObservationRow = typeof vendorObservations.$inferSelect;

export type RecordInput = {
  bankCode: string;
  accountNumber: string;
  householdId: string;
  accountName: string;
  category: string | null;
  now: Date;
};

export type ThresholdRow = {
  bankCode: string;
  accountNumber: string;
  householdCount: number;
  accountName: string;
};

export const vendorObservationsRepo = {
  /**
   * Insert-or-increment one household's observation of one account.
   *
   * Raw SQL rather than Drizzle's `onConflictDoUpdate` because the category tally is a jsonb
   * read-modify-write that has to happen inside the UPDATE — doing it in application code would
   * make two concurrent settlements to the same vendor lose one of their increments.
   */
  async record(db: DbOrTx, input: RecordInput): Promise<void> {
    const { bankCode, accountNumber, householdId, accountName, category, now } = input;

    const initialCounts =
      category === null ? sql`'{}'::jsonb` : sql`jsonb_build_object(${category}::text, 1)`;
    const mergedCounts =
      category === null
        ? sql`vendor_observations.category_counts`
        : sql`vendor_observations.category_counts || jsonb_build_object(
              ${category}::text,
              COALESCE((vendor_observations.category_counts ->> ${category}::text)::int, 0) + 1
            )`;

    await db.execute(sql`
      INSERT INTO vendor_observations
        (bank_code, account_number, household_id, account_name,
         settled_count, category_counts, first_seen_at, last_seen_at)
      VALUES
        (${bankCode}, ${accountNumber}, ${householdId}, ${accountName},
         1, ${initialCounts}, ${now}, ${now})
      ON CONFLICT (bank_code, account_number, household_id) DO UPDATE SET
        settled_count   = vendor_observations.settled_count + 1,
        account_name    = EXCLUDED.account_name,
        last_seen_at    = EXCLUDED.last_seen_at,
        category_counts = ${mergedCounts}
    `);
  },

  async listForAccount(
    db: DbOrTx,
    bankCode: string,
    accountNumber: string,
  ): Promise<ObservationRow[]> {
    return db
      .select()
      .from(vendorObservations)
      .where(
        and(
          eq(vendorObservations.bankCode, bankCode),
          eq(vendorObservations.accountNumber, accountNumber),
        ),
      );
  },

  /**
   * Accounts paid by at least `minHouseholds` DISTINCT households.
   *
   * COUNT(*) is the distinct-household count with no DISTINCT keyword because household_id is in
   * the primary key — one row per household, always. `accountName` is the most recently seen name
   * across those households, which is the best NIBSS answer available at promotion time.
   */
  async accountsAtOrAboveThreshold(db: DbOrTx, minHouseholds: number): Promise<ThresholdRow[]> {
    const rows = await db.execute<{
      bank_code: string;
      account_number: string;
      household_count: number;
      account_name: string;
    }>(sql`
      SELECT bank_code,
             account_number,
             COUNT(*)::int AS household_count,
             (array_agg(account_name ORDER BY last_seen_at DESC))[1] AS account_name
      FROM vendor_observations
      GROUP BY bank_code, account_number
      HAVING COUNT(*) >= ${minHouseholds}
    `);
    return rows.map((r) => ({
      bankCode: r.bank_code,
      accountNumber: r.account_number,
      householdCount: r.household_count,
      accountName: r.account_name,
    }));
  },

  /**
   * Forget accounts that never looked like merchants: no activity since `before`, and no vendors
   * row. An account we have already promoted keeps its observations, because those are what the
   * consensus pass re-reads on every sweep.
   */
  async pruneStaleUnpromoted(db: DbOrTx, before: Date): Promise<number> {
    const rows = await db.execute<{ ok: number }>(sql`
      DELETE FROM vendor_observations o
      WHERE o.last_seen_at < ${before}
        AND NOT EXISTS (
          SELECT 1 FROM vendors v
          WHERE v.bank_code = o.bank_code AND v.account_number = o.account_number
        )
      RETURNING 1 AS ok
    `);
    return rows.length;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-observations.repo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/vendors/vendor-observations.repo.ts apps/backend/tests/modules/vendors/vendor-observations.repo.test.ts
git commit -m "feat(vendors): observation repo with per-household jsonb category tally"
```

---

## Task 4: Observation service and household lookup

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-observation.service.ts`
- Modify: `apps/backend/src/modules/identity/households.repo.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-observation.service.test.ts`

**Interfaces:**
- Consumes: `vendorObservationsRepo.record` (Task 3).
- Produces:
  - `householdsRepo.findByMasterWalletId(db, masterWalletId): Promise<{ id: string; vendorCategoryEnforced: boolean | null } | undefined>`
  - `vendorObservationService.recordSettlement(db, { masterWalletId, bankCode, accountNumber, accountName, category, now }): Promise<void>` — resolves the household and records. Never throws.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-observation.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import { vendorObservationService } from '../../../src/modules/vendors/vendor-observation.service';
import { factories } from '../../helpers/factories';
import { makeHouseholdWithWallet } from '../../helpers/fixtures';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorObservationService.recordSettlement', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('resolves the household from the master wallet and records one observation', async () => {
    const { householdId, masterWalletId } = await makeHouseholdWithWallet(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await vendorObservationService.recordSettlement(testDb, {
      masterWalletId, bankCode, accountNumber,
      accountName: 'MAMA PUT KITCHEN', category: 'food', now: NOW,
    });

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.householdId).toBe(householdId);
  });

  it('records nothing when the master wallet is unknown, and does not throw', async () => {
    await expect(
      vendorObservationService.recordSettlement(testDb, {
        masterWalletId: factories.walletId(),
        bankCode: factories.bankCode(),
        accountNumber: factories.bankAccount(),
        accountName: 'GHOST', category: 'food', now: NOW,
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows a repo failure — the registry must never surface an error to settlement', async () => {
    const { masterWalletId } = await makeHouseholdWithWallet(testDb);
    const spy = vi
      .spyOn(vendorObservationsRepo, 'record')
      .mockRejectedValue(new Error('registry exploded'));

    await expect(
      vendorObservationService.recordSettlement(testDb, {
        masterWalletId,
        bankCode: factories.bankCode(),
        accountNumber: factories.bankAccount(),
        accountName: 'MAMA PUT', category: 'food', now: NOW,
      }),
    ).resolves.toBeUndefined();

    spy.mockRestore();
  });
});
```

> `makeHouseholdWithWallet` — reuse the existing fixture that builds a principal + household + master wallet if one exists in `tests/helpers/`; the wallet and transaction tests almost certainly already construct this. Only add it to `tests/helpers/fixtures.ts` if there is genuinely no equivalent.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-observation.service.test.ts`
Expected: FAIL — cannot resolve `vendor-observation.service`.

- [ ] **Step 3: Add the household lookup**

Append to `apps/backend/src/modules/identity/households.repo.ts`, inside the exported `householdsRepo` object:

```ts
  /**
   * The household that owns a master wallet, with its registry-enforcement flag.
   *
   * One join rather than two round trips because both the settlement observation write and the
   * rule-evaluation enforcement check need exactly this pair, on paths that already do plenty.
   */
  async findByMasterWalletId(
    db: DbOrTx,
    masterWalletId: string,
  ): Promise<{ id: string; vendorCategoryEnforced: boolean | null } | undefined> {
    const rows = await db.execute<{ id: string; vendor_category_enforced: boolean | null }>(sql`
      SELECT h.id, h.vendor_category_enforced
      FROM master_wallets mw
      INNER JOIN households h ON h.id = mw.household_id
      WHERE mw.id = ${masterWalletId}
      LIMIT 1
    `);
    const row = rows[0];
    return row ? { id: row.id, vendorCategoryEnforced: row.vendor_category_enforced } : undefined;
  },
```

Ensure `sql` is imported from `drizzle-orm` in that file.

- [ ] **Step 4: Write the service**

Create `apps/backend/src/modules/vendors/vendor-observation.service.ts`:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { householdsRepo } from '../identity/households.repo';
import { vendorObservationsRepo } from './vendor-observations.repo';

type DbOrTx = PostgresJsDatabase;

export type RecordSettlementInput = {
  masterWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  category: string | null;
  now: Date;
};

export const vendorObservationService = {
  /**
   * Record one settled payment against the registry's observation table.
   *
   * **This function never throws.** It is called after a settlement has already committed, and a
   * registry fault must not turn a successful payment into an error anywhere upstream. A dropped
   * observation is statistically harmless; the promotion threshold is measured in households, and
   * a household that pays a vendor once will almost certainly pay it again.
   */
  async recordSettlement(db: DbOrTx, input: RecordSettlementInput): Promise<void> {
    try {
      const household = await householdsRepo.findByMasterWalletId(db, input.masterWalletId);
      if (!household) {
        logger.warn(
          { masterWalletId: input.masterWalletId },
          'vendor observation skipped: no household for master wallet',
        );
        return;
      }
      await vendorObservationsRepo.record(db, {
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        householdId: household.id,
        accountName: input.accountName,
        category: input.category,
        now: input.now,
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'vendor observation write failed');
    }
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-observation.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/vendors/vendor-observation.service.ts apps/backend/src/modules/identity/households.repo.ts apps/backend/tests/modules/vendors/vendor-observation.service.test.ts
git commit -m "feat(vendors): observation service, never throws into the settlement path"
```

---

## Task 5: Wire the observation into settlement, after commit

**Files:**
- Modify: `apps/backend/src/modules/transactions/settlement.service.ts`
- Test: `apps/backend/tests/modules/transactions/settlement.service.test.ts` (append)

**Interfaces:**
- Consumes: `vendorObservationService.recordSettlement` (Task 4), `runInBackground` from `src/lib/background`.
- Produces: no new exports. `settlementService.finalise` keeps its `Promise<void>` signature.

**Why this shape:** `finalise` currently wraps everything in `db.transaction`. The observation write must happen **after that transaction commits**, not inside it. A caught error inside a Postgres transaction can still have aborted it — every subsequent statement then fails and the COMMIT silently becomes a ROLLBACK. Putting a best-effort registry write inside the money transaction risks exactly that. `runInBackground` is the existing seam for detached best-effort work (`bump-workflow.service.ts:81`, `lifecycle.service.ts:176`), and `truncateAll()` already drains it, so tests stay deterministic without any new harness.

**The handle the background task uses is NOT `finalise`'s `db` parameter.** This was verified, not assumed: `routes/webhooks.ts:102` calls `settlementService.finalise(tx, …)` with an open transaction handle, while `reconciliation.service.ts:54` passes the pool. A detached task holding that `tx` would run against a handle whose transaction has already committed and closed — precisely the thing the post-commit placement exists to avoid, reintroduced one line later. Step 4 therefore imports the module-level pool and hands the background task *that*.

This is the one place in the sub-plan that deliberately departs from the repo's dependency-injection convention, and the departure is the point: every other call in `finalise` must join the caller's transaction, and this one must not.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/modules/transactions/settlement.service.test.ts`:

```ts
describe('settlement → vendor registry observation', () => {
  it('records exactly one observation after the settle commits', async () => {
    const { masterWalletId, subWalletId, householdId } = await makeFundedSubWallet(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const txn = await makeInFlightSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber,
      vendorResolvedName: 'MAMA PUT KITCHEN', category: 'food',
    });

    await settlementService.finalise(testDb, {
      transactionId: txn.id,
      nibssSessionId: factories.nibssSessionId(),
      settledAt: new Date('2026-08-25T10:00:00Z'),
    });
    await drainBackgroundTasks();

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.householdId).toBe(householdId);
    expect(rows[0]?.settledCount).toBe(1);
    expect(rows[0]?.categoryCounts).toEqual({ food: 1 });
  });

  it('does not double-observe when the webhook fires twice', async () => {
    const { masterWalletId, subWalletId } = await makeFundedSubWallet(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const txn = await makeInFlightSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber,
      vendorResolvedName: 'MAMA PUT', category: 'food',
    });
    const input = {
      transactionId: txn.id,
      nibssSessionId: factories.nibssSessionId(),
      settledAt: new Date('2026-08-25T10:00:00Z'),
    };

    await settlementService.finalise(testDb, input);
    await settlementService.finalise(testDb, input); // idempotent replay
    await drainBackgroundTasks();

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows[0]?.settledCount).toBe(1);
  });

  it('settles successfully even when the observation write throws', async () => {
    const { masterWalletId, subWalletId } = await makeFundedSubWallet(testDb);
    const txn = await makeInFlightSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: factories.bankCode(), vendorAccount: factories.bankAccount(),
      vendorResolvedName: 'MAMA PUT', category: 'food',
    });
    const spy = vi
      .spyOn(vendorObservationService, 'recordSettlement')
      .mockRejectedValue(new Error('boom'));

    await settlementService.finalise(testDb, {
      transactionId: txn.id, nibssSessionId: null, settledAt: new Date(),
    });
    await drainBackgroundTasks();

    const settled = await transactionsRepo.findById(testDb, txn.id);
    expect(settled?.status).toBe('settled');
    spy.mockRestore();
  });

  it('records no observation for a transaction with no vendor account', async () => {
    const { masterWalletId, subWalletId } = await makeFundedSubWallet(testDb);
    const txn = await makeInFlightSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: null, vendorAccount: null, vendorResolvedName: null, category: null,
    });

    await settlementService.finalise(testDb, {
      transactionId: txn.id, nibssSessionId: null, settledAt: new Date(),
    });
    await drainBackgroundTasks();

    const all = await testDb.select().from(vendorObservations);
    expect(all).toEqual([]);
  });
});
```

> Reuse whatever fixtures this test file already has for a funded sub-wallet and an in-flight spend; the names above (`makeFundedSubWallet`, `makeInFlightSpend`) stand in for them. Read the top of the file first and match what is there.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/settlement.service.test.ts -t "vendor registry observation"`
Expected: FAIL — the first test finds zero observation rows.

- [ ] **Step 3: Restructure finalise to return an observation intent**

In `apps/backend/src/modules/transactions/settlement.service.ts`, add the imports:

```ts
import { runInBackground } from '../../lib/background';
// The connection POOL, not the caller's handle. `finalise` is called with an open transaction by
// routes/webhooks.ts:102, and a task that outlives the commit cannot use that transaction.
import { db as pool } from '../../db/client';
import { vendorObservationService } from '../vendors/vendor-observation.service';
```

Add the type above `settlementService`:

```ts
/**
 * What the committed settlement wants the registry to record. Null when the settle was a no-op
 * replay, or when the spend had no vendor account to observe.
 */
type ObservationIntent = {
  masterWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  category: string | null;
};
```

Change the signature of the transaction callback so it returns `ObservationIntent | null`:

- Change `return db.transaction(async (tx) => {` to `const observation = await db.transaction(async (tx): Promise<ObservationIntent | null> => {`
- Change the idempotent guard `if (txn.status === 'settled') return;` to `if (txn.status === 'settled') return null;` — this is what stops a replayed webhook double-counting.
- At the very end of the transaction callback, after the notification `try/catch` block, add:

```ts
      // The registry write itself happens AFTER this transaction commits (see below).
      return txn.vendorBankCode && txn.vendorAccount
        ? {
            masterWalletId: txn.masterWalletId,
            bankCode: txn.vendorBankCode,
            accountNumber: txn.vendorAccount,
            accountName: txn.vendorResolvedName ?? 'Unknown',
            category: txn.category,
          }
        : null;
```

- [ ] **Step 4: Schedule the write after the commit**

Immediately after the closing `});` of the `db.transaction(...)` call, and before `finalise` returns, add:

```ts
    // Deliberately AFTER the commit and detached. The registry is a best-effort observer of money
    // that has already moved: a fault here must not be able to roll back a settled payment. Note
    // that a try/catch INSIDE the transaction would not be safe — a Postgres error aborts the
    // whole transaction even when the JS error is caught, turning the COMMIT into a ROLLBACK.
    //
    // `pool`, NOT the `db` parameter: webhooks.ts calls finalise(tx, …), and by the time this task
    // runs that transaction has committed and closed. This is the one call in the file that must
    // not join the caller's transaction — which is exactly why it does not take the injected handle.
    if (observation) {
      runInBackground(
        vendorObservationService
          .recordSettlement(pool, { ...observation, now: input.settledAt })
          .catch((e: unknown) => {
            logger.warn({ err: (e as Error).message }, 'vendor observation task failed');
          }),
      );
    }
```

`logger` is already imported in this file.

**Add a regression test for the handle**, because this is the failure that would otherwise only appear in production under the webhook path:

```ts
  it('observes a settlement driven through an OPEN transaction, as the webhook does', async () => {
    const { masterWalletId, subWalletId, householdId } = await makeFundedSubWallet(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const txn = await makeInFlightSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber,
      vendorResolvedName: 'MAMA PUT KITCHEN', category: 'food',
    });

    // Mirrors routes/webhooks.ts:102 — finalise runs INSIDE the caller's transaction.
    await testDb.transaction(async (tx) => {
      await settlementService.finalise(tx as typeof testDb, {
        transactionId: txn.id,
        nibssSessionId: factories.nibssSessionId(),
        settledAt: new Date('2026-08-25T10:00:00Z'),
      });
    });
    await drainBackgroundTasks();

    const rows = await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.householdId).toBe(householdId);
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/settlement.service.test.ts`
Expected: PASS — the four new tests plus every pre-existing settlement test.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/transactions/settlement.service.ts apps/backend/tests/modules/transactions/settlement.service.test.ts
git commit -m "feat(vendors): observe settled spends after commit via runInBackground"
```

---

## Task 6: Vendors repository

**Files:**
- Create: `apps/backend/src/modules/vendors/vendors.repo.ts`
- Test: `apps/backend/tests/modules/vendors/vendors.repo.test.ts`

**Interfaces:**
- Consumes: `vendors` table (Task 2).
- Produces:
  - `export type VendorRow = typeof vendors.$inferSelect`
  - `vendorsRepo.findByAccount(db, bankCode, accountNumber): Promise<VendorRow | undefined>`
  - `vendorsRepo.promoteIfAbsent(db, { bankCode, accountNumber, displayName, promotedHouseholdCount, now }): Promise<VendorRow | null>` — null when a row already existed
  - `vendorsRepo.listByCategorySource(db, source: 'observed' | 'claimed' | 'ops'): Promise<VendorRow[]>`
  - `vendorsRepo.setObservedCategory(db, vendorId, category: string | null, householdCount: number | null): Promise<boolean>` — compare-and-set; false when the row was not `observed`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendors.repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('promotes an account once and reports the second attempt as a no-op', async () => {
    const input = {
      bankCode: factories.bankCode(),
      accountNumber: factories.bankAccount(),
      displayName: 'MAMA PUT KITCHEN',
      promotedHouseholdCount: 5,
      now: NOW,
    };

    const first = await vendorsRepo.promoteIfAbsent(testDb, input);
    expect(first?.status).toBe('observed');
    expect(first?.promotedHouseholdCount).toBe(5);

    const second = await vendorsRepo.promoteIfAbsent(testDb, { ...input, promotedHouseholdCount: 9 });
    expect(second).toBeNull();

    const found = await vendorsRepo.findByAccount(testDb, input.bankCode, input.accountNumber);
    expect(found?.promotedHouseholdCount).toBe(5); // the first promotion stands
  });

  it('sets an observed category with its supporting household count', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
      displayName: 'SHOP', promotedHouseholdCount: 8, now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    expect(await vendorsRepo.setObservedCategory(testDb, v.id, 'food', 9)).toBe(true);
    const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(after?.category).toBe('food');
    expect(after?.categoryHouseholdCount).toBe(9);
    expect(after?.categorySource).toBe('observed');
  });

  it('refuses to overwrite a claimed category', async () => {
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
      displayName: 'SHOP', promotedHouseholdCount: 8, now: NOW,
    });
    if (!v) throw new Error('promotion failed');

    // Simulate SP-V2 having claimed this vendor.
    await testDb.execute(
      sql`UPDATE vendors SET category = 'pharmacy', category_source = 'claimed' WHERE id = ${v.id}`,
    );

    expect(await vendorsRepo.setObservedCategory(testDb, v.id, 'food', 20)).toBe(false);
    const after = await vendorsRepo.findByAccount(testDb, v.bankCode, v.accountNumber);
    expect(after?.category).toBe('pharmacy');
    expect(after?.categorySource).toBe('claimed');
  });

  it('lists only vendors whose category source matches', async () => {
    const a = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
      displayName: 'A', promotedHouseholdCount: 5, now: NOW,
    });
    if (!a) throw new Error('promotion failed');
    const b = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode: factories.bankCode(), accountNumber: factories.bankAccount(),
      displayName: 'B', promotedHouseholdCount: 5, now: NOW,
    });
    if (!b) throw new Error('promotion failed');
    await testDb.execute(
      sql`UPDATE vendors SET category_source = 'claimed' WHERE id = ${b.id}`,
    );

    const observed = await vendorsRepo.listByCategorySource(testDb, 'observed');
    expect(observed.map((v) => v.id)).toEqual([a.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendors.repo.test.ts`
Expected: FAIL — cannot resolve `vendors.repo`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/modules/vendors/vendors.repo.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vendors } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type VendorRow = typeof vendors.$inferSelect;
export type VendorCategorySource = VendorRow['categorySource'];

export type PromoteInput = {
  bankCode: string;
  accountNumber: string;
  displayName: string;
  promotedHouseholdCount: number;
  now: Date;
};

export const vendorsRepo = {
  async findByAccount(
    db: DbOrTx,
    bankCode: string,
    accountNumber: string,
  ): Promise<VendorRow | undefined> {
    const [row] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.bankCode, bankCode), eq(vendors.accountNumber, accountNumber)))
      .limit(1);
    return row;
  },

  /**
   * Promote an account into the registry, or do nothing if it is already there.
   *
   * `onConflictDoNothing` against the (bank_code, account_number) unique makes the whole promotion
   * sweep idempotent and safe to run concurrently — re-running it promotes nothing new, and the
   * ORIGINAL promotion's household count is preserved rather than being rewritten every hour.
   * Returns null when the row already existed, so the caller can count real promotions.
   */
  async promoteIfAbsent(db: DbOrTx, input: PromoteInput): Promise<VendorRow | null> {
    const [row] = await db
      .insert(vendors)
      .values({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        displayName: input.displayName,
        promotedHouseholdCount: input.promotedHouseholdCount,
        promotedAt: input.now,
      })
      .onConflictDoNothing({ target: [vendors.bankCode, vendors.accountNumber] })
      .returning();
    return row ?? null;
  },

  async listByCategorySource(
    db: DbOrTx,
    source: VendorCategorySource,
  ): Promise<VendorRow[]> {
    return db.select().from(vendors).where(eq(vendors.categorySource, source));
  },

  /**
   * Write a consensus-derived category.
   *
   * The `category_source = 'observed'` predicate is a compare-and-set, not a courtesy: a claim
   * landing between the consensus computation and this write must win, and it does because the
   * UPDATE simply matches nothing. Returns whether a row was actually changed.
   */
  async setObservedCategory(
    db: DbOrTx,
    vendorId: string,
    category: string | null,
    householdCount: number | null,
  ): Promise<boolean> {
    const changed = await db
      .update(vendors)
      .set({ category, categoryHouseholdCount: householdCount })
      .where(and(eq(vendors.id, vendorId), eq(vendors.categorySource, 'observed')))
      .returning({ id: vendors.id });
    return changed.length > 0;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendors.repo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/vendors/vendors.repo.ts apps/backend/tests/modules/vendors/vendors.repo.test.ts
git commit -m "feat(vendors): vendors repo with idempotent promotion and CAS category write"
```

---

## Task 7: Consensus — one household, one vote

**Files:**
- Create: `apps/backend/src/modules/vendors/consensus.ts`
- Test: `apps/backend/tests/modules/vendors/consensus.test.ts`

**Interfaces:**
- Consumes: nothing. Pure module, no DB, no env import — config is passed in.
- Produces:
  - `export type HouseholdCategoryCounts = Record<string, number>`
  - `export type ConsensusConfig = { minHouseholds: number; ratio: number; sensitiveCategories: readonly string[] }`
  - `export type ConsensusResult = { category: string | null; householdCount: number }`
  - `export function computeConsensus(perHousehold: HouseholdCategoryCounts[], cfg: ConsensusConfig): ConsensusResult`

**This is the task the whole privacy argument rests on.** Summing category counts across households would let one frequent customer set a vendor's category alone — the homogeneity failure that l-diversity exists to prevent. Each household gets exactly one vote regardless of how many times it paid.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/consensus.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ConsensusConfig,
  type HouseholdCategoryCounts,
  computeConsensus,
} from '../../../src/modules/vendors/consensus';

const CFG: ConsensusConfig = {
  minHouseholds: 3,
  ratio: 0.6,
  sensitiveCategories: ['pharmacy', 'clinic'],
};

describe('computeConsensus', () => {
  it('returns null below the household floor', () => {
    const votes: HouseholdCategoryCounts[] = [{ food: 1 }, { food: 1 }];
    expect(computeConsensus(votes, CFG)).toEqual({ category: null, householdCount: 2 });
  });

  it('elects a unanimous category at the floor', () => {
    const votes: HouseholdCategoryCounts[] = [{ food: 1 }, { food: 1 }, { food: 1 }];
    expect(computeConsensus(votes, CFG)).toEqual({ category: 'food', householdCount: 3 });
  });

  it('ONE HOUSEHOLD, ONE VOTE — a frequent customer cannot outvote the others', () => {
    // 50 payments from one household vs one payment each from three others.
    const votes: HouseholdCategoryCounts[] = [
      { food: 50 },
      { transport: 1 },
      { transport: 1 },
      { transport: 1 },
    ];
    expect(computeConsensus(votes, CFG).category).toBe('transport');
  });

  it('uses each household modal category as its single vote', () => {
    const votes: HouseholdCategoryCounts[] = [
      { food: 9, transport: 1 }, // votes food
      { food: 1, transport: 9 }, // votes transport
      { transport: 4 },          // votes transport
      { transport: 2 },          // votes transport
    ];
    expect(computeConsensus(votes, CFG).category).toBe('transport');
  });

  it('returns null when no category clears the ratio', () => {
    const votes: HouseholdCategoryCounts[] = [
      { food: 1 }, { transport: 1 }, { airtime: 1 }, { school: 1 },
    ];
    expect(computeConsensus(votes, CFG)).toEqual({ category: null, householdCount: 4 });
  });

  it('applies the ratio at its exact boundary', () => {
    // 3 of 5 = 0.6, which clears a 0.6 threshold.
    const at = [{ food: 1 }, { food: 1 }, { food: 1 }, { transport: 1 }, { airtime: 1 }];
    expect(computeConsensus(at, CFG).category).toBe('food');
    // 3 of 6 = 0.5, which does not.
    const below = [...at, { airtime: 1 }];
    expect(computeConsensus(below, CFG).category).toBeNull();
  });

  it('never derives a sensitive category, however strong the consensus', () => {
    const votes: HouseholdCategoryCounts[] = Array.from({ length: 20 }, () => ({ pharmacy: 1 }));
    expect(computeConsensus(votes, CFG)).toEqual({ category: null, householdCount: 20 });
  });

  it('ignores households that tagged nothing, and counts only voters', () => {
    const votes: HouseholdCategoryCounts[] = [{}, {}, { food: 1 }, { food: 1 }, { food: 1 }];
    expect(computeConsensus(votes, CFG)).toEqual({ category: 'food', householdCount: 3 });
  });

  it('breaks a tie deterministically rather than by object order', () => {
    const a = computeConsensus([{ zebra: 1 }, { apple: 1 }], { ...CFG, minHouseholds: 2, ratio: 0.5 });
    const b = computeConsensus([{ apple: 1 }, { zebra: 1 }], { ...CFG, minHouseholds: 2, ratio: 0.5 });
    expect(a.category).toBe(b.category);
    expect(a.category).toBe('apple');
  });

  describe('properties', () => {
    const arbCounts = fc.dictionary(
      fc.constantFrom('food', 'transport', 'airtime', 'school'),
      fc.integer({ min: 1, max: 100 }),
      { minKeys: 0, maxKeys: 4 },
    );

    it('scaling one household payment counts never changes the outcome', () => {
      fc.assert(
        fc.property(fc.array(arbCounts, { maxLength: 12 }), fc.integer({ min: 2, max: 50 }), (votes, k) => {
          if (votes.length === 0) return;
          const scaled = votes.map((v, i) =>
            i === 0 ? Object.fromEntries(Object.entries(v).map(([c, n]) => [c, n * k])) : v,
          );
          expect(computeConsensus(scaled, CFG)).toEqual(computeConsensus(votes, CFG));
        }),
      );
    });

    it('always returns null or a category that some household actually tagged', () => {
      fc.assert(
        fc.property(fc.array(arbCounts, { maxLength: 12 }), (votes) => {
          const { category } = computeConsensus(votes, CFG);
          if (category === null) return;
          expect(votes.some((v) => Object.hasOwn(v, category))).toBe(true);
        }),
      );
    });

    it('is order-independent', () => {
      fc.assert(
        fc.property(fc.array(arbCounts, { maxLength: 12 }), (votes) => {
          expect(computeConsensus([...votes].reverse(), CFG)).toEqual(computeConsensus(votes, CFG));
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/consensus.test.ts`
Expected: FAIL — cannot resolve `consensus`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/modules/vendors/consensus.ts`:

```ts
/** One household's self-attested category tally for one vendor: { "<category>": <payments> }. */
export type HouseholdCategoryCounts = Record<string, number>;

export type ConsensusConfig = {
  /** Minimum number of households that must have tagged anything at all. */
  minHouseholds: number;
  /** Fraction of votes the winner must hold, inclusive. */
  ratio: number;
  /** Categories that may never be derived from observation. */
  sensitiveCategories: readonly string[];
};

export type ConsensusResult = {
  category: string | null;
  /** How many households cast a vote — households that tagged nothing are not counted. */
  householdCount: number;
};

/** The single category one household stands behind: its most-tagged, ties broken alphabetically. */
function householdVote(counts: HouseholdCategoryCounts): string | null {
  let best: string | null = null;
  let bestN = 0;
  // Sorting the keys makes a tie resolve to the alphabetically first category rather than to
  // whatever order Postgres happened to serialise the jsonb object in. Without it the same data
  // could categorise a vendor differently on two different sweeps.
  for (const category of Object.keys(counts).sort()) {
    const n = counts[category] ?? 0;
    if (n > bestN) {
      best = category;
      bestN = n;
    }
  }
  return bestN > 0 ? best : null;
}

/**
 * Derive a vendor's category from its per-household observations.
 *
 * **One household, one vote.** A household that paid a vendor two hundred times counts exactly as
 * much as one that paid it once. Summing raw payment counts across households would let a single
 * frequent customer set a vendor's category by themselves — a five-household vendor with a
 * one-household category. That is the homogeneity failure l-diversity exists to prevent, and it is
 * the reason this function takes an array of per-household tallies rather than one merged tally.
 *
 * A sensitive category is never returned. Knowing a vendor is a clinic supports a health inference
 * about every household that pays it, so that assertion may only ever come from the business
 * itself (a claim) or from an operator — never from inference.
 */
export function computeConsensus(
  perHousehold: HouseholdCategoryCounts[],
  cfg: ConsensusConfig,
): ConsensusResult {
  const votes: string[] = [];
  for (const counts of perHousehold) {
    const vote = householdVote(counts);
    if (vote !== null) votes.push(vote);
  }

  const householdCount = votes.length;
  if (householdCount < cfg.minHouseholds) return { category: null, householdCount };

  const tally = new Map<string, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);

  let winner: string | null = null;
  let winnerN = 0;
  for (const category of [...tally.keys()].sort()) {
    const n = tally.get(category) ?? 0;
    if (n > winnerN) {
      winner = category;
      winnerN = n;
    }
  }

  if (winner === null || winnerN / householdCount < cfg.ratio) {
    return { category: null, householdCount };
  }
  if (cfg.sensitiveCategories.includes(winner)) {
    return { category: null, householdCount };
  }
  return { category: winner, householdCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/consensus.test.ts`
Expected: PASS (9 unit tests + 3 properties).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/vendors/consensus.ts apps/backend/tests/modules/vendors/consensus.test.ts
git commit -m "feat(vendors): one-household-one-vote category consensus"
```

---

## Task 8: The registry sweep

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-registry.service.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-registry.service.test.ts`

**Interfaces:**
- Consumes: `vendorObservationsRepo` (Task 3), `vendorsRepo` (Task 6), `computeConsensus` (Task 7).
- Produces:
  - `export type SweepConfig = { minHouseholds: number; consensusMinHouseholds: number; consensusRatio: number; sensitiveCategories: readonly string[]; retentionDays: number }`
  - `export type SweepResult = { promoted: number; categorised: number; pruned: number }`
  - `vendorRegistryService.sweep(db, now: Date, cfg: SweepConfig): Promise<SweepResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-registry.service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorObservationsRepo } from '../../../src/modules/vendors/vendor-observations.repo';
import { type SweepConfig, vendorRegistryService } from '../../../src/modules/vendors/vendor-registry.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { makeHousehold } from '../../helpers/fixtures';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

const CFG: SweepConfig = {
  minHouseholds: 3,
  consensusMinHouseholds: 4,
  consensusRatio: 0.6,
  sensitiveCategories: ['pharmacy'],
  retentionDays: 180,
};

async function observe(
  bankCode: string,
  accountNumber: string,
  category: string | null,
  households: number,
  when: Date = NOW,
): Promise<void> {
  for (let i = 0; i < households; i++) {
    const h = await makeHousehold(testDb);
    await vendorObservationsRepo.record(testDb, {
      bankCode, accountNumber, householdId: h.householdId,
      accountName: 'MAMA PUT KITCHEN', category, now: when,
    });
  }
}

describe('vendorRegistryService.sweep', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('promotes an account only once it clears the household threshold', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();

    await observe(bankCode, accountNumber, 'food', 2);
    expect((await vendorRegistryService.sweep(testDb, NOW, CFG)).promoted).toBe(0);
    expect(await vendorsRepo.findByAccount(testDb, bankCode, accountNumber)).toBeUndefined();

    await observe(bankCode, accountNumber, 'food', 1);
    expect((await vendorRegistryService.sweep(testDb, NOW, CFG)).promoted).toBe(1);
    expect(await vendorsRepo.findByAccount(testDb, bankCode, accountNumber)).toBeDefined();
  });

  it('leaves a freshly promoted vendor uncategorised (promotion floor < consensus floor)', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'food', 3);

    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.promoted).toBe(1);
    expect(result.categorised).toBe(0);
    expect((await vendorsRepo.findByAccount(testDb, bankCode, accountNumber))?.category).toBeNull();
  });

  it('categorises on a later sweep once the consensus floor is reached', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'food', 3);
    await vendorRegistryService.sweep(testDb, NOW, CFG);

    await observe(bankCode, accountNumber, 'food', 1);
    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.promoted).toBe(0);
    expect(result.categorised).toBe(1);

    const v = await vendorsRepo.findByAccount(testDb, bankCode, accountNumber);
    expect(v?.category).toBe('food');
    expect(v?.categoryHouseholdCount).toBe(4);
  });

  it('never derives a sensitive category', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'pharmacy', 10);

    await vendorRegistryService.sweep(testDb, NOW, CFG);
    const v = await vendorsRepo.findByAccount(testDb, bankCode, accountNumber);
    expect(v).toBeDefined();
    expect(v?.category).toBeNull();
    expect(v?.categorySource).toBe('observed');
  });

  it('is idempotent — a second sweep over the same data changes nothing', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await observe(bankCode, accountNumber, 'food', 5);

    await vendorRegistryService.sweep(testDb, NOW, CFG);
    const second = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(second.promoted).toBe(0);
    expect(second.pruned).toBe(0);
  });

  it('prunes stale observations for accounts that never became vendors', async () => {
    const bankCode = factories.bankCode();
    const orphan = factories.bankAccount();
    const long = new Date('2025-01-01T00:00:00Z');
    await observe(bankCode, orphan, null, 1, long);

    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.pruned).toBe(1);
    expect(await vendorObservationsRepo.listForAccount(testDb, bankCode, orphan)).toEqual([]);
  });

  it('keeps observations for a promoted vendor however old they are', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const long = new Date('2025-01-01T00:00:00Z');
    await observe(bankCode, accountNumber, 'food', 5, long);

    const result = await vendorRegistryService.sweep(testDb, NOW, CFG);
    expect(result.promoted).toBe(1);
    expect(result.pruned).toBe(0);
    expect(await vendorObservationsRepo.listForAccount(testDb, bankCode, accountNumber)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-registry.service.test.ts`
Expected: FAIL — cannot resolve `vendor-registry.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/modules/vendors/vendor-registry.service.ts`:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { computeConsensus } from './consensus';
import { vendorObservationsRepo } from './vendor-observations.repo';
import { vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type SweepConfig = {
  minHouseholds: number;
  consensusMinHouseholds: number;
  consensusRatio: number;
  sensitiveCategories: readonly string[];
  retentionDays: number;
};

export type SweepResult = {
  promoted: number;
  categorised: number;
  pruned: number;
};

const MS_PER_DAY = 86_400_000;

export const vendorRegistryService = {
  /**
   * Promote, categorise, prune — in that order, and deliberately not in one transaction.
   *
   * Each phase is independently idempotent, so a crash between phases costs at most one hour: the
   * next sweep re-derives everything from the observation table. Wrapping the whole thing in a
   * transaction would instead hold locks across what can be a large scan, for no correctness gain.
   *
   * Promotion always precedes categorisation, and because the consensus floor sits ABOVE the
   * promotion floor, a vendor is never promoted and categorised in the same sweep. That is
   * intended: being listed is a weaker claim than being categorised.
   */
  async sweep(db: DbOrTx, now: Date, cfg: SweepConfig): Promise<SweepResult> {
    let promoted = 0;
    let categorised = 0;

    // Phase 1 — promotion.
    const candidates = await vendorObservationsRepo.accountsAtOrAboveThreshold(
      db,
      cfg.minHouseholds,
    );
    for (const c of candidates) {
      const row = await vendorsRepo.promoteIfAbsent(db, {
        bankCode: c.bankCode,
        accountNumber: c.accountNumber,
        displayName: c.accountName,
        promotedHouseholdCount: c.householdCount,
        now,
      });
      if (row) promoted++;
    }

    // Phase 2 — categorisation. Only vendors whose category is still observation-derived; a
    // claimed or ops-set category is authoritative and must never be recomputed.
    const observedVendors = await vendorsRepo.listByCategorySource(db, 'observed');
    for (const v of observedVendors) {
      const rows = await vendorObservationsRepo.listForAccount(db, v.bankCode, v.accountNumber);
      const result = computeConsensus(
        rows.map((r) => r.categoryCounts),
        {
          minHouseholds: cfg.consensusMinHouseholds,
          ratio: cfg.consensusRatio,
          sensitiveCategories: cfg.sensitiveCategories,
        },
      );
      // Skip the write when nothing would change — keeps `categorised` an honest count of actual
      // changes rather than of rows examined.
      if (result.category === v.category) continue;
      const changed = await vendorsRepo.setObservedCategory(
        db,
        v.id,
        result.category,
        result.category === null ? null : result.householdCount,
      );
      if (changed) categorised++;
    }

    // Phase 3 — retention. Accounts that never looked like merchants are forgotten.
    const cutoff = new Date(now.getTime() - cfg.retentionDays * MS_PER_DAY);
    const pruned = await vendorObservationsRepo.pruneStaleUnpromoted(db, cutoff);

    logger.info({ promoted, categorised, pruned }, 'vendor registry sweep complete');
    return { promoted, categorised, pruned };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-registry.service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/vendors/vendor-registry.service.ts apps/backend/tests/modules/vendors/vendor-registry.service.test.ts
git commit -m "feat(vendors): registry sweep — promote, categorise, prune"
```

---

## Task 9: Hourly cron job

**Files:**
- Create: `apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts`
- Modify: `apps/backend/bin/cron.ts`
- Test: `apps/backend/tests/cron/vendor-registry-sweep.job.test.ts`

**Interfaces:**
- Consumes: `vendorRegistryService.sweep` (Task 8), `env` (Task 1).
- Produces: `export const vendorRegistrySweepJob: CronJob` with `name: 'vendor-registry-sweep'` and `schedule: '17 * * * *'`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/cron/vendor-registry-sweep.job.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { vendorRegistrySweepJob } from '../../src/cron/jobs/vendor-registry-sweep.job';
import { vendorRegistryService } from '../../src/modules/vendors/vendor-registry.service';

describe('vendorRegistrySweepJob', () => {
  it('is named and scheduled hourly, off the top of the hour', () => {
    expect(vendorRegistrySweepJob.name).toBe('vendor-registry-sweep');
    expect(vendorRegistrySweepJob.schedule).toBe('17 * * * *');
  });

  it('run() invokes the sweep with config drawn from env', async () => {
    const spy = vi
      .spyOn(vendorRegistryService, 'sweep')
      .mockResolvedValue({ promoted: 0, categorised: 0, pruned: 0 });

    await vendorRegistrySweepJob.run();

    expect(spy).toHaveBeenCalledTimes(1);
    const cfg = spy.mock.calls[0]?.[2];
    expect(cfg?.minHouseholds).toBe(5);
    expect(cfg?.consensusMinHouseholds).toBe(8);
    expect(cfg?.consensusRatio).toBe(0.6);
    expect(cfg?.retentionDays).toBe(180);
    expect(cfg?.sensitiveCategories).toContain('pharmacy');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/cron/vendor-registry-sweep.job.test.ts`
Expected: FAIL — cannot resolve `vendor-registry-sweep.job`.

- [ ] **Step 3: Write the job**

Create `apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts`:

```ts
import { db } from '../../db/client';
import { env } from '../../env';
import { vendorRegistryService } from '../../modules/vendors/vendor-registry.service';
import type { CronJob } from '../scheduler';

export const vendorRegistrySweepJob: CronJob = {
  name: 'vendor-registry-sweep',
  // Hourly at :17 rather than :00 — the recon sweep already runs on every fifth minute including
  // the top of the hour, and there is no reason to stack a full-table scan on top of it.
  schedule: '17 * * * *',
  async run() {
    await vendorRegistryService.sweep(db, new Date(), {
      minHouseholds: env.VENDOR_REGISTRY_MIN_HOUSEHOLDS,
      consensusMinHouseholds: env.VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS,
      consensusRatio: env.VENDOR_REGISTRY_CONSENSUS_RATIO,
      sensitiveCategories: env.VENDOR_SENSITIVE_CATEGORIES,
      retentionDays: env.VENDOR_OBSERVATION_RETENTION_DAYS,
    });
  },
};
```

- [ ] **Step 4: Register it**

In `apps/backend/bin/cron.ts`, import the job and register it alongside the existing ones, matching the surrounding style exactly:

```ts
import { vendorRegistrySweepJob } from '../src/cron/jobs/vendor-registry-sweep.job';
...
cronScheduler.register(vendorRegistrySweepJob);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/cron/vendor-registry-sweep.job.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts apps/backend/bin/cron.ts apps/backend/tests/cron/vendor-registry-sweep.job.test.ts
git commit -m "feat(vendors): hourly registry sweep cron job"
```

---

## Task 10: Category resolver and intent fields

**Files:**
- Create: `apps/backend/src/modules/vendors/vendor-category-resolver.service.ts`
- Modify: `apps/backend/src/modules/rules/types.ts`
- Modify: `apps/backend/src/modules/vendors/index.ts`
- Test: `apps/backend/tests/modules/vendors/vendor-category-resolver.service.test.ts`

**Interfaces:**
- Consumes: `vendorsRepo.findByAccount` (Task 6).
- Produces:
  - `export type ResolvedVendorCategory = { vendorId: string; category: string | null; categorySource: 'observed' | 'claimed' | 'ops'; enforceable: boolean }`
  - `vendorCategoryResolver.resolve(db, bankCode: string | null, accountNumber: string | null): Promise<ResolvedVendorCategory | null>` — never throws
  - `TxnIntent.vendorId: string | null`, `TxnIntent.resolvedCategory: string | null`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/vendors/vendor-category-resolver.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorCategoryResolver } from '../../../src/modules/vendors/vendor-category-resolver.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

describe('vendorCategoryResolver.resolve', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns null for a null account', async () => {
    expect(await vendorCategoryResolver.resolve(testDb, null, null)).toBeNull();
    expect(await vendorCategoryResolver.resolve(testDb, '058', null)).toBeNull();
  });

  it('returns null for an account that is not in the registry', async () => {
    const r = await vendorCategoryResolver.resolve(testDb, factories.bankCode(), factories.bankAccount());
    expect(r).toBeNull();
  });

  it('reports an observed category as NOT enforceable', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode, accountNumber, displayName: 'SHOP', promotedHouseholdCount: 9, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.setObservedCategory(testDb, v.id, 'food', 9);

    const r = await vendorCategoryResolver.resolve(testDb, bankCode, accountNumber);
    expect(r).toEqual({
      vendorId: v.id, category: 'food', categorySource: 'observed', enforceable: false,
    });
  });

  it('reports a claimed category as enforceable', async () => {
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode, accountNumber, displayName: 'SHOP', promotedHouseholdCount: 9, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await testDb.execute(
      sql`UPDATE vendors SET category = 'transport', category_source = 'claimed' WHERE id = ${v.id}`,
    );

    const r = await vendorCategoryResolver.resolve(testDb, bankCode, accountNumber);
    expect(r?.enforceable).toBe(true);
    expect(r?.category).toBe('transport');
  });

  it('returns null rather than throwing when the lookup fails', async () => {
    const spy = vi.spyOn(vendorsRepo, 'findByAccount').mockRejectedValue(new Error('db down'));
    const r = await vendorCategoryResolver.resolve(testDb, factories.bankCode(), factories.bankAccount());
    expect(r).toBeNull();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vendors/vendor-category-resolver.service.test.ts`
Expected: FAIL — cannot resolve `vendor-category-resolver.service`.

- [ ] **Step 3: Write the resolver**

Create `apps/backend/src/modules/vendors/vendor-category-resolver.service.ts`:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { type VendorCategorySource, vendorsRepo } from './vendors.repo';

type DbOrTx = PostgresJsDatabase;

export type ResolvedVendorCategory = {
  vendorId: string;
  category: string | null;
  categorySource: VendorCategorySource;
  /**
   * Whether this category may DRIVE a rule outcome, as opposed to merely being recorded.
   *
   * False for an observed category however strong its consensus: inference is good enough to
   * measure with and not good enough to deny a purchase with. Only the business asserting its own
   * nature (a claim) or an operator setting it may ever be enforced.
   */
  enforceable: boolean;
};

export const vendorCategoryResolver = {
  /**
   * Look up what the registry knows about a vendor bank account.
   *
   * **Never throws, and returns null on any failure.** This runs inside the spend path, and a
   * registry outage must not be able to block a payment — the caller falls back to the
   * app-supplied category exactly as it behaved before the registry existed.
   */
  async resolve(
    db: DbOrTx,
    bankCode: string | null,
    accountNumber: string | null,
  ): Promise<ResolvedVendorCategory | null> {
    if (!bankCode || !accountNumber) return null;
    try {
      const vendor = await vendorsRepo.findByAccount(db, bankCode, accountNumber);
      if (!vendor) return null;
      return {
        vendorId: vendor.id,
        category: vendor.category,
        categorySource: vendor.categorySource,
        enforceable: vendor.categorySource !== 'observed',
      };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'vendor category resolution failed');
      return null;
    }
  },
};
```

- [ ] **Step 4: Extend the intent type**

In `apps/backend/src/modules/rules/types.ts`, add to `TxnIntent` after `retailerId`:

```ts
  /**
   * The registry vendor this spend resolved to. Attribution and audit ONLY — no evaluator reads
   * this field. In particular it is NOT a second `retailerId`: vendor identity and marketplace
   * retailer identity are separate namespaces, and `evaluateMerchant` still denies any intent
   * whose `retailerId` is null, bank transfers included.
   */
  vendorId: string | null;
  /**
   * What the registry says this vendor's category is, recorded whether or not it was enforced.
   * When enforcement is on for the household AND the category is claimed or ops-set, this value
   * is what `category` above was populated from; otherwise `category` is the app-supplied string
   * and this field is the counterfactual.
   */
  resolvedCategory: string | null;
```

Fix every construction site the compiler now flags — `lifecycle.service.ts` and the rule/anomaly tests — by adding `vendorId: null, resolvedCategory: null`. Task 11 gives `lifecycle.service.ts` its real values.

- [ ] **Step 5: Export from the module barrel**

In `apps/backend/src/modules/vendors/index.ts`, add exports for the new modules, matching the existing style:

```ts
export { vendorObservationsRepo } from './vendor-observations.repo';
export { vendorObservationService } from './vendor-observation.service';
export { vendorsRepo } from './vendors.repo';
export { vendorRegistryService } from './vendor-registry.service';
export { vendorCategoryResolver } from './vendor-category-resolver.service';
export { computeConsensus } from './consensus';
```

- [ ] **Step 6: Run the full suite**

Run: `pnpm --filter @amana/backend test` and `pnpm --filter @amana/backend typecheck`
Expected: PASS. The typecheck is the point of this step — it is what finds every `TxnIntent` construction site.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src apps/backend/tests
git commit -m "feat(vendors): category resolver and registry fields on TxnIntent"
```

---

## Task 11: Shadow mode in the rule path

**Files:**
- Modify: `apps/backend/src/modules/transactions/lifecycle.service.ts`
- Modify: `apps/backend/src/modules/audit/events.ts`
- Modify: `apps/backend/src/modules/wallet/transactions.repo.ts`
- Test: `apps/backend/tests/modules/transactions/lifecycle.shadow.test.ts`

**Interfaces:**
- Consumes: `vendorCategoryResolver.resolve` (Task 10), `householdsRepo.findByMasterWalletId` (Task 4), `env.VENDOR_CATEGORY_ENFORCE_DEFAULT` (Task 1).
- Produces:
  - `auditEvents.vendorCategoryShadow({ transactionId, vendorId, appCategory, registryCategory, liveDecision, shadowDecision, enforced }): AuditEntry` with `action: 'vendor.category_shadow'`
  - `transactionsRepo.setRegistryAttribution(db, txnId, vendorId: string | null, resolvedCategory: string | null): Promise<void>`

**This is the task the user's rollout decision lives in.** With enforcement off, the decision returned must be identical to what it would have been without a registry at all.

**Principal direct spends are deliberately not covered here.** `lifecycleService.evaluate` returns early for `txn.subWalletId === null` — no rule evaluation, per decision #17 — and that early return sits *above* the transaction block this task edits. So a principal's own spend never gets `vendor_id` or `resolved_category` written. That is correct and needs no fix: there are no rules to shadow, nothing reads the attribution column, and the settlement observation in Task 5 still fires, so the registry learns from principal spending exactly as it does from agent spending. Stated because a reader comparing the two paths will otherwise assume it is an oversight.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/modules/transactions/lifecycle.shadow.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { auditRepo } from '../../../src/modules/audit/audit.repo';
import { lifecycleService } from '../../../src/modules/transactions/lifecycle.service';
import { vendorsRepo } from '../../../src/modules/vendors/vendors.repo';
import { factories } from '../../helpers/factories';
import { makeFundedSubWallet, makeDraftSpend, giveCategoryAllowlist } from '../../helpers/fixtures';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-08-25T10:00:00Z');

/** A claimed vendor categorised `transport`, on an account the tests then spend to. */
async function claimedTransportVendor(bankCode: string, accountNumber: string): Promise<string> {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode, accountNumber, displayName: 'DANFO PARK', promotedHouseholdCount: 9, now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  await testDb.execute(
    sql`UPDATE vendors SET category = 'transport', category_source = 'claimed' WHERE id = ${v.id}`,
  );
  return v.id;
}

describe('lifecycle — vendor category shadow mode', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('does NOT change the decision while enforcement is off, even when the registry disagrees', async () => {
    const { masterWalletId, subWalletId, principalUserId } = await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['food']);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);

    // The agent claims "food"; the registry says "transport". A food-only allowlist would deny
    // under enforcement — but enforcement is off, so this must still be allowed.
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });
    expect(result.kind).toBe('allow');
  });

  it('records the registry answer on the transaction regardless of enforcement', async () => {
    const { masterWalletId, subWalletId, principalUserId } = await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['food']);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const vendorId = await claimedTransportVendor(bankCode, accountNumber);
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'food',
    });

    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });

    const rows = await testDb.execute<{ vendor_id: string; resolved_category: string }>(
      sql`SELECT vendor_id, resolved_category FROM transactions WHERE id = ${txn.id}`,
    );
    expect(rows[0]?.vendor_id).toBe(vendorId);
    expect(rows[0]?.resolved_category).toBe('transport');
  });

  it('audits the counterfactual when the shadow decision differs', async () => {
    const { masterWalletId, subWalletId, principalUserId } = await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['food']);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'food',
    });

    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });

    const entries = await auditRepo.listByAction(testDb, 'vendor.category_shadow');
    expect(entries).toHaveLength(1);
    const payload = entries[0]?.payloadJson as Record<string, unknown>;
    expect(payload.appCategory).toBe('food');
    expect(payload.registryCategory).toBe('transport');
    expect(payload.enforced).toBe(false);
    expect(payload.liveDecision).toBe('allow');
    expect(payload.shadowDecision).toBe('require_bump');
  });

  it('writes no shadow audit row when the registry agrees with the app', async () => {
    const { masterWalletId, subWalletId, principalUserId } = await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['transport']);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'transport',
    });

    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });
    expect(await auditRepo.listByAction(testDb, 'vendor.category_shadow')).toEqual([]);
  });

  it('ENFORCES the registry category when the household opts in', async () => {
    const { masterWalletId, subWalletId, principalUserId, householdId } =
      await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['food']);
    await testDb.execute(
      sql`UPDATE households SET vendor_category_enforced = TRUE WHERE id = ${householdId}`,
    );
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });
    expect(result.kind).toBe('bump_pending');
  });

  it('never enforces an OBSERVED category, even for an opted-in household', async () => {
    const { masterWalletId, subWalletId, principalUserId, householdId } =
      await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['food']);
    await testDb.execute(
      sql`UPDATE households SET vendor_category_enforced = TRUE WHERE id = ${householdId}`,
    );
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    const v = await vendorsRepo.promoteIfAbsent(testDb, {
      bankCode, accountNumber, displayName: 'DANFO PARK', promotedHouseholdCount: 9, now: NOW,
    });
    if (!v) throw new Error('promotion failed');
    await vendorsRepo.setObservedCategory(testDb, v.id, 'transport', 9); // observed, not claimed

    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'food',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });
    expect(result.kind).toBe('allow');
  });

  it('writes no shadow row when the sub-wallet has no active rule set', async () => {
    // No giveCategoryAllowlist call — fetchActiveRuleSet returns null, evaluate is never called,
    // and the decision is a degenerate allow. There is nothing a category could have changed.
    const { masterWalletId, subWalletId, principalUserId } = await makeFundedSubWallet(testDb);
    const bankCode = factories.bankCode();
    const accountNumber = factories.bankAccount();
    await claimedTransportVendor(bankCode, accountNumber);
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: bankCode, vendorAccount: accountNumber, category: 'food',
    });

    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });
    expect(result.kind).toBe('allow');
    expect(await auditRepo.listByAction(testDb, 'vendor.category_shadow')).toEqual([]);
  });

  it('allows a spend to an unregistered vendor exactly as before', async () => {
    const { masterWalletId, subWalletId, principalUserId } = await makeFundedSubWallet(testDb);
    await giveCategoryAllowlist(testDb, subWalletId, ['food']);
    const txn = await makeDraftSpend(testDb, {
      masterWalletId, subWalletId,
      vendorBankCode: factories.bankCode(), vendorAccount: factories.bankAccount(),
      category: 'food',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalUserId, now: NOW,
    });
    expect(result.kind).toBe('allow');
    expect(await auditRepo.listByAction(testDb, 'vendor.category_shadow')).toEqual([]);
  });
});
```

> `makeFundedSubWallet`, `makeDraftSpend` and `giveCategoryAllowlist` stand in for whatever the existing lifecycle/rules tests already use to build a funded sub-wallet, a draft spend and an active category rule. Read `tests/modules/transactions/` and `tests/modules/rules/` first and reuse those; do not build a parallel set.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/lifecycle.shadow.test.ts`
Expected: FAIL — no `vendor.category_shadow` audit rows, and `vendor_id` is null.

- [ ] **Step 3: Add the audit event**

In `apps/backend/src/modules/audit/events.ts`, add to the `auditEvents` object:

```ts
  /**
   * Recorded only when the registry's category would have produced a DIFFERENT rule decision than
   * the app-supplied one. This is the measurement the whole shadow-mode rollout exists to take:
   * counting these rows per household is how we learn what enforcement would cost before anyone
   * is denied a purchase at a market stall.
   */
  vendorCategoryShadow(input: {
    transactionId: string;
    vendorId: string;
    appCategory: string | null;
    registryCategory: string | null;
    /**
     * Where the registry category came from. Load-bearing for the operator query, not decoration:
     * an `observed` category NEVER enforces (D-V7), so rows carrying one describe a difference that
     * will not happen. Grouping the shadow log without this field blends "enforcement would change
     * this" with "enforcement can never change this", and the whole point of the log is deciding
     * whether to switch enforcement on. In V1 every vendor is `observed` and the field looks
     * redundant; from SP-V2 onward both sources coexist and it is the only thing separating them.
     */
    categorySource: 'observed' | 'claimed' | 'ops';
    liveDecision: 'allow' | 'require_bump';
    shadowDecision: 'allow' | 'require_bump';
    enforced: boolean;
  }): AuditEntry {
    return {
      actorKind: 'system',
      action: 'vendor.category_shadow',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        vendorId: input.vendorId,
        appCategory: input.appCategory,
        registryCategory: input.registryCategory,
        categorySource: input.categorySource,
        liveDecision: input.liveDecision,
        shadowDecision: input.shadowDecision,
        enforced: input.enforced,
      },
    };
  },
```

- [ ] **Step 4: Add the attribution write**

In `apps/backend/src/modules/wallet/transactions.repo.ts`, add to `transactionsRepo`:

```ts
  /** Record which registry vendor a spend resolved to and what category the registry gave it. */
  async setRegistryAttribution(
    db: DbOrTx,
    transactionId: string,
    vendorId: string | null,
    resolvedCategory: string | null,
  ): Promise<void> {
    await db
      .update(transactions)
      .set({ vendorId, resolvedCategory })
      .where(eq(transactions.id, transactionId));
  },
```

- [ ] **Step 5: Wire the resolver into evaluate**

In `apps/backend/src/modules/transactions/lifecycle.service.ts`, add imports:

```ts
import { env } from '../../env';
import { householdsRepo } from '../identity/households.repo';
import { vendorCategoryResolver } from '../vendors/vendor-category-resolver.service';
```

Inside the `db.transaction` callback, immediately **before** the `const intent: TxnIntent = {` block, insert:

```ts
      // --- Vendor registry: resolve, then decide whether it may drive the outcome. ---
      const registry = await vendorCategoryResolver.resolve(
        txDb,
        txn.vendorBankCode,
        txn.vendorAccount,
      );
      const household = await householdsRepo.findByMasterWalletId(txDb, txn.masterWalletId);
      // Three-state: an explicit household setting wins in BOTH directions; NULL inherits the
      // global default. `?? env...` and not `||` — `false` is a real answer, not a missing one.
      const householdEnforces =
        household?.vendorCategoryEnforced ?? env.VENDOR_CATEGORY_ENFORCE_DEFAULT;
      // An observed category is never enforced however strong its consensus (spec D-V7).
      const enforced = householdEnforces && registry !== null && registry.enforceable;
      const liveCategory = enforced ? (registry?.category ?? txn.category) : txn.category;

      if (registry) {
        await transactionsRepo.setRegistryAttribution(
          txDb,
          txn.id,
          registry.vendorId,
          registry.category,
        );
      }
```

Then change the intent construction so `category` uses `liveCategory` and the two new fields are populated:

```ts
      const intent: TxnIntent = {
        amountKobo: kobo(txn.amountKobo as bigint),
        category: liveCategory,
        // ... vendorBankCode / vendorAccountNumber / vendorResolvedName / retailerId unchanged ...
        vendorId: registry?.vendorId ?? null,
        resolvedCategory: registry?.category ?? null,
        confirmedAt: input.now,
      };
```

- [ ] **Step 6: Add the shadow evaluation**

**Read the existing call before you edit.** It looks like this — `ruleSet` is nullable and the evaluation context is an inline object literal, not a named `ctx` variable:

```ts
      const ruleSet = await fetchActiveRuleSet(txDb, subWalletId);
      const decision: Decision = ruleSet
        ? evaluate(intent, ruleSet, {
            ledger: {
              subWalletAvailableKobo: subBalance,
              spentLast24hKobo: spent24,
              spentLast30dKobo: spent30d,
            },
            anomalyScore: anomaly.score,
          })
        : { kind: 'allow' };
```

Two consequences for the shadow evaluation, and getting either wrong is a real bug:

1. **`ruleSet` can be null**, in which case `evaluate` is never called and the decision is a
   degenerate `allow`. The shadow branch must be guarded on `ruleSet` too — passing `null` into
   `evaluate` would throw. With no rule set there is nothing to shadow: no rule can behave
   differently, so no audit row should be written.
2. **There is no `ctx` variable to reuse.** Lift the context into one before the existing call so
   both evaluations share it, rather than duplicating the literal:

```ts
      const evalCtx: RuleEvaluationContext = {
        ledger: {
          subWalletAvailableKobo: subBalance,
          spentLast24hKobo: spent24,
          spentLast30dKobo: spent30d,
        },
        anomalyScore: anomaly.score,
      };
      const decision: Decision = ruleSet ? evaluate(intent, ruleSet, evalCtx) : { kind: 'allow' };
```

Import `RuleEvaluationContext` from `../rules/types` alongside the existing `TxnIntent` import.

Then, immediately after the `txnRuleEval` audit append and **before** the `if (decision.kind === 'allow')` branch (the allow branch returns, so anything placed after it would only run for bumps):

```ts
      // The counterfactual. `evaluate` is a pure function over an already-loaded rule set and an
      // already-computed context, so running it a second time costs one in-memory pass and no
      // database work at all — which is what makes shadow mode affordable on the spend path.
      //
      // The branch flips with `enforced` so the same instrument keeps working after enforcement is
      // switched on: before, it reports what enforcement WOULD change; after, what it IS changing.
      //
      // `ruleSet` is in the guard because a sub-wallet with no active rule set never calls
      // `evaluate` at all — there is nothing for a category to change.
      if (
        ruleSet &&
        registry !== null &&
        registry.category !== null &&
        registry.category !== txn.category
      ) {
        const shadowIntent: TxnIntent = {
          ...intent,
          category: enforced ? txn.category : registry.category,
        };
        const shadowDecision = evaluate(shadowIntent, ruleSet, evalCtx);
        if (shadowDecision.kind !== decision.kind) {
          await auditRepo.append(
            txDb,
            auditEvents.vendorCategoryShadow({
              transactionId: txn.id,
              vendorId: registry.vendorId,
              appCategory: txn.category,
              registryCategory: registry.category,
              categorySource: registry.categorySource,
              liveDecision: decision.kind,
              shadowDecision: shadowDecision.kind,
              enforced,
            }),
          );
        }
      }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/lifecycle.shadow.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Run the full suite and the coverage gate**

Run: `pnpm --filter @amana/backend test`
Expected: PASS, with no pre-existing lifecycle or rules test regressed.

Run: `pnpm --filter @amana/backend test:coverage`
Expected: PASS — lines/statements ≥92, functions ≥90, branches ≥80.

Run: `pnpm exec biome check .` and `pnpm --filter @amana/backend typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src apps/backend/tests
git commit -m "feat(vendors): shadow-mode category resolution in the rule path"
```

---

## Task 12: Runbook and decision registry

**Files:**
- Create: `docs/runbook/vendor-registry.md`
- Modify: `docs/brainstorm/locked-decisions.md`
- Modify: `CLAUDE.md` (the Docs section's runbook list)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Write the runbook**

Create `docs/runbook/vendor-registry.md` covering, with real values rather than placeholders:

- What the two tables hold and, explicitly, that `vendor_observations` has no read route and must not acquire one.
- The three sweep phases, the `17 * * * *` schedule, and the fact that a vendor is never promoted and categorised in the same sweep.
- Every env var from Task 1 with its default and what raising or lowering it does.
- **How to read the shadow data** — the query an operator actually runs:

```sql
SELECT payload_json ->> 'categorySource'   AS category_source,
       payload_json ->> 'registryCategory' AS registry_category,
       payload_json ->> 'appCategory'      AS app_category,
       COUNT(*)                            AS n
FROM audit_log
WHERE action = 'vendor.category_shadow'
  AND created_at > now() - interval '30 days'
GROUP BY 1, 2, 3
ORDER BY n DESC;
```

**Read `category_source` first, and say why in the runbook:** only `claimed` and `ops` rows describe a change enforcement would actually make. `observed` rows are the registry disagreeing in a way it will never be allowed to act on, and counting them as evidence for switching enforcement on would overstate the case — usually by a lot, since in V1 they are all of them.

- **How to switch enforcement on for one household**, and that this is the only supported way to start:

```sql
UPDATE households SET vendor_category_enforced = TRUE WHERE id = '<household-uuid>';
```

- How to switch it off again (`FALSE`, not `NULL` — `NULL` means inherit) and that no deploy is needed either way.
- Why observed categories never enforce, and what would have to change for that to be revisited.
- The retention sweep, and the fact that promoted vendors keep their observations forever.

- [ ] **Step 2: Append the decisions**

Append D-V1 through D-V8 to `docs/brainstorm/locked-decisions.md`, numbered to continue that file's existing sequence, each with its *Why*, copied from spec §3. The spec asserts this file is the canonical registry; until this step runs, that assertion is false.

- [ ] **Step 3: Add the runbook to the index**

In `CLAUDE.md`, add `vendor-registry.md` to the `docs/runbook/` list in the Docs section, with a one-clause description matching the style of its neighbours.

- [ ] **Step 4: Validate the tables**

Run: `py tools/docs/validate-tables.py` (or `python3` where that is the working launcher)
Expected: all tables well-formed.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: vendor registry runbook and locked decisions D-V1..D-V8"
```

---

## Self-Review

**Spec coverage.** Every SP-V1 row in spec §4 maps to a task: observation write at settlement (Tasks 3–5), promotion cron (Tasks 6–9), `vendors` table (Task 2), category resolution (Task 10), shadow logging (Task 11). Spec §5.1/§5.2/§5.3 → Task 2. §6.1 → Task 10. §6.2 → Task 11 Step 6. §6.3 → Task 1. §6.4 → Tasks 7 and 8. §10.1 retention → Tasks 3 and 8. §10.2 one-household-one-vote → Task 7; sensitive categories → Tasks 1, 7, 8. §11 error handling → the never-throws tests in Tasks 4, 5, 10. §12 — every listed test appears, including the load-bearing shadow test (Task 11 Step 1, first case) and the D-V1 merchant regression guard, which is covered by Task 10 Step 6's full-suite run over the existing `evaluateMerchant` tests plus the `vendorId` doc comment.

**Deliberately not in this plan** (spec §4, SP-V2/SP-V3): the claim rail, `public_code` minting, `GET /vendors/code/:code`, the `kind: 'vendor'` resolution branch, `vendor_stickers.vendor_id`, the `lib/crockford.ts` extraction, and the landing page. `vendors.public_code` and the `claimed` enum value are created in Task 2 so SP-V2 needs no second migration on the same table.

**Placeholder scan.** No TBDs. Three places name a fixture rather than defining it (`makeHousehold`, `makeHouseholdWithWallet`, `makeFundedSubWallet`/`makeDraftSpend`/`giveCategoryAllowlist`); each carries an explicit instruction to find and reuse the existing equivalent, because inventing a parallel fixture set in a suite this size is the larger error.

**Type consistency.** `vendorObservationsRepo.record` takes `RecordInput` in Task 3 and is called with exactly those fields in Task 4. `vendorsRepo.promoteIfAbsent` returns `VendorRow | null` in Task 6 and both callers (Task 8, and the tests) handle null. `computeConsensus` takes `HouseholdCategoryCounts[]` in Task 7 and Task 8 passes `rows.map((r) => r.categoryCounts)`, which is `Record<string, number>[]` given the `$type<>()` annotation in Task 2. `ResolvedVendorCategory.enforceable` is produced in Task 10 and consumed in Task 11. `SweepConfig` field names in Task 8 match the object literal in Task 9 exactly.

**One risk worth stating.** Task 11 Step 5 and Step 6 edit a function this plan cannot see in full. Both steps say to match the file's actual local names rather than assume the ones written here. If `lifecycleService.evaluate` has drifted from what the plan describes, stop and re-read it before editing — do not pattern-match the diff into place.
