# A1 Task 7 — JIT Elevation and Money Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an `owner` a single, audited, time-boxed way to resolve a stuck `in_flight` spend — the only money state today that harms a customer and that no automated process will ever fix.

**Architecture:** A new append-only `admin_elevations` table records a single-use, transaction-scoped unlock of the `money.operate` permission the operator already holds. `moneyOpsService.resolveStuckTransaction` re-queries Anchor through the injected adapter and applies Anchor's answer by calling the *same* `settlementService.finalise` / `reversalService.reverse` that the reconciliation cron calls — it writes no postings of its own. Three admin endpoints and one portal page sit on top.

**Tech Stack:** Hono, Drizzle ORM, Postgres 16, Vitest (real DB, `pool: forks`, `singleFork: true`), Zod, Biome, Next.js App Router (admin portal).

**Spec:** `docs/superpowers/specs/2026-09-17-a1-task7-jit-elevation-design.md` — read it before Task 1. The spec is the authority; this plan argues from it.

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from the spec.

- **No new ledger arithmetic.** This task writes no postings. The only money movements are via `settlementService.finalise` and `reversalService.reverse`. If you find yourself calling `ledgerService.writeDoubleEntry` in production code, stop — you have left the plan.
- **Elevation unlocks a held permission; it never grants one.** `money.operate` stays owner-only. No code path may add a permission to anyone's set. An `admin` must be refused even with a valid elevation row present.
- **`null` from `findTransferByReference` means a definitive 404 and nothing else.** A thrown error (transport, 5xx, open circuit breaker) must NEVER be treated as absence. It is refused as `anchor_unreachable`.
- **The force path may reverse, never settle.** There is no code path by which a single operator causes money to leave.
- **Audit every branch, including every refusal.**
- **Elevation is single-use and bound to one transaction id.** `consumed_at` is written only after a settle or reverse *succeeds*; a failure leaves the elevation live until it expires.
- **The operator's free-text reason never reaches the transaction record.** It lives on `admin_elevations.reason` and in the audit payload. The `reason` passed to `reverse` is Anchor's `failureReason`, or a fixed system string on the force path.
- **`STUCK_TXN_MIN_AGE_SECONDS` (900) must stay above the sweep's own `STUCK_THRESHOLD_MINUTES` (5).** The automation gets several passes before a human may intervene.
- **Migrations are generated, never hand-written:** `pnpm --filter @amana/backend exec drizzle-kit generate`. The journal is 0-indexed and the last existing migration is `0049`, so the new one is `0050`. Hand-writing desynchronises the journal and snapshot.
- **Tests assert ledger postings, not just status strings.** The point of the feature is where the money ends up.
- **The exact CI lint command is `pnpm exec biome check .` and it must exit 0.** Do not trust the tail of a `--write` summary; Biome truncates at 20 diagnostics and that truncation hid a real error in Task 6.
- **Docs ride in the same commit as the code that invalidates them.** Each task below names its doc.

---

## File Structure

**Backend — created**
- `apps/backend/src/modules/admin/admin-elevations.repo.ts` — Drizzle queries for `admin_elevations`. Liveness lookup and the single-use consume guard.
- `apps/backend/src/modules/admin/money-ops.service.ts` — `MoneyOpsError`, `grantElevation`, `resolveStuckTransaction`, `listStuck`. All decision-making lives here.
- `apps/backend/src/routes/admin/money.ts` — three thin endpoints.
- `apps/backend/tests/helpers/stuck-txn.ts` — the `seedStuckTxn` recipe, extracted from the reconciliation test so both suites share one faithful fixture.

**Backend — modified**
- `apps/backend/src/db/schema/admin.ts` — add `adminElevations`.
- `apps/backend/src/db/migrations/0050_*.sql` + journal + snapshot — generated.
- `apps/backend/src/env.ts` — three new numeric settings.
- `apps/backend/src/modules/audit/events.ts` — five new audit actions.
- `apps/backend/src/server.ts` — mount `/admin/money`.
- `apps/backend/tests/helpers/test-db.ts` — add `'admin_elevations'` to `TABLES_TO_TRUNCATE`.
- `apps/backend/tests/modules/transactions/reconciliation.service.test.ts` — import the extracted helper.

**Admin portal — created**
- `apps/admin-portal/app/(portal)/money/page.tsx` + `page.test.tsx`.

**Admin portal — modified**
- `apps/admin-portal/lib/api.ts` — `money` namespace.
- `apps/admin-portal/lib/types.ts` — `StuckTransaction`, `Elevation`, `ResolveOutcome`.
- `apps/admin-portal/components/Rail.tsx` — nav entry.

Boundaries: the repo knows SQL and nothing else; the service owns every rule; the route reads the actor from the session and decides nothing; the page renders and never chooses an outcome.

---

### Task 1: `admin_elevations` table, migration, and the shared stuck-transaction fixture

**Files:**
- Modify: `apps/backend/src/db/schema/admin.ts`
- Create: `apps/backend/src/db/migrations/0050_*.sql` (generated)
- Create: `apps/backend/tests/helpers/stuck-txn.ts`
- Modify: `apps/backend/tests/helpers/test-db.ts`
- Modify: `apps/backend/tests/modules/transactions/reconciliation.service.test.ts`
- Modify: `docs/technical/database-schema.md`
- Test: `apps/backend/tests/db/admin-elevations.schema.test.ts`

**Interfaces:**
- Produces: `adminElevations` table export; `seedStuckTxn(createdAtIso: string): Promise<{ txnId: string; idempotencyKey: string; masterWalletId: string; subWalletLedgerAccountId: string; suspenseLedgerAccountId: string }>`.
- Consumes: `adminUsers` and `transactions` from the schema. `admin.ts` currently imports nothing from other schema files and `transactions.ts` imports only `./wallet`, so importing `./transactions` into `admin.ts` introduces no cycle — verified.

- [ ] **Step 1: Extract the stuck-transaction fixture into a shared helper**

The reconciliation test already contains the only correct recipe for an `in_flight` spend with real reservation postings. Move it verbatim into a helper and return the extra ids later tasks need to assert postings.

Create `apps/backend/tests/helpers/stuck-txn.ts`:

```ts
import { sql } from 'drizzle-orm';
import { kobo } from '../../src/lib/kobo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { txnIntentService } from '../../src/modules/transactions/txn-intent.service';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { factories } from './factories';
import { testDb } from './test-db';

export type StuckTxn = {
  txnId: string;
  idempotencyKey: string;
  masterWalletId: string;
  subWalletLedgerAccountId: string;
  suspenseLedgerAccountId: string;
};

/**
 * An `in_flight` spend with its reservation postings written and `created_at` backdated so it
 * looks stuck. Extracted from `reconciliation.service.test.ts` — it is the only correct recipe,
 * and two copies would drift exactly where money correctness is asserted.
 */
export async function seedStuckTxn(createdAtIso: string): Promise<StuckTxn> {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: '1234567890',
    anchorBankCode: '058',
    anchorAccountId: `anchor-acct-${factories.idempotencyKey()}`,
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    kind: 'topup',
    amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(100_000n),
    },
  ]);
  const txn = await txnIntentService.create(testDb, {
    actorUserId: agent.id,
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n),
    idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M',
    category: null,
    agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  await ledgerService.writeDoubleEntry(testDb, txn.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(5_000n), creditKobo: kobo(0n) },
    {
      ledgerAccountId: mw.ledgerAccountIds.suspense,
      debitKobo: kobo(0n),
      creditKobo: kobo(5_000n),
    },
  ]);
  await testDb.execute(
    sql`UPDATE transactions SET created_at = ${createdAtIso}::timestamptz WHERE id = ${txn.id}`,
  );
  return {
    txnId: txn.id,
    idempotencyKey: txn.idempotencyKey,
    masterWalletId: mw.master.id,
    subWalletLedgerAccountId: sw.ledgerAccountId,
    suspenseLedgerAccountId: mw.ledgerAccountIds.suspense,
  };
}
```

Note the `anchorAccountId` is now unique per call — the original hard-coded `'anchor-acct-test'` is fine for one seed per test but this helper will be called twice in some Task 4 tests.

- [ ] **Step 2: Point the reconciliation test at the helper and prove it is faithful**

In `apps/backend/tests/modules/transactions/reconciliation.service.test.ts`, delete the local `seedStuckTxn` function and its now-unused imports, and add:

```ts
import { seedStuckTxn } from '../../helpers/stuck-txn';
```

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/reconciliation.service.test.ts`
Expected: all 5 tests PASS, unchanged. This is the verification that the extraction is faithful — if the helper is wrong, these go red.

- [ ] **Step 3: Write the failing schema test**

Create `apps/backend/tests/db/admin-elevations.schema.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminElevations } from '../../src/db/schema';
import { signedInAdmin } from '../helpers/admin-session';
import { seedStuckTxn } from '../helpers/stuck-txn';
import { testDb, truncateAll } from '../helpers/test-db';

describe('admin_elevations', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stores an elevation and defaults created_at and consumed_at', async () => {
    const { adminUserId } = await signedInAdmin('elev1@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    const [row] = await testDb
      .insert(adminElevations)
      .values({
        adminUserId,
        transactionId: txnId,
        reason: 'customer called, money stuck 2 days',
        expiresAt: new Date('2026-05-03T12:15:00Z'),
      })
      .returning();

    expect(row?.consumedAt).toBeNull();
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.reason).toBe('customer called, money stuck 2 days');
  });

  it('refuses an elevation with no reason', async () => {
    const { adminUserId } = await signedInAdmin('elev2@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    // Raw SQL on purpose: the typed insert will not let us omit a NOT NULL column, and the point
    // of this test is that the DATABASE refuses it, not that TypeScript does.
    await expect(
      testDb.execute(
        sql`INSERT INTO admin_elevations (admin_user_id, transaction_id, expires_at)
            VALUES (${adminUserId}::uuid, ${txnId}::uuid, now())`,
      ),
    ).rejects.toThrow(/null value in column "reason"/);
  });

  it('refuses an elevation pointing at a transaction that does not exist', async () => {
    const { adminUserId } = await signedInAdmin('elev3@amana-ng.com', ['owner']);

    await expect(
      testDb.insert(adminElevations).values({
        adminUserId,
        transactionId: '00000000-0000-0000-0000-000000000000',
        reason: 'no such txn',
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/admin_elevations_transaction_id_transactions_id_fk/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/db/admin-elevations.schema.test.ts`
Expected: FAIL — `adminElevations` is not exported from the schema (a TypeScript/import error, not an assertion failure).

- [ ] **Step 5: Add the table to the schema**

In `apps/backend/src/db/schema/admin.ts`, add `import { transactions } from './transactions';` and append:

```ts
/**
 * A single-use, transaction-scoped unlock of `money.operate` (sub-plan A1 Task 7).
 *
 * This table does NOT grant the permission — `owner` already holds it and `admin` never does.
 * It records that a holder opened a short window to use it against ONE transaction, and why.
 * Append-only like `admin_role_grants`: nothing is deleted, and the only update is the one-way
 * `consumed_at` write.
 */
export const adminElevations = pgTable(
  'admin_elevations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    /**
     * The ONE transaction this elevation authorises. Scoping to a row rather than a time window
     * means there is never a moment when an operator holds unscoped money power, and the audit
     * log answers "why did you have money power" with an id instead of prose.
     */
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    /** The operator's justification. Mandatory, and never written onto the transaction itself. */
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Set only after a settle or reverse SUCCEEDS. A failure leaves the elevation live so a retry
     * needs no fresh justification — single-use exists to stop one window covering several
     * actions, not to punish a transport error.
     */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => ({
    // The hot read is "is there a live elevation for this operator and this transaction".
    byTxnAdmin: index('admin_elevations_by_txn_admin').on(t.transactionId, t.adminUserId),
  }),
);
```

`onDelete: 'restrict'` on both FKs, matching the `granted_by_admin_user_id` rationale in `adminRoleGrants`: a record of who authorised a money movement must stay attached for as long as the record exists.

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @amana/backend exec drizzle-kit generate`
Expected: a new `0050_*.sql` plus updated `meta/_journal.json` and a new snapshot. Open the generated SQL and confirm it contains `CREATE TABLE "admin_elevations"`, both FK constraints, and the index. Do not edit it.

- [ ] **Step 7: Add the table to the truncate list**

In `apps/backend/tests/helpers/test-db.ts`, add `'admin_elevations',` to `TABLES_TO_TRUNCATE` (before the closing `] as const;` at line 60). Task 6 shipped a bug because a new table was missing from this list and rows leaked between tests.

- [ ] **Step 8: Apply migrations and run the test to verify it passes**

Run: `pnpm --filter @amana/backend db:migrate`
Run: `pnpm --filter @amana/backend exec vitest run tests/db/admin-elevations.schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Update the schema doc in this commit**

Edit `docs/technical/database-schema.md`: add an `admin_elevations` section describing the columns, the append-only rule, the single-use `consumed_at`, and the transaction scoping. **Increment the table-count claim in the same edit** — `tools/docs/validate_schema_doc.py` runs in CI and fails the build on a stale count or an undocumented table.

Run: `python3 tools/docs/validate_schema_doc.py`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/db apps/backend/tests docs/technical/database-schema.md
git commit -m "Add admin_elevations: a single-use, transaction-scoped unlock

Append-only, like admin_role_grants. The table records that a holder of
money.operate opened a window against ONE transaction and why; it grants
nothing, so admin remains unable to move money.

Extracts the in_flight-spend fixture out of the reconciliation test into a
shared helper. Keeping the recon suite green IS the proof the extraction is
faithful, and a second copy would drift exactly where postings are asserted."
```

---

### Task 2: `adminElevationsRepo`

**Files:**
- Create: `apps/backend/src/modules/admin/admin-elevations.repo.ts`
- Test: `apps/backend/tests/modules/admin/admin-elevations.repo.test.ts`

**Interfaces:**
- Consumes: `adminElevations` (Task 1).
- Produces:
  - `create(db, { adminUserId, transactionId, reason, expiresAt }): Promise<AdminElevationRow>`
  - `findLive(db, adminUserId, transactionId, now): Promise<AdminElevationRow | null>`
  - `markConsumed(db, id, now): Promise<AdminElevationRow | null>` — null when already consumed.
  - `type AdminElevationRow = typeof adminElevations.$inferSelect`

- [ ] **Step 1: Write the failing repo test**

Create `apps/backend/tests/modules/admin/admin-elevations.repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { adminElevationsRepo } from '../../../src/modules/admin/admin-elevations.repo';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-05-03T12:00:00Z');
const in15Min = new Date('2026-05-03T12:15:00Z');

describe('adminElevationsRepo', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('finds a live elevation for the operator and transaction that own it', async () => {
    const { adminUserId } = await signedInAdmin('r1@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'stuck two days',
      expiresAt: in15Min,
    });

    const live = await adminElevationsRepo.findLive(testDb, adminUserId, txnId, NOW);

    expect(live).not.toBeNull();
    expect(live?.reason).toBe('stuck two days');
  });

  it('does not find an expired elevation', async () => {
    const { adminUserId } = await signedInAdmin('r2@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'expired',
      expiresAt: new Date('2026-05-03T11:59:59Z'),
    });

    expect(await adminElevationsRepo.findLive(testDb, adminUserId, txnId, NOW)).toBeNull();
  });

  it('does not find a consumed elevation', async () => {
    const { adminUserId } = await signedInAdmin('r3@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    const row = await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'used already',
      expiresAt: in15Min,
    });
    await adminElevationsRepo.markConsumed(testDb, row.id, NOW);

    expect(await adminElevationsRepo.findLive(testDb, adminUserId, txnId, NOW)).toBeNull();
  });

  // Scoping is the whole security property: an elevation is authority over ONE row.
  it('does not find an elevation raised for a different transaction', async () => {
    const { adminUserId } = await signedInAdmin('r4@amana-ng.com', ['owner']);
    const a = await seedStuckTxn('2026-05-03T11:00:00Z');
    const b = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: a.txnId,
      reason: 'for A only',
      expiresAt: in15Min,
    });

    expect(await adminElevationsRepo.findLive(testDb, adminUserId, b.txnId, NOW)).toBeNull();
  });

  it('does not find a colleague elevation raised for the same transaction', async () => {
    const mine = await signedInAdmin('r5@amana-ng.com', ['owner']);
    const theirs = await signedInAdmin('r6@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId: theirs.adminUserId,
      transactionId: txnId,
      reason: 'their elevation',
      expiresAt: in15Min,
    });

    expect(await adminElevationsRepo.findLive(testDb, mine.adminUserId, txnId, NOW)).toBeNull();
  });

  // The `consumed_at IS NULL` predicate on the update is a concurrency guard: two resolves racing
  // must not both consume the same authorisation.
  it('consumes an elevation once and never twice', async () => {
    const { adminUserId } = await signedInAdmin('r7@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');
    const row = await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: txnId,
      reason: 'once',
      expiresAt: in15Min,
    });

    const first = await adminElevationsRepo.markConsumed(testDb, row.id, NOW);
    const second = await adminElevationsRepo.markConsumed(testDb, row.id, NOW);

    expect(first?.consumedAt).not.toBeNull();
    expect(second).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/admin/admin-elevations.repo.test.ts`
Expected: FAIL — cannot resolve `admin-elevations.repo`.

- [ ] **Step 3: Write the repo**

Create `apps/backend/src/modules/admin/admin-elevations.repo.ts`:

```ts
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { adminElevations } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type AdminElevationRow = typeof adminElevations.$inferSelect;

export type CreateElevationInput = {
  adminUserId: string;
  transactionId: string;
  reason: string;
  expiresAt: Date;
};

export const adminElevationsRepo = {
  async create(db: DbOrTx, input: CreateElevationInput): Promise<AdminElevationRow> {
    const [row] = await db.insert(adminElevations).values(input).returning();
    // `noUncheckedIndexedAccess` makes this `T | undefined`; an insert that returns nothing is a
    // bug, not an empty result.
    if (!row) throw new Error('admin_elevations insert returned no row');
    return row;
  },

  /**
   * The liveness lookup: unconsumed, unexpired, and belonging to BOTH this operator and this
   * transaction. All four predicates are load-bearing — dropping any one of them turns a scoped
   * single-use authorisation into something broader.
   */
  async findLive(
    db: DbOrTx,
    adminUserId: string,
    transactionId: string,
    now: Date,
  ): Promise<AdminElevationRow | null> {
    const [row] = await db
      .select()
      .from(adminElevations)
      .where(
        and(
          eq(adminElevations.adminUserId, adminUserId),
          eq(adminElevations.transactionId, transactionId),
          isNull(adminElevations.consumedAt),
          gt(adminElevations.expiresAt, now),
        ),
      )
      .orderBy(desc(adminElevations.createdAt))
      .limit(1);
    return row ?? null;
  },

  /**
   * Consume it. The `consumed_at IS NULL` predicate is a concurrency guard: two resolves racing on
   * one authorisation must not both succeed, so the loser gets null and refuses.
   */
  async markConsumed(db: DbOrTx, id: string, now: Date): Promise<AdminElevationRow | null> {
    const [row] = await db
      .update(adminElevations)
      .set({ consumedAt: now })
      .where(and(eq(adminElevations.id, id), isNull(adminElevations.consumedAt)))
      .returning();
    return row ?? null;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/admin/admin-elevations.repo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/admin/admin-elevations.repo.ts apps/backend/tests/modules/admin/admin-elevations.repo.test.ts
git commit -m "Add adminElevationsRepo with a scoped liveness lookup

findLive requires all four of: this operator, this transaction, unconsumed,
unexpired. Each predicate is tested by removing the thing it protects --
a colleague's elevation and an elevation for a neighbouring transaction are
both invisible.

markConsumed carries consumed_at IS NULL so two racing resolves cannot both
spend one authorisation."
```

---

### Task 3: Elevation grant, refusal errors, config, audit events

**Files:**
- Create: `apps/backend/src/modules/admin/money-ops.service.ts`
- Modify: `apps/backend/src/env.ts`
- Modify: `apps/backend/src/modules/audit/events.ts`
- Test: `apps/backend/tests/modules/admin/money-ops.elevation.test.ts`

**Interfaces:**
- Consumes: `adminElevationsRepo` (Task 2), `auditRepo.append`, `env`.
- Produces:
  - `class MoneyOpsError extends Error { readonly code: MoneyOpsRefusal; readonly httpStatus: number }`
  - `type MoneyOpsRefusal = 'elevation_required' | 'elevation_expired' | 'not_stuck' | 'too_early' | 'still_pending' | 'anchor_unreachable'`
  - `moneyOpsService.grantElevation(db, { actorAdminUserId, transactionId, reason, now }): Promise<{ elevationId: string; expiresAt: Date }>`

- [ ] **Step 1: Add the three settings**

In `apps/backend/src/env.ts`, beside the `SUPPORT_*` block (lines 61-67):

```ts
    MONEY_ELEVATION_SECONDS: z.coerce.number().int().positive().default(900),
    /**
     * Below this age a transaction belongs to the reconciliation sweep, whose own threshold is 5
     * minutes. This MUST stay above it so automation gets several passes before a human may act.
     */
    STUCK_TXN_MIN_AGE_SECONDS: z.coerce.number().int().positive().default(900),
    /**
     * How old a transaction with NO Anchor record must be before it may be force-reversed. Long on
     * purpose: this is the only path where money moves without counterparty confirmation.
     */
    STUCK_TXN_FORCE_REVERSE_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
```

- [ ] **Step 2: Write the failing elevation test**

Create `apps/backend/tests/modules/admin/money-ops.elevation.test.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../../src/db/schema';
import { moneyOpsService } from '../../../src/modules/admin/money-ops.service';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-05-03T12:00:00Z');

describe('moneyOpsService.grantElevation', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('records an elevation with an expiry derived from config', async () => {
    const { adminUserId } = await signedInAdmin('e1@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    const out = await moneyOpsService.grantElevation(testDb, {
      actorAdminUserId: adminUserId,
      transactionId: txnId,
      reason: 'customer called; money stuck since Tuesday',
      now: NOW,
    });

    expect(out.elevationId).toBeTruthy();
    // Default MONEY_ELEVATION_SECONDS is 900.
    expect(out.expiresAt.getTime()).toBe(NOW.getTime() + 900_000);
  });

  it('audits the grant with the reason in the payload', async () => {
    const { adminUserId } = await signedInAdmin('e2@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    await moneyOpsService.grantElevation(testDb, {
      actorAdminUserId: adminUserId,
      transactionId: txnId,
      reason: 'audited reason',
      now: NOW,
    });

    const rows = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'money.elevation_granted'), eq(auditLog.subjectId, txnId)));

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.payloadJson)).toContain('audited reason');
  });

  it('refuses a blank reason', async () => {
    const { adminUserId } = await signedInAdmin('e3@amana-ng.com', ['owner']);
    const { txnId } = await seedStuckTxn('2026-05-03T11:00:00Z');

    await expect(
      moneyOpsService.grantElevation(testDb, {
        actorAdminUserId: adminUserId,
        transactionId: txnId,
        reason: '   ',
        now: NOW,
      }),
    ).rejects.toThrow(/reason/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/admin/money-ops.elevation.test.ts`
Expected: FAIL — cannot resolve `money-ops.service`.

- [ ] **Step 4: Add the audit events**

In `apps/backend/src/modules/audit/events.ts`, following the existing `admin.*` helpers, add builders for the five actions: `money.elevation_granted`, `money.resolve_settled`, `money.resolve_reversed`, `money.force_reversed`, `money.resolve_refused`. Match the surrounding style exactly — `actorKind: 'ops'`, `subjectKind: 'transaction'`, `subjectId: <transaction uuid>`. `audit_log.subject_id` is a uuid column, so the subject is always the transaction, never a free-text label.

- [ ] **Step 5: Write the service's elevation half**

Create `apps/backend/src/modules/admin/money-ops.service.ts`:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../env';
import { auditRepo } from '../audit';
import { adminElevationsRepo } from './admin-elevations.repo';

type DbOrTx = PostgresJsDatabase;

/** Every way this surface can say no. The route maps each to a status; nothing else refuses. */
export type MoneyOpsRefusal =
  | 'elevation_required'
  | 'elevation_expired'
  | 'not_stuck'
  | 'too_early'
  | 'still_pending'
  | 'anchor_unreachable';

const REFUSAL_STATUS: Record<MoneyOpsRefusal, 403 | 409 | 503> = {
  elevation_required: 403,
  elevation_expired: 403,
  not_stuck: 409,
  too_early: 409,
  still_pending: 409,
  anchor_unreachable: 503,
};

export class MoneyOpsError extends Error {
  readonly httpStatus: 403 | 409 | 503;
  constructor(readonly code: MoneyOpsRefusal) {
    super(`money operation refused: ${code}`);
    this.name = 'MoneyOpsError';
    this.httpStatus = REFUSAL_STATUS[code];
  }
}

export type GrantElevationInput = {
  actorAdminUserId: string;
  transactionId: string;
  reason: string;
  now: Date;
};

export const moneyOpsService = {
  /**
   * Open a window in which an operator who ALREADY holds `money.operate` may use it against one
   * transaction. The caller has verified the permission; this function never widens anyone's
   * access, which is why an `admin` cannot reach the operation by obtaining one of these rows.
   *
   * State rules deliberately live in `resolveStuckTransaction`, not here: one place decides
   * whether a transaction may be touched, so the two cannot drift. An elevation raised against a
   * transaction that turns out not to be stuck simply gets refused at resolve time.
   */
  async grantElevation(
    db: DbOrTx,
    input: GrantElevationInput,
  ): Promise<{ elevationId: string; expiresAt: Date }> {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new Error('elevation reason is required');

    const expiresAt = new Date(input.now.getTime() + env.MONEY_ELEVATION_SECONDS * 1000);
    const row = await adminElevationsRepo.create(db, {
      adminUserId: input.actorAdminUserId,
      transactionId: input.transactionId,
      reason,
      expiresAt,
    });

    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action: 'money.elevation_granted',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: { reason, expiresAt: expiresAt.toISOString() },
    });

    return { elevationId: row.id, expiresAt };
  },
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/admin/money-ops.elevation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/src/modules/admin/money-ops.service.ts apps/backend/src/modules/audit/events.ts apps/backend/tests/modules/admin/money-ops.elevation.test.ts
git commit -m "Add elevation grants, refusal codes and money audit events

grantElevation deliberately checks no transaction state. Resolve owns every
state rule so there is exactly one place that decides whether a transaction
may be touched; a second copy would drift. The cost is a wasted reason when
an operator elevates against a settled row, which resolve then refuses.

MoneyOpsError carries the code AND the status so the route maps refusals
without a second table of its own."
```

---

### Task 4: `resolveStuckTransaction` — the decision table

**Files:**
- Modify: `apps/backend/src/modules/admin/money-ops.service.ts`
- Modify: `docs/runbook/admin-portal.md`
- Test: `apps/backend/tests/modules/admin/money-ops.resolve.test.ts`

**Interfaces:**
- Consumes: `adminElevationsRepo`, `transactionsRepo.findById`, `settlementService.finalise`, `reversalService.reverse`, `AnchorAdapter`.
- Produces:
  - `moneyOpsService.resolveStuckTransaction(db, adapter, { actorAdminUserId, transactionId, now }): Promise<{ outcome: 'settled' | 'reversed' }>`
  - `moneyOpsService.listStuck(db, now): Promise<StuckRow[]>`
- The adapter is a **parameter**, matching `reconciliationService.sweep(db, adapter, now)` and `redeemService.redeem(db, anchorAdapterSingleton, …)`. Tests pass a fake built from a fake `fetchImpl`; the route passes `anchorAdapterSingleton`.

- [ ] **Step 1: Write the failing resolve tests**

Create `apps/backend/tests/modules/admin/money-ops.resolve.test.ts`. The fake adapter is built at the **fetch** layer so the real adapter's 404→null and throw-on-error logic is exercised rather than stubbed — that is what makes case 6 meaningful.

```ts
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog } from '../../../src/db/schema';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { adminElevationsRepo } from '../../../src/modules/admin/admin-elevations.repo';
import { MoneyOpsError, moneyOpsService } from '../../../src/modules/admin/money-ops.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { signedInAdmin } from '../../helpers/admin-session';
import { seedStuckTxn } from '../../helpers/stuck-txn';
import { testDb, truncateAll } from '../../helpers/test-db';

const NOW = new Date('2026-05-03T12:00:00Z');
/** 1h old: past the 15-minute min age, well short of the 24h force threshold. */
const HOUR_OLD = '2026-05-03T11:00:00Z';
/** 3 days old: past the force threshold. */
const ANCIENT = '2026-04-30T12:00:00Z';

const adapterFor = (fetchImpl: typeof fetch): AnchorAdapter =>
  new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });

const jsonOnce = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

async function elevateFor(adminUserId: string, transactionId: string) {
  return adminElevationsRepo.create(testDb, {
    adminUserId,
    transactionId,
    reason: 'customer called',
    expiresAt: new Date(NOW.getTime() + 900_000),
  });
}

const countPostings = async (transactionId: string) =>
  (await postingsRepo.listByTransaction(testDb, transactionId)).length;

describe('moneyOpsService.resolveStuckTransaction', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('settles when Anchor reports COMPLETED', async () => {
    const { adminUserId } = await signedInAdmin('m1@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({
          id: 'tr-1',
          status: 'COMPLETED',
          reference: stuck.idempotencyKey,
          nibssSessionId: '777',
        }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    expect(out.outcome).toBe('settled');
    expect((await transactionsRepo.findById(testDb, stuck.txnId))?.status).toBe('settled');
  });

  it('reverses when Anchor reports FAILED, returning the money', async () => {
    const { adminUserId } = await signedInAdmin('m2@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({
          id: 'tr-1',
          status: 'FAILED',
          reference: stuck.idempotencyKey,
          failureReason: 'recipient closed',
        }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    expect(out.outcome).toBe('reversed');
    expect((await transactionsRepo.findById(testDb, stuck.txnId))?.status).toBe('failed');
  });

  it('refuses a transaction Anchor still reports as PENDING, and writes no postings', async () => {
    const { adminUserId } = await signedInAdmin('m3@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);
    const before = await countPostings(stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ id: 'tr-1', status: 'PENDING', reference: stuck.idempotencyKey })),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'still_pending' });

    expect(await countPostings(stuck.txnId)).toBe(before);
  });

  it('force-reverses an ancient transaction Anchor has no record of, and audits it distinctly', async () => {
    const { adminUserId } = await signedInAdmin('m4@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(ANCIENT);
    await elevateFor(adminUserId, stuck.txnId);

    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(jsonOnce({ error: 'not_found' }, 404)),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    expect(out.outcome).toBe('reversed');
    const audits = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'money.force_reversed'), eq(auditLog.subjectId, stuck.txnId)));
    expect(audits).toHaveLength(1);
  });

  it('refuses to force-reverse a transaction that is not old enough', async () => {
    const { adminUserId } = await signedInAdmin('m5@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ error: 'not_found' }, 404)),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'too_early' });
  });

  // THE test. An Anchor outage must never be laundered into a reversal, even on an ancient row
  // where the force path would otherwise fire.
  it('refuses when the Anchor call fails, and never force-reverses on an error', async () => {
    const { adminUserId } = await signedInAdmin('m6@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(ANCIENT);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ error: 'boom' }, 500)),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'anchor_unreachable' });

    expect((await transactionsRepo.findById(testDb, stuck.txnId))?.status).toBe('in_flight');
  });

  it('leaves the elevation live when the Anchor call fails, so a retry needs no new reason', async () => {
    const { adminUserId } = await signedInAdmin('m7@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ error: 'boom' }, 500)),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toBeInstanceOf(MoneyOpsError);

    expect(
      await adminElevationsRepo.findLive(testDb, adminUserId, stuck.txnId, NOW),
    ).not.toBeNull();

    // And the retry succeeds without a fresh elevation.
    const out = await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({ id: 'tr-1', status: 'FAILED', reference: stuck.idempotencyKey }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );
    expect(out.outcome).toBe('reversed');
  });

  it('consumes the elevation on success, so a second resolve is refused', async () => {
    const { adminUserId } = await signedInAdmin('m8@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);
    const adapter = adapterFor(
      jsonOnce({ id: 'tr-1', status: 'FAILED', reference: stuck.idempotencyKey }),
    );
    const input = { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW };

    await moneyOpsService.resolveStuckTransaction(testDb, adapter, input);
    const postingsAfterFirst = await countPostings(stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(testDb, adapter, input),
    ).rejects.toMatchObject({ code: 'elevation_required' });

    // The money moved exactly once.
    expect(await countPostings(stuck.txnId)).toBe(postingsAfterFirst);
  });

  it('refuses with no elevation at all', async () => {
    const { adminUserId } = await signedInAdmin('m9@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(vi.fn()),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('refuses on an expired elevation', async () => {
    const { adminUserId } = await signedInAdmin('m10@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: stuck.txnId,
      reason: 'stale',
      expiresAt: new Date(NOW.getTime() - 1000),
    });

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(vi.fn()),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('refuses an elevation raised for a different transaction', async () => {
    const { adminUserId } = await signedInAdmin('m11@amana-ng.com', ['owner']);
    const a = await seedStuckTxn(HOUR_OLD);
    const b = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, a.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(vi.fn()),
        { actorAdminUserId: adminUserId, transactionId: b.txnId, now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('refuses a transaction that is too young, without calling Anchor', async () => {
    const { adminUserId } = await signedInAdmin('m12@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn('2026-05-03T11:58:00Z'); // 2 minutes old
    await elevateFor(adminUserId, stuck.txnId);
    const fetchSpy = vi.fn();

    await expect(
      moneyOpsService.resolveStuckTransaction(testDb, adapterFor(fetchSpy), {
        actorAdminUserId: adminUserId,
        transactionId: stuck.txnId,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'too_early' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['settled', 'failed', 'reversed'] as const)(
    'refuses a transaction already in terminal status %s',
    async (status) => {
      const { adminUserId } = await signedInAdmin(`m13${status}@amana-ng.com`, ['owner']);
      const stuck = await seedStuckTxn(HOUR_OLD);
      await elevateFor(adminUserId, stuck.txnId);
      await transactionsRepo.setStatus(testDb, stuck.txnId, status);

      await expect(
        moneyOpsService.resolveStuckTransaction(testDb, adapterFor(vi.fn()), {
          actorAdminUserId: adminUserId,
          transactionId: stuck.txnId,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: 'not_stuck' });
    },
  );

  it('audits every refusal with its reason code', async () => {
    const { adminUserId } = await signedInAdmin('m14@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await elevateFor(adminUserId, stuck.txnId);

    await expect(
      moneyOpsService.resolveStuckTransaction(
        testDb,
        adapterFor(jsonOnce({ id: 'tr-1', status: 'PENDING', reference: stuck.idempotencyKey })),
        { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
      ),
    ).rejects.toBeInstanceOf(MoneyOpsError);

    const audits = await testDb
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, 'money.resolve_refused'), eq(auditLog.subjectId, stuck.txnId)),
      );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.payloadJson)).toContain('still_pending');
  });

  it('never writes the operator reason onto the transaction record', async () => {
    const { adminUserId } = await signedInAdmin('m15@amana-ng.com', ['owner']);
    const stuck = await seedStuckTxn(HOUR_OLD);
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: stuck.txnId,
      reason: 'OPERATOR_SECRET_NOTE',
      expiresAt: new Date(NOW.getTime() + 900_000),
    });

    await moneyOpsService.resolveStuckTransaction(
      testDb,
      adapterFor(
        jsonOnce({
          id: 'tr-1',
          status: 'FAILED',
          reference: stuck.idempotencyKey,
          failureReason: 'recipient closed',
        }),
      ),
      { actorAdminUserId: adminUserId, transactionId: stuck.txnId, now: NOW },
    );

    // This is why the rule is load-bearing, not cosmetic: `reverse` calls
    // `transactionsRepo.setErrorMessage(txn.id, input.reason)` (reversal.service.ts:75-76), so
    // whatever is passed as `reason` is written onto the ORIGINAL transaction's error_message.
    // Passing the operator's justification there would persist internal staff notes on a
    // customer's transaction record.
    const original = await transactionsRepo.findById(testDb, stuck.txnId);
    expect(JSON.stringify(original)).not.toContain('OPERATOR_SECRET_NOTE');
    expect(JSON.stringify(original)).toContain('recipient closed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/admin/money-ops.resolve.test.ts`
Expected: FAIL — `resolveStuckTransaction` is not a function.

- [ ] **Step 3: Implement the decision table**

Append to `apps/backend/src/modules/admin/money-ops.service.ts` (and extend the imports):

```ts
import { and, asc, eq, lt } from 'drizzle-orm';
import { transactions } from '../../db/schema';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { reversalService } from '../transactions/reversal.service';
import { settlementService } from '../transactions/settlement.service';
import { transactionsRepo } from '../wallet/transactions.repo';

/** The reverse reason recorded when Anchor has no record at all. Not the operator's words. */
const NO_ANCHOR_RECORD_REASON = 'no Anchor record past the force-reverse threshold';

export type ResolveInput = {
  actorAdminUserId: string;
  transactionId: string;
  now: Date;
};
```

Add to the `moneyOpsService` object:

```ts
  /** The stuck queue: `in_flight` spends old enough that a human may look at them. */
  async listStuck(db: DbOrTx, now: Date) {
    const cutoff = new Date(now.getTime() - env.STUCK_TXN_MIN_AGE_SECONDS * 1000);
    return db
      .select({
        id: transactions.id,
        amountKobo: transactions.amountKobo,
        createdAt: transactions.createdAt,
        vendorResolvedName: transactions.vendorResolvedName,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'in_flight'),
          eq(transactions.kind, 'spend'),
          lt(transactions.createdAt, cutoff),
        ),
      )
      .orderBy(asc(transactions.createdAt));
  },

  /**
   * Resolve one stuck transaction by asking Anchor what happened and applying the answer.
   *
   * The operator supplies authority and a reason; Anchor supplies the outcome. Settlement and
   * reversal go through the SAME functions the reconciliation cron calls, so the manual and
   * automated paths cannot drift, and concurrency is already handled: both take
   * `SELECT … FOR UPDATE` and refuse a non-`in_flight` row.
   */
  async resolveStuckTransaction(
    db: DbOrTx,
    adapter: AnchorAdapter,
    input: ResolveInput,
  ): Promise<{ outcome: 'settled' | 'reversed' }> {
    const refuse = async (code: MoneyOpsRefusal): Promise<MoneyOpsError> => {
      await auditRepo.append(db, {
        actorKind: 'ops',
        actorAdminUserId: input.actorAdminUserId,
        action: 'money.resolve_refused',
        subjectKind: 'transaction',
        subjectId: input.transactionId,
        payloadJson: { code },
      });
      return new MoneyOpsError(code);
    };

    const elevation = await adminElevationsRepo.findLive(
      db,
      input.actorAdminUserId,
      input.transactionId,
      input.now,
    );
    if (!elevation) throw await refuse('elevation_required');

    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn || txn.status !== 'in_flight') throw await refuse('not_stuck');

    const minAgeCutoff = new Date(input.now.getTime() - env.STUCK_TXN_MIN_AGE_SECONDS * 1000);
    if (txn.createdAt >= minAgeCutoff) throw await refuse('too_early');

    let remote: Awaited<ReturnType<AnchorAdapter['findTransferByReference']>>;
    try {
      remote = await adapter.findTransferByReference(txn.idempotencyKey);
    } catch {
      // A failed call is NOT an absent record. Treating it as one would let an Anchor outage
      // trigger reversals for transfers that actually completed.
      throw await refuse('anchor_unreachable');
    }

    const settle = async () => {
      await settlementService.finalise(db, {
        transactionId: txn.id,
        nibssSessionId: remote?.nibssSessionId ?? null,
        settledAt: input.now,
      });
      return 'money.resolve_settled' as const;
    };
    const reverse = async (reason: string | null, action: 'money.resolve_reversed' | 'money.force_reversed') => {
      await reversalService.reverse(db, {
        transactionId: txn.id,
        reason,
        failedAt: input.now,
      });
      return action;
    };

    let action: 'money.resolve_settled' | 'money.resolve_reversed' | 'money.force_reversed';
    let outcome: 'settled' | 'reversed';

    if (remote === null) {
      const forceCutoff = new Date(
        input.now.getTime() - env.STUCK_TXN_FORCE_REVERSE_AGE_SECONDS * 1000,
      );
      if (txn.createdAt >= forceCutoff) throw await refuse('too_early');
      // Reverse ONLY. This path can never settle, so a wrong call here can never pay a vendor
      // twice — it can only return money to the customer.
      action = await reverse(NO_ANCHOR_RECORD_REASON, 'money.force_reversed');
      outcome = 'reversed';
    } else if (remote.status === 'COMPLETED') {
      action = await settle();
      outcome = 'settled';
    } else if (remote.status === 'FAILED') {
      // Anchor's reason, not the operator's: a manually resolved reversal must be
      // indistinguishable from an automatic one on the transaction record.
      action = await reverse(remote.failureReason ?? null, 'money.resolve_reversed');
      outcome = 'reversed';
    } else {
      throw await refuse('still_pending');
    }

    // Only now, after the money has actually moved.
    await adminElevationsRepo.markConsumed(db, elevation.id, input.now);
    await auditRepo.append(db, {
      actorKind: 'ops',
      actorAdminUserId: input.actorAdminUserId,
      action,
      subjectKind: 'transaction',
      subjectId: txn.id,
      payloadJson: { elevationId: elevation.id, anchorStatus: remote?.status ?? 'no_record' },
    });

    return { outcome };
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/admin/money-ops.resolve.test.ts`
Expected: PASS. If the `it.each` terminal-status case fails for `reversed`, check whether `setStatus` permits that transition directly; if not, reach the state through `reversalService.reverse` instead of `setStatus`.

- [ ] **Step 5: Write the runbook entry in this commit**

Edit `docs/runbook/admin-portal.md` — this is the page an owner reads at 02:00. It must state:
- how to find a stuck transaction and what "stuck" means (in_flight, `kind='spend'`, older than 15 minutes);
- that the sweep handles most of these automatically within minutes, so a row appearing here means the sweep gave up;
- that the operator does not choose the outcome;
- **what the force path risks, in plain words:** if Anchor processed the transfer but its by-reference lookup cannot find it, a force-reverse credits the customer for money that also left the account — so do not force a reverse to "clear the queue";
- that `anchor_unreachable` means stop and check Anchor status, not retry in a loop.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/admin/money-ops.service.ts apps/backend/tests/modules/admin/money-ops.resolve.test.ts docs/runbook/admin-portal.md
git commit -m "Resolve stuck transactions by asking Anchor, not the operator

Calls the same finalise/reverse the cron calls, so the manual path inherits
their SELECT FOR UPDATE status guards and writes no postings of its own.

A thrown adapter error is refused as anchor_unreachable and never read as
absence -- tested on an ancient row where the force path would otherwise
fire, because that is the case where an outage could have become a reversal.
The force path can reverse but never settle.

consumed_at is written only after the money moves, so a transport failure
leaves the authorisation usable and a retry needs no new reason."
```

---

### Task 5: The three endpoints

**Files:**
- Create: `apps/backend/src/routes/admin/money.ts`
- Modify: `apps/backend/src/server.ts`
- Modify: `docs/business/RRD.md`, `docs/APP-FLOW.md`
- Test: `apps/backend/tests/routes/admin/money.test.ts`

**Interfaces:**
- Consumes: `moneyOpsService`, `MoneyOpsError`, `adminIamService.requirePermission`, `adminSession()`, `parseBody`/`parseParams`, `anchorAdapterSingleton`.
- Produces: `adminMoneyRoute`, mounted at `/admin/money`.

- [ ] **Step 1: Write the failing route tests**

Create `apps/backend/tests/routes/admin/money.test.ts`. Cover: `owner` can list; **`admin` is refused 403 on every endpoint even with an elevation row present** (the invariant-3 assertion); `ops` refused; unauthenticated 401; malformed uuid 400; blank reason 400; resolve without elevation 403 with `{error:'elevation_required'}`; a `still_pending` refusal surfaces 409; `anchor_unreachable` surfaces 503. Follow `tests/routes/admin/support.test.ts` exactly for `signedInAdmin` + cookie usage.

The invariant test, written out because it is the one that must not be paraphrased:

```ts
  it('refuses an admin even when an elevation row exists for the transaction', async () => {
    const { cookie, adminUserId } = await signedInAdmin('mx@amana-ng.com', ['admin']);
    const stuck = await seedStuckTxn('2026-05-03T11:00:00Z');
    await adminElevationsRepo.create(testDb, {
      adminUserId,
      transactionId: stuck.txnId,
      reason: 'should not help',
      expiresAt: new Date(Date.now() + 900_000),
    });

    const res = await app.request(`/admin/money/transactions/${stuck.txnId}/resolve`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
    });

    // Elevation unlocks a held permission; it never grants one. `admin` does not hold
    // money.operate, so no elevation can make this reachable.
    expect(res.status).toBe(403);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin/money.test.ts`
Expected: FAIL — 404 from an unmounted route.

- [ ] **Step 3: Write the route**

Create `apps/backend/src/routes/admin/money.ts`, following `routes/admin/support.ts`: `new Hono<{ Variables: AdminActorVariables }>().use('*', adminSession())`, `c.get('adminActor')`, `requirePermission(db, actor.adminUserId, 'money.operate')`, `parseBody`/`parseParams` returning early on `Response`. Pass `anchorAdapterSingleton` into the service. Map refusals in one place:

```ts
  } catch (e) {
    if (e instanceof MoneyOpsError) return c.json({ error: e.code }, e.httpStatus);
    throw e;
  }
```

Body schema: `z.object({ transactionId: z.string().uuid(), reason: z.string().trim().min(10).max(500) })`. A ten-character floor keeps "fix" out of the audit log while staying typable at 02:00.

- [ ] **Step 4: Mount it**

In `apps/backend/src/server.ts`, import `adminMoneyRoute` alongside the other admin routes (~line 13) and mount beside `/admin/support` (~line 279):

```ts
  app.route('/admin/money', adminMoneyRoute);
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin/money.test.ts`
Expected: PASS.

- [ ] **Step 6: Update RRD and APP-FLOW in this commit**

`docs/business/RRD.md`: new IAM requirements (continue the IAM-NN numbering after IAM-26) covering elevation, scoping, single use, the force threshold, and refusal auditing. `docs/APP-FLOW.md`: a new subsection after §9.8 walking the operator flow including every refusal path.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/admin/money.ts apps/backend/src/server.ts apps/backend/tests/routes/admin/money.test.ts docs/business/RRD.md docs/APP-FLOW.md
git commit -m "Expose the stuck queue, elevation and resolve endpoints

Thin: the route takes the actor from the session and decides nothing. One
catch maps MoneyOpsError to the status it already carries, so refusal codes
live in exactly one place.

Asserts that an admin with a valid elevation row is still refused -- the
property that elevation unlocks rather than grants, tested rather than
assumed."
```

---

### Task 6: The portal page

**Files:**
- Create: `apps/admin-portal/app/(portal)/money/page.tsx`, `apps/admin-portal/app/(portal)/money/page.test.tsx`
- Modify: `apps/admin-portal/lib/api.ts`, `apps/admin-portal/lib/types.ts`, `apps/admin-portal/components/Rail.tsx`
- Modify: `docs/UI-UX-DESIGN-BRIEF.md`

**Interfaces:**
- Consumes: `api.money.*`, `can(me, 'money.operate')`, `ApiError`, `errorMessage`, the existing `Countdown` pattern from the support page.
- Produces: the `/money` route.

- [ ] **Step 1: Add types and the api namespace**

`lib/types.ts`:

```ts
export type StuckTransaction = {
  id: string;
  amountKobo: string;
  createdAt: string;
  vendorResolvedName: string | null;
};
export type Elevation = { elevationId: string; expiresAt: string };
export type ResolveOutcome = { outcome: 'settled' | 'reversed' };
```

`lib/api.ts`, a `money` namespace beside `support`:

```ts
  money: {
    stuck: () => request<{ transactions: StuckTransaction[] }>('/admin/money/stuck'),
    elevate: (transactionId: string, reason: string) =>
      request<Elevation>('/admin/money/elevations', {
        method: 'POST',
        body: JSON.stringify({ transactionId, reason }),
      }),
    resolve: (id: string) =>
      request<ResolveOutcome>(`/admin/money/transactions/${id}/resolve`, { method: 'POST' }),
  },
```

- [ ] **Step 2: Write the failing page test**

Create `page.test.tsx` following `app/(portal)/support/page.test.tsx`. Assert: the page refuses to render controls without `money.operate`; the elevate button is disabled until a reason of at least 10 characters is typed; a live elevation shows a countdown; **the page never offers a settle-or-reverse choice**; each refusal code renders its own copy (`elevation_required`, `too_early`, `still_pending`, `anchor_unreachable`), with `anchor_unreachable` telling the operator to check Anchor rather than retry.

- [ ] **Step 3: Run to verify it fails, then write the page**

Run: `pnpm --filter @amana/admin-portal exec vitest run app/\(portal\)/money/page.test.tsx`
Expected: FAIL (no such module). Then write `page.tsx`: the stuck list with `naira()` amounts and ages, an elevate dialog whose submit is disabled until the reason is long enough, a `Countdown` on the live elevation, and a single **Resolve** action. Copy states that Anchor decides the outcome and the operator authorises the attempt. Re-run until green.

- [ ] **Step 4: Add the nav entry**

`components/Rail.tsx`, beside the Support entry (line 17):

```ts
  { href: '/money', label: 'Money', needs: ['money.operate'] },
```

- [ ] **Step 5: Update the UI/UX brief in this commit**

`docs/UI-UX-DESIGN-BRIEF.md`: a new subsection after §10.5 for the stuck queue, the elevate dialog, and the refusal copy. State the rule that the page never presents an outcome choice.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-portal docs/UI-UX-DESIGN-BRIEF.md
git commit -m "Add the stuck-transaction page behind money.operate

The page offers no outcome choice, because there is none to offer: Anchor
decides and the operator authorises. Refusals get specific copy --
anchor_unreachable tells the operator to check Anchor rather than retry,
since a retry loop against a down partner is the wrong instinct at 2am."
```

---

### Task 7: Close out sub-plan A1

**Files:**
- Modify: `docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md`
- Modify: `docs/product/README.md`

- [ ] **Step 1: Run every gate, serially**

Run each to completion before starting the next — concurrent runs against the shared test database cause FK violations that look like real failures:

```bash
pnpm --filter @amana/backend test
pnpm --filter @amana/admin-portal test
pnpm --filter @amana/backend typecheck
pnpm --filter @amana/admin-portal typecheck
pnpm exec biome check .
python3 -m unittest discover -s tools/docs
python3 tools/docs/validate_schema_doc.py
python3 tools/docs/validate-tables.py
```

`pnpm exec biome check .` must exit 0 — check the exit code, not the summary tail. Biome truncates at 20 diagnostics and that truncation hid a real error in Task 6.

- [ ] **Step 2: Close out the sub-plan and the index**

Mark Task 7 complete and sub-plan A1 **complete** in the A1 plan doc. In `docs/product/README.md`, make the statuses and dates true, and add the named follow-up from spec §11: stuck non-`spend` transactions are never reconciled at all, because the sweep filters `kind: 'spend'`.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "Close sub-plan A1: admin portal and IAM complete

Records the gap this task deliberately did not close: the sweep filters
kind='spend', so stuck top-ups, VAS and marketplace purchases are never
reconciled at all. Re-query-Anchor is the wrong rule for an inbound credit
or a third-party fulfilment leg, so it needs its own design."
```

---

## Self-Review

**Spec coverage.** §3 Decision 1 → Task 4 `listStuck` + Task 6. Decision 2 → Task 3 (mandatory reason, expiry) with no approvals table touched. Decision 3 → Task 4 decision table. Decision 4 → Task 5 invariant test. Decision 5 → Task 2 scoping tests. §4 data model → Task 1. §5 operation → Task 4. §6 API → Task 5. §7 audit → Tasks 3 and 4. §8 config → Task 3. §9 testing: cases 1-6 Task 4; 7 Task 4 (double-resolve); 8-11 Tasks 2 and 4; 12 Task 5; 13 Task 4 (`it.each`); 14 Task 1; 15-17 Task 4. §10 docs distributed across Tasks 1, 4, 5, 6, 7 so each rides with the code it describes. §11 follow-up → Task 7.

**Placeholder scan.** No TBDs. One place describes rather than dictates: the `events.ts` builders in Task 3 Step 4, because the surrounding style is the requirement and copying it wrong is worse than matching it. Every repo method named in a test was verified to exist — `postingsRepo.listByTransaction`, `transactionsRepo.findById`, `setStatus`, `adminElevationsRepo.*`.

**Type consistency.** `MoneyOpsRefusal` is one union used by the error, the route map, and the audit payload. `resolveStuckTransaction(db, adapter, input)` keeps the `(db, adapter, …)` order of `reconciliationService.sweep` and `redeemService.redeem`. `findLive(db, adminUserId, transactionId, now)` is called with that argument order in Tasks 2 and 4. `{ outcome: 'settled' | 'reversed' }` is the same shape in the service, the route, and `ResolveOutcome`.

**One risk flagged for the executor.** Task 4's `refuse()` helper writes an audit row and then the caller throws. If a future refactor wraps `resolveStuckTransaction` in a database transaction, those audit rows will roll back with the refusal and the "audit every refusal" constraint will silently break. Keep the audit writes on `db`, outside any transaction, and if you do introduce one, assert the refusal audit still lands.
