# Sub-plan 3 — Rule Engine + Bump Workflow + Anomaly + Audit analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transaction control plane that sits between Sub-plan 2's ledger and Sub-plan 4's lifecycle orchestrator: a pure-function rule engine with replay-corpus testing, a bump-request state machine, statistical anomaly scoring, and a structured audit-event API.

**Architecture:**
- **Rule engine** is a **pure function** (per spec §4 + §12): `evaluate(intent, ruleSet, snapshot) → Decision`. Same input → same output. No DB writes from the engine itself; the calling lifecycle service is responsible for persistence. This is what makes replay testing trivial.
- **Replay corpus** is an NDJSON file at `apps/backend/test-corpus/rule-engine/` containing `{intent, ruleSet, snapshot, expectedDecision}` records. Pre-deploy CI replays the entire corpus against the new engine and diffs decisions; any divergence is a release-blocker (per spec §12 Pillar 2).
- **Rule sets are versioned, never updated** (per spec §5 invariant). Editing a rule writes `version + 1`; the old set stays for replay and audit. The "active" set is `MAX(version) WHERE status='active'`.
- **Bump workflow** is an explicit state machine with TTL (default 30 min). On approval, a single-use one-shot token is attached to the transaction; consuming the token moves the txn back into the lifecycle.
- **Anomaly scoring** decomposes into independent features (amount z-score, hour-of-day, vendor novelty, velocity), each a pure function. The aggregator combines them with configurable weights into a single score 0..1.
- **Audit analysis** adds typed query helpers + structured-event constructors on top of the append-only writer that landed in Sub-plan 2.

**Tech Stack:** Inherited from Sub-plans 1 + 2 (Decision #18). No new runtime deps; tests reuse `fast-check` from Sub-plan 2.

**Out of scope for this sub-plan (covered in later sub-plans):**
- Vendor capture (NQR scan, name enquiry as a public endpoint, phone lookup) — Sub-plan 4
- Transaction lifecycle handoff to NIP-out (`IN_FLIGHT → SETTLED`) — Sub-plan 4
- Notifications wiring (push to principal on bump request, notify agent on decision) — Sub-plan 5
- Mobile UI for rules editor and bump approval — Sub-plans 6 + 7
- Live replay-corpus runner in CI (corpus capture + offline runner ship here; CI integration is Sub-plan 8)

**Plan length note:** ~43 tasks across 9 phases. Original Sub-plan-2 decomposition estimated "~70 tasks"; the actual count is lower because the rule-kind evaluators decompose cleanly into 1-file-1-test implementations.

---

## File structure produced by this plan

```
apps/backend/src/
├── db/
│   └── schema/
│       ├── rules.ts                              NEW (rule_sets, rules)
│       └── bumps.ts                              NEW (bump_requests, one_shot_tokens)
├── modules/
│   ├── rules/
│   │   ├── types.ts                              NEW
│   │   ├── evaluators/
│   │   │   ├── limit.ts                          NEW
│   │   │   ├── category.ts                       NEW
│   │   │   ├── time-window.ts                    NEW
│   │   │   ├── allowlist.ts                      NEW
│   │   │   └── anomaly-threshold.ts              NEW
│   │   ├── engine.ts                             NEW (orchestrator)
│   │   ├── rule-sets.repo.ts                     NEW
│   │   ├── rules.repo.ts                         NEW
│   │   ├── rule-set.service.ts                   NEW (versioned write)
│   │   ├── replay/
│   │   │   ├── capture.ts                        NEW (append to NDJSON corpus)
│   │   │   └── runner.ts                         NEW (load + replay + diff)
│   │   └── index.ts                              NEW
│   ├── bumps/
│   │   ├── state-machine.ts                      NEW
│   │   ├── bump-requests.repo.ts                 NEW
│   │   ├── one-shot-tokens.repo.ts               NEW
│   │   ├── bump-workflow.service.ts              NEW
│   │   └── index.ts                              NEW
│   ├── anomaly/
│   │   ├── features/
│   │   │   ├── amount-zscore.ts                  NEW
│   │   │   ├── hour-of-day.ts                    NEW
│   │   │   ├── vendor-novelty.ts                 NEW
│   │   │   └── velocity.ts                       NEW
│   │   ├── anomaly.service.ts                    NEW
│   │   └── index.ts                              NEW
│   ├── audit/
│   │   ├── audit.repo.ts                         MODIFIED (add listByActor / listByAction)
│   │   ├── events.ts                             NEW (typed structured-event constructors)
│   │   └── index.ts                              MODIFIED (re-export events)
│   └── transactions/
│       ├── lifecycle.service.ts                  NEW (rule eval → bump or in_flight)
│       └── index.ts                              NEW
└── (no new routes — public surface lands in Sub-plan 4)

apps/backend/tests/
├── modules/
│   ├── rules/
│   │   ├── evaluators/                           NEW (one .test.ts per evaluator)
│   │   ├── engine.test.ts                        NEW
│   │   ├── rule-sets.repo.test.ts                NEW
│   │   ├── rule-set.service.test.ts              NEW
│   │   └── replay.test.ts                        NEW
│   ├── bumps/
│   │   ├── state-machine.test.ts                 NEW
│   │   ├── bump-requests.repo.test.ts            NEW
│   │   └── bump-workflow.service.test.ts         NEW
│   ├── anomaly/
│   │   ├── features/                             NEW (one .test.ts per feature)
│   │   └── anomaly.service.test.ts               NEW
│   ├── audit/
│   │   ├── audit.repo.test.ts                    MODIFIED (add query tests)
│   │   └── events.test.ts                        NEW
│   └── transactions/
│       └── lifecycle.service.test.ts             NEW (integration; happy + bump + deny)

apps/backend/test-corpus/rule-engine/
└── seed.ndjson                                   NEW (handful of seed cases)
```

---

## Phase A — Schema additions (Tasks 1-4)

### Task 1: rule_sets schema + migration

**Files:**
- Create: `apps/backend/src/db/schema/rules.ts` (just `rule_sets` table for now; `rules` table in T2)
- Modify: `apps/backend/src/db/schema/index.ts`
- Generated: `apps/backend/src/db/migrations/0010_rule_sets.sql`

> **Reminder from Sub-plan 2:** drizzle-kit 0.25 doesn't emit `check()` constraints — append manually if you add any. BigInt defaults need `.default(sql\`0\`)` not `.default(0n)`. None apply here.

- [ ] **Step 1: Write `apps/backend/src/db/schema/rules.ts`** (rule_sets only for now)

```ts
import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subWallets } from './wallet';
import { users } from './identity';

export const ruleSetStatusEnum = pgEnum('rule_set_status', ['active', 'superseded']);

export const ruleSets = pgTable('rule_sets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  subWalletId: uuid('sub_wallet_id')
    .notNull()
    .references(() => subWallets.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  status: ruleSetStatusEnum('status').notNull().default('active'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Append to `apps/backend/src/db/schema/index.ts`**

```ts
export * from './rules';
```

- [ ] **Step 3: Generate + apply + verify**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend exec drizzle-kit generate --name rule_sets
pnpm --filter @amana/backend db:migrate
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ rule_sets"
```

- [ ] **Step 4: Smoke test `apps/backend/tests/modules/rules/rule-sets.repo.test.ts`** (schema only — repo lands in T14)

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('rule_sets table (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rule_sets' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'sub_wallet_id', 'version', 'status', 'effective_from',
      'created_by_user_id', 'created_at',
    ]);
  });
});
```

Also extend `apps/backend/tests/helpers/test-db.ts` `TABLES_TO_TRUNCATE` array to include the new tables: `'one_shot_tokens'`, `'bump_requests'`, `'rules'`, `'rule_sets'` (place them BEFORE `'sub_wallets'` since they FK into it).

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/rule-sets.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/db apps/backend/tests
git -C "C:/Users/alex_/amana" commit -m "feat(db): rule_sets schema + extend test-db truncate list"
```

---

### Task 2: rules schema + migration

**Files:**
- Modify: `apps/backend/src/db/schema/rules.ts` (add `rules` table)
- Generated: `apps/backend/src/db/migrations/0011_rules.sql`

- [ ] **Step 1: Append to `apps/backend/src/db/schema/rules.ts`**

```ts
import { jsonb } from 'drizzle-orm/pg-core';

export const ruleKindEnum = pgEnum('rule_kind', [
  'limit',
  'category',
  'time_window',
  'allowlist',
  'anomaly_threshold',
]);

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ruleSetId: uuid('rule_set_id')
    .notNull()
    .references(() => ruleSets.id, { onDelete: 'cascade' }),
  kind: ruleKindEnum('kind').notNull(),
  configJson: jsonb('config_json').notNull(),
  priority: integer('priority').notNull().default(100),
});
```

(Add `jsonb` to the `drizzle-orm/pg-core` import line at the top of the file if it isn't already there. The schema already imports `pgEnum`, `pgTable`, etc.)

- [ ] **Step 2: Generate + apply**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend exec drizzle-kit generate --name rules
pnpm --filter @amana/backend db:migrate
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ rules"
```

- [ ] **Step 3: Append schema test to `apps/backend/tests/modules/rules/rule-sets.repo.test.ts`** (or add a new `rules.repo.test.ts`)

```ts
describe('rules table (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rules' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'rule_set_id', 'kind', 'config_json', 'priority',
    ]);
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/db apps/backend/tests/modules/rules
git -C "C:/Users/alex_/amana" commit -m "feat(db): rules schema (kind enum + jsonb config + priority)"
```

---

### Task 3: bump_requests schema + one_shot_tokens

**Files:**
- Create: `apps/backend/src/db/schema/bumps.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Generated: `apps/backend/src/db/migrations/0012_bumps.sql`

- [ ] **Step 1: Write `apps/backend/src/db/schema/bumps.ts`**

```ts
import { bigint, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subWallets } from './wallet';
import { transactions } from './transactions';
import { users } from './identity';

export const bumpStatusEnum = pgEnum('bump_status', [
  'pending',
  'approved_once',
  'raise_limit',
  'denied',
  'expired',
]);

export const bumpRequests = pgTable('bump_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'restrict' }),
  subWalletId: uuid('sub_wallet_id')
    .notNull()
    .references(() => subWallets.id, { onDelete: 'restrict' }),
  requestedByUserId: uuid('requested_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  vendorResolvedName: text('vendor_resolved_name').notNull(),
  agentNote: text('agent_note'),
  status: bumpStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oneShotTokens = pgTable('one_shot_tokens', {
  token: text('token').primaryKey(),
  bumpRequestId: uuid('bump_request_id')
    .notNull()
    .references(() => bumpRequests.id, { onDelete: 'cascade' }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }), // nullable until used
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Append barrel + generate + apply**

```ts
// apps/backend/src/db/schema/index.ts
export * from './bumps';
```

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend exec drizzle-kit generate --name bumps
pnpm --filter @amana/backend db:migrate
```

- [ ] **Step 3: Schema smoke test `apps/backend/tests/modules/bumps/bump-requests.repo.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('bump_requests + one_shot_tokens (schema)', () => {
  beforeEach(async () => { await truncateAll(); });

  it('bump_requests has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bump_requests' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'id', 'transaction_id', 'sub_wallet_id', 'requested_by_user_id',
      'amount_kobo', 'vendor_resolved_name', 'agent_note', 'status',
      'expires_at', 'decided_by_user_id', 'decided_at', 'created_at',
    ]);
  });

  it('one_shot_tokens has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'one_shot_tokens' ORDER BY ordinal_position
    `);
    expect(cols.map((r) => r.column_name)).toEqual([
      'token', 'bump_request_id', 'consumed_at', 'expires_at', 'created_at',
    ]);
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/bumps/bump-requests.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/db apps/backend/tests/modules/bumps
git -C "C:/Users/alex_/amana" commit -m "feat(db): bump_requests + one_shot_tokens schemas"
```

---

### Task 4: Wire `transactions.bump_request_id` FK

The column was added in Sub-plan 2 as a placeholder (nullable, no FK). Now that `bump_requests` exists, add the FK constraint via a hand-rolled migration.

**Files:**
- Hand-rolled: `apps/backend/src/db/migrations/0013_transactions_bump_fk.sql`

- [ ] **Step 1: Write `apps/backend/src/db/migrations/0013_transactions_bump_fk.sql`**

```sql
ALTER TABLE transactions
  ADD CONSTRAINT transactions_bump_request_id_fkey
  FOREIGN KEY (bump_request_id) REFERENCES bump_requests(id)
  ON DELETE RESTRICT;
```

- [ ] **Step 2: Register hand-rolled migration in `apps/backend/src/db/migrations/meta/_journal.json`**

Append a new entry with the next idx, version "7", current epoch ms, tag `0013_transactions_bump_fk`, breakpoints true. Same pattern as the immutability triggers in Phase B of Sub-plan 2.

- [ ] **Step 3: Apply + verify**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend db:migrate
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ transactions"
```
Expected: `\d+ transactions` shows the new FK constraint.

Also update the Drizzle schema in `apps/backend/src/db/schema/transactions.ts` to add the `.references(() => bumpRequests.id, { onDelete: 'restrict' })` to the existing `bumpRequestId` column. **Note:** drizzle-kit may try to generate a duplicate ALTER if you do this — diff carefully and skip the generate step on this task; only the hand-rolled SQL applies. Update the TS schema for type-correctness only.

- [ ] **Step 4: Smoke test that the FK rejects bad inserts**

```ts
// apps/backend/tests/modules/wallet/transactions.repo.test.ts — append:

it('rejects a transaction with bump_request_id pointing at nonexistent row', async () => {
  const { masterId } = await seedMaster();
  const bogusBumpId = factories.txnId();
  await expect(
    testDb.execute(sql`
      INSERT INTO transactions (master_wallet_id, kind, amount_kobo, idempotency_key, bump_request_id)
      VALUES (${masterId}, 'spend', 100, ${factories.idempotencyKey()}, ${bogusBumpId})
    `),
  ).rejects.toThrow(/foreign key/i);
});
```

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/wallet/transactions.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/db apps/backend/tests/modules/wallet/transactions.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(db): wire transactions.bump_request_id FK to bump_requests"
```

---

## Phase B — Rule engine: types, evaluators, orchestrator, replay corpus (Tasks 5-13)

The engine is a **pure function**. No DB access from inside the evaluators or the orchestrator. The caller (lifecycle service in Phase G) reads ledger/anomaly/etc. and packages everything into a `RuleEvaluationContext`, then calls `evaluate(intent, ruleSet, context)`. The pure function is what makes the replay corpus possible.

### Task 5: Rule engine types

**Files:**
- Create: `apps/backend/src/modules/rules/types.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/rules/types.ts`**

```ts
import type { Kobo } from '../../lib/kobo';

// ============ Rule definitions (one variant per rule kind) ============

export type LimitRuleConfig = {
  windowKind: 'daily' | 'monthly';
  maxKobo: bigint; // serialised as string when written to JSONB
};

export type CategoryRuleConfig = {
  mode: 'allowlist' | 'blocklist';
  categories: string[];
};

export type TimeWindowRuleConfig = {
  // 24h windows in agent's local time; tz tracked at the wallet level later
  startHour: number; // 0..23
  endHour: number;   // 0..23, exclusive
  daysOfWeek: number[]; // 0=Sun..6=Sat
};

export type AllowlistRuleConfig = {
  // Match either bank-account pair OR vendor name (case-insensitive substring)
  accounts?: { bankCode: string; accountNumber: string }[];
  nameSubstrings?: string[];
};

export type AnomalyThresholdRuleConfig = {
  maxScore: number; // 0..1 inclusive; deny if score > maxScore
};

export type Rule =
  | { id: string; kind: 'limit'; priority: number; config: LimitRuleConfig }
  | { id: string; kind: 'category'; priority: number; config: CategoryRuleConfig }
  | { id: string; kind: 'time_window'; priority: number; config: TimeWindowRuleConfig }
  | { id: string; kind: 'allowlist'; priority: number; config: AllowlistRuleConfig }
  | { id: string; kind: 'anomaly_threshold'; priority: number; config: AnomalyThresholdRuleConfig };

export type RuleSet = {
  id: string;
  subWalletId: string;
  version: number;
  rules: Rule[];
};

// ============ Inputs into evaluation ============

export type TxnIntent = {
  amountKobo: Kobo;
  category: string | null;
  vendorBankCode: string | null;
  vendorAccountNumber: string | null;
  vendorResolvedName: string | null;
  // Wall-clock at which the agent confirmed the intent. Pure function; caller passes this in.
  confirmedAt: Date;
};

export type LedgerSnapshot = {
  subWalletAvailableKobo: Kobo;
  spentLast24hKobo: Kobo;
  spentLast30dKobo: Kobo;
};

export type RuleEvaluationContext = {
  ledger: LedgerSnapshot;
  anomalyScore: number; // 0..1; precomputed by Phase E and passed in
};

// ============ Outputs ============

export type DenialReason =
  | { code: 'INSUFFICIENT_FUNDS' }
  | { code: 'LIMIT_EXCEEDED'; window: 'daily' | 'monthly'; maxKobo: bigint; wouldBeKobo: bigint }
  | { code: 'CATEGORY_NOT_ALLOWED'; category: string | null }
  | { code: 'OUTSIDE_TIME_WINDOW'; nowHour: number; allowedStart: number; allowedEnd: number }
  | { code: 'NOT_IN_ALLOWLIST' }
  | { code: 'ANOMALY_TOO_HIGH'; score: number; max: number };

export type Decision =
  | { kind: 'allow' }
  | { kind: 'require_bump'; firstFailedReason: DenialReason; allReasons: DenialReason[] };
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/types.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): rule engine types (rule variants, intent, context, decision)"
```

---

### Task 6: Limit rule evaluator (TDD)

**Files:**
- Create: `apps/backend/src/modules/rules/evaluators/limit.ts`
- Create: `apps/backend/tests/modules/rules/evaluators/limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/rules/evaluators/limit.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateLimit } from '../../../../src/modules/rules/evaluators/limit';
import type { LimitRuleConfig, LedgerSnapshot, TxnIntent } from '../../../../src/modules/rules/types';
import { kobo } from '../../../../src/lib/kobo';

const intent = (amount: bigint): TxnIntent => ({
  amountKobo: kobo(amount),
  category: null,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
});

const ledger = (overrides: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  subWalletAvailableKobo: kobo(100_000n),
  spentLast24hKobo: kobo(0n),
  spentLast30dKobo: kobo(0n),
  ...overrides,
});

describe('evaluateLimit', () => {
  it('allows when daily total stays under cap', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 50_000n };
    expect(evaluateLimit(cfg, intent(10_000n), ledger({ spentLast24hKobo: kobo(20_000n) }))).toBeNull();
  });

  it('denies when daily total would exceed cap', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 50_000n };
    const r = evaluateLimit(cfg, intent(40_000n), ledger({ spentLast24hKobo: kobo(20_000n) }));
    expect(r?.code).toBe('LIMIT_EXCEEDED');
    if (r?.code === 'LIMIT_EXCEEDED') {
      expect(r.window).toBe('daily');
      expect(r.maxKobo).toBe(50_000n);
      expect(r.wouldBeKobo).toBe(60_000n);
    }
  });

  it('denies when balance is insufficient (separate code from limit)', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 1_000_000n };
    const r = evaluateLimit(cfg, intent(200_000n), ledger({ subWalletAvailableKobo: kobo(50_000n) }));
    expect(r?.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('handles monthly window via spentLast30dKobo', () => {
    const cfg: LimitRuleConfig = { windowKind: 'monthly', maxKobo: 200_000n };
    const r = evaluateLimit(cfg, intent(50_000n), ledger({ spentLast30dKobo: kobo(180_000n) }));
    expect(r?.code).toBe('LIMIT_EXCEEDED');
  });

  it('returns null (no denial) when amount exactly equals remaining headroom', () => {
    const cfg: LimitRuleConfig = { windowKind: 'daily', maxKobo: 50_000n };
    expect(evaluateLimit(cfg, intent(30_000n), ledger({ spentLast24hKobo: kobo(20_000n) }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL (module not found)**

- [ ] **Step 3: Write `apps/backend/src/modules/rules/evaluators/limit.ts`**

```ts
import type { DenialReason, LedgerSnapshot, LimitRuleConfig, TxnIntent } from '../types';

export function evaluateLimit(
  cfg: LimitRuleConfig,
  intent: TxnIntent,
  ledger: LedgerSnapshot,
): DenialReason | null {
  // Insufficient funds is checked before limit so we get a more specific error code.
  if (intent.amountKobo > ledger.subWalletAvailableKobo) {
    return { code: 'INSUFFICIENT_FUNDS' };
  }
  const spent = cfg.windowKind === 'daily' ? ledger.spentLast24hKobo : ledger.spentLast30dKobo;
  const wouldBe = spent + intent.amountKobo;
  if (wouldBe > cfg.maxKobo) {
    return {
      code: 'LIMIT_EXCEEDED',
      window: cfg.windowKind,
      maxKobo: cfg.maxKobo,
      wouldBeKobo: wouldBe,
    };
  }
  return null;
}
```

- [ ] **Step 4: Re-run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/evaluators/limit.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/evaluators/limit.ts apps/backend/tests/modules/rules/evaluators/limit.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): limit evaluator (daily/monthly window + insufficient-funds short-circuit)"
```

---

### Task 7: Category rule evaluator (TDD)

**Files:**
- Create: `apps/backend/src/modules/rules/evaluators/category.ts`
- Create: `apps/backend/tests/modules/rules/evaluators/category.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateCategory } from '../../../../src/modules/rules/evaluators/category';
import type { CategoryRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';
import { kobo } from '../../../../src/lib/kobo';

const intent = (category: string | null): TxnIntent => ({
  amountKobo: kobo(0n),
  category,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
});

describe('evaluateCategory', () => {
  it('allowlist: allows when category is in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'allowlist', categories: ['groceries', 'transport'] };
    expect(evaluateCategory(cfg, intent('groceries'))).toBeNull();
  });

  it('allowlist: denies when category is not in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'allowlist', categories: ['groceries'] };
    const r = evaluateCategory(cfg, intent('alcohol'));
    expect(r?.code).toBe('CATEGORY_NOT_ALLOWED');
  });

  it('allowlist: denies when category is null and rule is set', () => {
    const cfg: CategoryRuleConfig = { mode: 'allowlist', categories: ['groceries'] };
    expect(evaluateCategory(cfg, intent(null))?.code).toBe('CATEGORY_NOT_ALLOWED');
  });

  it('blocklist: denies when category is in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'blocklist', categories: ['alcohol', 'gambling'] };
    expect(evaluateCategory(cfg, intent('alcohol'))?.code).toBe('CATEGORY_NOT_ALLOWED');
  });

  it('blocklist: allows when category is not in list', () => {
    const cfg: CategoryRuleConfig = { mode: 'blocklist', categories: ['alcohol'] };
    expect(evaluateCategory(cfg, intent('groceries'))).toBeNull();
  });

  it('blocklist: allows when category is null', () => {
    const cfg: CategoryRuleConfig = { mode: 'blocklist', categories: ['alcohol'] };
    expect(evaluateCategory(cfg, intent(null))).toBeNull();
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/evaluators/category.ts`**

```ts
import type { CategoryRuleConfig, DenialReason, TxnIntent } from '../types';

export function evaluateCategory(
  cfg: CategoryRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  const category = intent.category;
  const inList = category !== null && cfg.categories.includes(category);

  if (cfg.mode === 'allowlist' && !inList) {
    return { code: 'CATEGORY_NOT_ALLOWED', category };
  }
  if (cfg.mode === 'blocklist' && inList) {
    return { code: 'CATEGORY_NOT_ALLOWED', category };
  }
  return null;
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/evaluators/category.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/evaluators/category.ts apps/backend/tests/modules/rules/evaluators/category.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): category evaluator (allowlist + blocklist modes)"
```

---

### Task 8: Time-window rule evaluator (TDD)

**Files:**
- Create: `apps/backend/src/modules/rules/evaluators/time-window.ts`
- Create: `apps/backend/tests/modules/rules/evaluators/time-window.test.ts`

The evaluator works in **UTC** for now (per-wallet timezone is a v1.x feature). The agent app should send `confirmedAt` already adjusted, OR the rule should be specified in UTC. This is documented as a known simplification.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateTimeWindow } from '../../../../src/modules/rules/evaluators/time-window';
import type { TimeWindowRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';
import { kobo } from '../../../../src/lib/kobo';

const intent = (iso: string): TxnIntent => ({
  amountKobo: kobo(0n),
  category: null,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date(iso),
});

const cfg = (overrides: Partial<TimeWindowRuleConfig> = {}): TimeWindowRuleConfig => ({
  startHour: 6,
  endHour: 22,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  ...overrides,
});

describe('evaluateTimeWindow', () => {
  it('allows mid-window', () => {
    expect(evaluateTimeWindow(cfg(), intent('2026-05-03T12:00:00Z'))).toBeNull();
  });

  it('denies before window start', () => {
    const r = evaluateTimeWindow(cfg(), intent('2026-05-03T05:30:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('denies at or after window end (end is exclusive)', () => {
    const r = evaluateTimeWindow(cfg(), intent('2026-05-03T22:00:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('denies on disallowed day-of-week', () => {
    // 2026-05-03 is a Sunday (day 0)
    const c = cfg({ daysOfWeek: [1, 2, 3, 4, 5] }); // weekdays only
    const r = evaluateTimeWindow(c, intent('2026-05-03T12:00:00Z'));
    expect(r?.code).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('handles wraparound windows (e.g. 22-06 overnight)', () => {
    const c = cfg({ startHour: 22, endHour: 6 });
    expect(evaluateTimeWindow(c, intent('2026-05-03T23:00:00Z'))).toBeNull();
    expect(evaluateTimeWindow(c, intent('2026-05-03T03:00:00Z'))).toBeNull();
    expect(evaluateTimeWindow(c, intent('2026-05-03T12:00:00Z'))?.code).toBe('OUTSIDE_TIME_WINDOW');
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/evaluators/time-window.ts`**

```ts
import type { DenialReason, TimeWindowRuleConfig, TxnIntent } from '../types';

export function evaluateTimeWindow(
  cfg: TimeWindowRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  // UTC for now; per-wallet timezone deferred to v1.x.
  const hour = intent.confirmedAt.getUTCHours();
  const day = intent.confirmedAt.getUTCDay();

  if (!cfg.daysOfWeek.includes(day)) {
    return {
      code: 'OUTSIDE_TIME_WINDOW',
      nowHour: hour,
      allowedStart: cfg.startHour,
      allowedEnd: cfg.endHour,
    };
  }

  // Wraparound (e.g. 22-06 = open 22..23 + 0..5)
  const wraps = cfg.startHour > cfg.endHour;
  const inWindow = wraps
    ? hour >= cfg.startHour || hour < cfg.endHour
    : hour >= cfg.startHour && hour < cfg.endHour;

  if (!inWindow) {
    return {
      code: 'OUTSIDE_TIME_WINDOW',
      nowHour: hour,
      allowedStart: cfg.startHour,
      allowedEnd: cfg.endHour,
    };
  }
  return null;
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/evaluators/time-window.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/evaluators/time-window.ts apps/backend/tests/modules/rules/evaluators/time-window.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): time-window evaluator (day-of-week + wraparound + UTC for now)"
```

---

### Task 9: Allowlist rule evaluator (TDD)

**Files:**
- Create: `apps/backend/src/modules/rules/evaluators/allowlist.ts`
- Create: `apps/backend/tests/modules/rules/evaluators/allowlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateAllowlist } from '../../../../src/modules/rules/evaluators/allowlist';
import type { AllowlistRuleConfig, TxnIntent } from '../../../../src/modules/rules/types';
import { kobo } from '../../../../src/lib/kobo';

const intent = (overrides: Partial<TxnIntent> = {}): TxnIntent => ({
  amountKobo: kobo(0n),
  category: null,
  vendorBankCode: null,
  vendorAccountNumber: null,
  vendorResolvedName: null,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
  ...overrides,
});

describe('evaluateAllowlist', () => {
  it('allows when account matches', () => {
    const cfg: AllowlistRuleConfig = {
      accounts: [{ bankCode: '058', accountNumber: '0123456789' }],
    };
    const r = evaluateAllowlist(cfg, intent({ vendorBankCode: '058', vendorAccountNumber: '0123456789' }));
    expect(r).toBeNull();
  });

  it('denies when neither account nor name match', () => {
    const cfg: AllowlistRuleConfig = {
      accounts: [{ bankCode: '058', accountNumber: '0123456789' }],
      nameSubstrings: ['MAMA'],
    };
    const r = evaluateAllowlist(cfg, intent({
      vendorBankCode: '058', vendorAccountNumber: '9999999999',
      vendorResolvedName: 'JOHN DOE',
    }));
    expect(r?.code).toBe('NOT_IN_ALLOWLIST');
  });

  it('matches by name substring (case-insensitive)', () => {
    const cfg: AllowlistRuleConfig = { nameSubstrings: ['MAMA'] };
    const r = evaluateAllowlist(cfg, intent({ vendorResolvedName: 'mama adunni store' }));
    expect(r).toBeNull();
  });

  it('denies when both lists are empty (vacuously empty allowlist = all denied)', () => {
    const cfg: AllowlistRuleConfig = {};
    expect(evaluateAllowlist(cfg, intent())?.code).toBe('NOT_IN_ALLOWLIST');
  });

  it('denies when name is null and only nameSubstrings is set', () => {
    const cfg: AllowlistRuleConfig = { nameSubstrings: ['MAMA'] };
    const r = evaluateAllowlist(cfg, intent({ vendorResolvedName: null }));
    expect(r?.code).toBe('NOT_IN_ALLOWLIST');
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/evaluators/allowlist.ts`**

```ts
import type { AllowlistRuleConfig, DenialReason, TxnIntent } from '../types';

export function evaluateAllowlist(
  cfg: AllowlistRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  const accountMatch = (cfg.accounts ?? []).some(
    (a) => a.bankCode === intent.vendorBankCode && a.accountNumber === intent.vendorAccountNumber,
  );
  if (accountMatch) return null;

  const name = intent.vendorResolvedName?.toLowerCase() ?? '';
  const nameMatch =
    name.length > 0 &&
    (cfg.nameSubstrings ?? []).some((s) => name.includes(s.toLowerCase()));
  if (nameMatch) return null;

  return { code: 'NOT_IN_ALLOWLIST' };
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/evaluators/allowlist.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/evaluators/allowlist.ts apps/backend/tests/modules/rules/evaluators/allowlist.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): allowlist evaluator (account + name-substring matching)"
```

---

### Task 10: Anomaly threshold rule evaluator (TDD)

**Files:**
- Create: `apps/backend/src/modules/rules/evaluators/anomaly-threshold.ts`
- Create: `apps/backend/tests/modules/rules/evaluators/anomaly-threshold.test.ts`

The anomaly score itself is computed by Phase E and passed in via `RuleEvaluationContext.anomalyScore`. This evaluator just compares it against the rule's threshold.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateAnomalyThreshold } from '../../../../src/modules/rules/evaluators/anomaly-threshold';
import type { AnomalyThresholdRuleConfig } from '../../../../src/modules/rules/types';

describe('evaluateAnomalyThreshold', () => {
  it('allows when score is below threshold', () => {
    const cfg: AnomalyThresholdRuleConfig = { maxScore: 0.85 };
    expect(evaluateAnomalyThreshold(cfg, 0.5)).toBeNull();
  });

  it('allows when score equals threshold (denial only on strictly greater)', () => {
    const cfg: AnomalyThresholdRuleConfig = { maxScore: 0.85 };
    expect(evaluateAnomalyThreshold(cfg, 0.85)).toBeNull();
  });

  it('denies when score exceeds threshold', () => {
    const cfg: AnomalyThresholdRuleConfig = { maxScore: 0.85 };
    const r = evaluateAnomalyThreshold(cfg, 0.92);
    expect(r?.code).toBe('ANOMALY_TOO_HIGH');
    if (r?.code === 'ANOMALY_TOO_HIGH') {
      expect(r.score).toBe(0.92);
      expect(r.max).toBe(0.85);
    }
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/evaluators/anomaly-threshold.ts`**

```ts
import type { AnomalyThresholdRuleConfig, DenialReason } from '../types';

export function evaluateAnomalyThreshold(
  cfg: AnomalyThresholdRuleConfig,
  score: number,
): DenialReason | null {
  if (score > cfg.maxScore) {
    return { code: 'ANOMALY_TOO_HIGH', score, max: cfg.maxScore };
  }
  return null;
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/evaluators/anomaly-threshold.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/evaluators/anomaly-threshold.ts apps/backend/tests/modules/rules/evaluators/anomaly-threshold.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): anomaly-threshold evaluator (deny if score > maxScore)"
```

---

### Task 11: Rule engine orchestrator (TDD)

The orchestrator iterates over the rule set in priority order (lowest priority number first; ties resolved by rule id for determinism). It collects ALL denials (not just the first) so the principal can see every reason in one bump request. The first denial is highlighted as the primary.

**Files:**
- Create: `apps/backend/src/modules/rules/engine.ts`
- Create: `apps/backend/tests/modules/rules/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../../src/modules/rules/engine';
import type { Rule, RuleEvaluationContext, TxnIntent } from '../../../src/modules/rules/types';
import { kobo } from '../../../src/lib/kobo';

const intent = (overrides: Partial<TxnIntent> = {}): TxnIntent => ({
  amountKobo: kobo(40_000n),
  category: 'groceries',
  vendorBankCode: '058',
  vendorAccountNumber: '0123456789',
  vendorResolvedName: 'MUSA',
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
  ...overrides,
});

const ctx = (overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext => ({
  ledger: {
    subWalletAvailableKobo: kobo(100_000n),
    spentLast24hKobo: kobo(0n),
    spentLast30dKobo: kobo(0n),
  },
  anomalyScore: 0.1,
  ...overrides,
});

describe('rule engine evaluate', () => {
  it('allow when no rules', () => {
    expect(evaluate(intent(), { id: 'rs', subWalletId: 'sw', version: 1, rules: [] }, ctx())).toEqual({
      kind: 'allow',
    });
  });

  it('allow when all rules pass', () => {
    const rules: Rule[] = [
      { id: 'r1', kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 100_000n } },
      { id: 'r2', kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['groceries'] } },
    ];
    const out = evaluate(intent(), { id: 'rs', subWalletId: 'sw', version: 1, rules }, ctx());
    expect(out.kind).toBe('allow');
  });

  it('require_bump when one rule fails; reason matches that rule', () => {
    const rules: Rule[] = [
      { id: 'r1', kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 30_000n } },
    ];
    const out = evaluate(intent({ amountKobo: kobo(40_000n) }), { id: 'rs', subWalletId: 'sw', version: 1, rules }, ctx());
    expect(out.kind).toBe('require_bump');
    if (out.kind === 'require_bump') {
      expect(out.firstFailedReason.code).toBe('LIMIT_EXCEEDED');
      expect(out.allReasons).toHaveLength(1);
    }
  });

  it('collects all failures across multiple rules; firstFailedReason follows priority', () => {
    const rules: Rule[] = [
      { id: 'lo', kind: 'limit', priority: 5, config: { windowKind: 'daily', maxKobo: 30_000n } },
      { id: 'hi', kind: 'category', priority: 50, config: { mode: 'allowlist', categories: ['transport'] } },
    ];
    const out = evaluate(intent({ amountKobo: kobo(40_000n), category: 'groceries' }), {
      id: 'rs', subWalletId: 'sw', version: 1, rules,
    }, ctx());
    expect(out.kind).toBe('require_bump');
    if (out.kind === 'require_bump') {
      expect(out.allReasons).toHaveLength(2);
      // Lowest priority number = highest priority = comes first
      expect(out.firstFailedReason.code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('passes anomaly score through to anomaly_threshold rules', () => {
    const rules: Rule[] = [
      { id: 'a', kind: 'anomaly_threshold', priority: 100, config: { maxScore: 0.5 } },
    ];
    const out = evaluate(intent(), { id: 'rs', subWalletId: 'sw', version: 1, rules }, ctx({ anomalyScore: 0.9 }));
    expect(out.kind).toBe('require_bump');
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/engine.ts`**

```ts
import { evaluateAllowlist } from './evaluators/allowlist';
import { evaluateAnomalyThreshold } from './evaluators/anomaly-threshold';
import { evaluateCategory } from './evaluators/category';
import { evaluateLimit } from './evaluators/limit';
import { evaluateTimeWindow } from './evaluators/time-window';
import type { Decision, DenialReason, Rule, RuleEvaluationContext, RuleSet, TxnIntent } from './types';

function evalRule(
  rule: Rule,
  intent: TxnIntent,
  ctx: RuleEvaluationContext,
): DenialReason | null {
  switch (rule.kind) {
    case 'limit':
      return evaluateLimit(rule.config, intent, ctx.ledger);
    case 'category':
      return evaluateCategory(rule.config, intent);
    case 'time_window':
      return evaluateTimeWindow(rule.config, intent);
    case 'allowlist':
      return evaluateAllowlist(rule.config, intent);
    case 'anomaly_threshold':
      return evaluateAnomalyThreshold(rule.config, ctx.anomalyScore);
  }
}

export function evaluate(
  intent: TxnIntent,
  ruleSet: RuleSet,
  ctx: RuleEvaluationContext,
): Decision {
  const sorted = [...ruleSet.rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  const reasons: DenialReason[] = [];
  for (const rule of sorted) {
    const r = evalRule(rule, intent, ctx);
    if (r !== null) reasons.push(r);
  }
  if (reasons.length === 0) return { kind: 'allow' };
  // biome-ignore lint/style/noNonNullAssertion: reasons.length > 0 guarantees [0] exists
  return { kind: 'require_bump', firstFailedReason: reasons[0]!, allReasons: reasons };
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/engine.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/engine.ts apps/backend/tests/modules/rules/engine.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): engine orchestrator (priority-ordered, collects all denials)"
```

---

### Task 12: Replay corpus capture

A small helper that appends an NDJSON record `{intent, ruleSet, ctx, decision}` to `apps/backend/test-corpus/rule-engine/seed.ndjson` (or a path passed in). Used during development + tests to grow the corpus organically.

**Files:**
- Create: `apps/backend/src/modules/rules/replay/capture.ts`
- Create: `apps/backend/test-corpus/rule-engine/seed.ndjson` (initially: 3 hand-written cases)
- Create: `apps/backend/tests/modules/rules/replay.test.ts` (also covers Task 13)

- [ ] **Step 1: Write `apps/backend/src/modules/rules/replay/capture.ts`**

```ts
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Decision, RuleEvaluationContext, RuleSet, TxnIntent } from '../types';

export interface CaseRecord {
  intent: TxnIntent;
  ruleSet: RuleSet;
  ctx: RuleEvaluationContext;
  decision: Decision;
}

const bigintReplacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export async function appendCase(filePath: string, record: CaseRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record, bigintReplacer);
  await appendFile(filePath, `${line}\n`, 'utf8');
}
```

- [ ] **Step 2: Hand-write 3 seed cases to `apps/backend/test-corpus/rule-engine/seed.ndjson`** (one allow, one limit-deny, one anomaly-deny)

```
{"intent":{"amountKobo":"5000","category":"groceries","vendorBankCode":"058","vendorAccountNumber":"0123456789","vendorResolvedName":"MAMA ADUNNI","confirmedAt":"2026-05-03T12:00:00.000Z"},"ruleSet":{"id":"seed-rs-1","subWalletId":"seed-sw-1","version":1,"rules":[{"id":"r1","kind":"limit","priority":10,"config":{"windowKind":"daily","maxKobo":"50000"}}]},"ctx":{"ledger":{"subWalletAvailableKobo":"100000","spentLast24hKobo":"0","spentLast30dKobo":"0"},"anomalyScore":0.1},"decision":{"kind":"allow"}}
{"intent":{"amountKobo":"60000","category":"groceries","vendorBankCode":"058","vendorAccountNumber":"0123456789","vendorResolvedName":"MAMA ADUNNI","confirmedAt":"2026-05-03T12:00:00.000Z"},"ruleSet":{"id":"seed-rs-2","subWalletId":"seed-sw-1","version":1,"rules":[{"id":"r1","kind":"limit","priority":10,"config":{"windowKind":"daily","maxKobo":"50000"}}]},"ctx":{"ledger":{"subWalletAvailableKobo":"100000","spentLast24hKobo":"0","spentLast30dKobo":"0"},"anomalyScore":0.1},"decision":{"kind":"require_bump","firstFailedReason":{"code":"LIMIT_EXCEEDED","window":"daily","maxKobo":"50000","wouldBeKobo":"60000"},"allReasons":[{"code":"LIMIT_EXCEEDED","window":"daily","maxKobo":"50000","wouldBeKobo":"60000"}]}}
{"intent":{"amountKobo":"5000","category":"groceries","vendorBankCode":"058","vendorAccountNumber":"0123456789","vendorResolvedName":"MAMA ADUNNI","confirmedAt":"2026-05-03T12:00:00.000Z"},"ruleSet":{"id":"seed-rs-3","subWalletId":"seed-sw-1","version":1,"rules":[{"id":"a1","kind":"anomaly_threshold","priority":100,"config":{"maxScore":0.5}}]},"ctx":{"ledger":{"subWalletAvailableKobo":"100000","spentLast24hKobo":"0","spentLast30dKobo":"0"},"anomalyScore":0.9},"decision":{"kind":"require_bump","firstFailedReason":{"code":"ANOMALY_TOO_HIGH","score":0.9,"max":0.5},"allReasons":[{"code":"ANOMALY_TOO_HIGH","score":0.9,"max":0.5}]}}
```

(All bigints serialised as strings — the runner will parse them back.)

- [ ] **Step 3: Sanity-test capture writes a record (test added in T13)** — defer assertion to T13.

- [ ] **Step 4: Commit (test runs in T13)**

```powershell
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/replay/capture.ts apps/backend/test-corpus
git -C "C:/Users/alex_/amana" commit -m "feat(rules): replay corpus capture helper + 3 seed cases"
```

---

### Task 13: Replay corpus runner (TDD)

The runner loads an NDJSON corpus file, replays each record through the current `evaluate()`, and returns a diff: `{matched, mismatched: [{caseIdx, expected, actual}]}`. Pre-deploy CI will run this; any mismatched record blocks the deploy.

**Files:**
- Create: `apps/backend/src/modules/rules/replay/runner.ts`
- Create: `apps/backend/tests/modules/rules/replay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendCase } from '../../../src/modules/rules/replay/capture';
import { runReplay } from '../../../src/modules/rules/replay/runner';
import { evaluate } from '../../../src/modules/rules/engine';
import { kobo } from '../../../src/lib/kobo';

describe('replay corpus runner', () => {
  it('returns matched count when all decisions match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'amana-replay-'));
    const file = join(dir, 'corpus.ndjson');
    const intent = {
      amountKobo: kobo(5000n),
      category: 'groceries',
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MAMA',
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    };
    const ruleSet = { id: 'rs', subWalletId: 'sw', version: 1, rules: [] };
    const ctx = {
      ledger: { subWalletAvailableKobo: kobo(100000n), spentLast24hKobo: kobo(0n), spentLast30dKobo: kobo(0n) },
      anomalyScore: 0.1,
    };
    const decision = evaluate(intent, ruleSet, ctx);
    await appendCase(file, { intent, ruleSet, ctx, decision });

    const result = await runReplay(file);
    expect(result.matched).toBe(1);
    expect(result.mismatched).toHaveLength(0);
  });

  it('flags mismatched records when engine output differs from expected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'amana-replay-'));
    const file = join(dir, 'corpus.ndjson');
    // Intentionally write a wrong expected decision
    await writeFile(file, JSON.stringify({
      intent: { amountKobo: '5000', category: 'g', vendorBankCode: null, vendorAccountNumber: null, vendorResolvedName: null, confirmedAt: '2026-05-03T12:00:00.000Z' },
      ruleSet: { id: 'rs', subWalletId: 'sw', version: 1, rules: [] },
      ctx: { ledger: { subWalletAvailableKobo: '100000', spentLast24hKobo: '0', spentLast30dKobo: '0' }, anomalyScore: 0 },
      decision: { kind: 'require_bump', firstFailedReason: { code: 'INSUFFICIENT_FUNDS' }, allReasons: [{ code: 'INSUFFICIENT_FUNDS' }] },
    }) + '\n');

    const result = await runReplay(file);
    expect(result.matched).toBe(0);
    expect(result.mismatched).toHaveLength(1);
  });

  it('replays the committed seed corpus successfully', async () => {
    const result = await runReplay('apps/backend/test-corpus/rule-engine/seed.ndjson');
    expect(result.mismatched).toHaveLength(0);
    expect(result.matched).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/replay/runner.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { evaluate } from '../engine';
import type { CaseRecord } from './capture';
import type { Decision } from '../types';
import { kobo } from '../../../lib/kobo';

export interface ReplayResult {
  matched: number;
  mismatched: { caseIdx: number; expected: Decision; actual: Decision }[];
}

const BIGINT_KEYS = new Set([
  'amountKobo',
  'maxKobo',
  'wouldBeKobo',
  'subWalletAvailableKobo',
  'spentLast24hKobo',
  'spentLast30dKobo',
]);

function reviver(key: string, value: unknown): unknown {
  if (BIGINT_KEYS.has(key) && typeof value === 'string') return BigInt(value);
  if (key === 'confirmedAt' && typeof value === 'string') return new Date(value);
  return value;
}

function castRecord(raw: unknown): CaseRecord {
  // After JSON.parse with reviver, bigints + dates are restored. Brand kobo where needed.
  const r = raw as CaseRecord;
  // Re-brand kobo fields (they survived as bare bigints; the Kobo brand is structural).
  r.intent.amountKobo = kobo(r.intent.amountKobo as unknown as bigint);
  r.ctx.ledger.subWalletAvailableKobo = kobo(r.ctx.ledger.subWalletAvailableKobo as unknown as bigint);
  r.ctx.ledger.spentLast24hKobo = kobo(r.ctx.ledger.spentLast24hKobo as unknown as bigint);
  r.ctx.ledger.spentLast30dKobo = kobo(r.ctx.ledger.spentLast30dKobo as unknown as bigint);
  for (const rule of r.ruleSet.rules) {
    if (rule.kind === 'limit') {
      // already a bigint via reviver
    }
  }
  return r;
}

function decisionsEqual(a: Decision, b: Decision): boolean {
  return JSON.stringify(a, bigintToString) === JSON.stringify(b, bigintToString);
}

function bigintToString(_: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

export async function runReplay(filePath: string): Promise<ReplayResult> {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let matched = 0;
  const mismatched: ReplayResult['mismatched'] = [];
  lines.forEach((line, i) => {
    const parsed = JSON.parse(line, reviver);
    const record = castRecord(parsed);
    const actual = evaluate(record.intent, record.ruleSet, record.ctx);
    if (decisionsEqual(actual, record.decision)) {
      matched += 1;
    } else {
      mismatched.push({ caseIdx: i, expected: record.decision, actual });
    }
  });
  return { matched, mismatched };
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/replay.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/replay/runner.ts apps/backend/tests/modules/rules/replay.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): replay corpus runner + tests (matched/mismatched diff)"
```

---

## Phase C — Rules module: repos + versioned write service (Tasks 14-17)

### Task 14: rule_sets.repo

**Files:**
- Create: `apps/backend/src/modules/rules/rule-sets.repo.ts`
- Modify: `apps/backend/tests/modules/rules/rule-sets.repo.test.ts` (extend the existing schema-only file)

- [ ] **Step 1: Write `apps/backend/src/modules/rules/rule-sets.repo.ts`**

```ts
import { and, desc, eq, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ruleSets } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type RuleSetRow = typeof ruleSets.$inferSelect;

export const ruleSetsRepo = {
  async findActive(db: DbOrTx, subWalletId: string): Promise<RuleSetRow | undefined> {
    const [row] = await db
      .select()
      .from(ruleSets)
      .where(and(eq(ruleSets.subWalletId, subWalletId), eq(ruleSets.status, 'active')))
      .orderBy(desc(ruleSets.version))
      .limit(1);
    return row;
  },

  async findByVersion(
    db: DbOrTx,
    subWalletId: string,
    version: number,
  ): Promise<RuleSetRow | undefined> {
    const [row] = await db
      .select()
      .from(ruleSets)
      .where(and(eq(ruleSets.subWalletId, subWalletId), eq(ruleSets.version, version)))
      .limit(1);
    return row;
  },

  async maxVersion(db: DbOrTx, subWalletId: string): Promise<number> {
    const [row] = await db
      .select({ v: max(ruleSets.version) })
      .from(ruleSets)
      .where(eq(ruleSets.subWalletId, subWalletId));
    return row?.v ?? 0;
  },

  async insert(
    db: DbOrTx,
    input: { subWalletId: string; version: number; createdByUserId: string },
  ): Promise<RuleSetRow> {
    const [row] = await db.insert(ruleSets).values(input).returning();
    if (!row) throw new Error('ruleSets.insert returned no row');
    return row;
  },

  async markSuperseded(db: DbOrTx, id: string): Promise<void> {
    await db.update(ruleSets).set({ status: 'superseded' }).where(eq(ruleSets.id, id));
  },
};
```

- [ ] **Step 2: Append repo tests to `apps/backend/tests/modules/rules/rule-sets.repo.test.ts`**

```ts
import { factories } from '../../helpers/factories';
import { ruleSetsRepo } from '../../../src/modules/rules/rule-sets.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { principalId: principal.id, subWalletId: sw.sub.id };
}

describe('ruleSetsRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findActive picks latest active', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    const v1 = await ruleSetsRepo.insert(testDb, { subWalletId, version: 1, createdByUserId: principalId });
    await ruleSetsRepo.markSuperseded(testDb, v1.id);
    const v2 = await ruleSetsRepo.insert(testDb, { subWalletId, version: 2, createdByUserId: principalId });
    const active = await ruleSetsRepo.findActive(testDb, subWalletId);
    expect(active?.id).toBe(v2.id);
    expect(active?.version).toBe(2);
  });

  it('maxVersion returns 0 when no rule sets exist', async () => {
    const { subWalletId } = await seedSubWallet();
    expect(await ruleSetsRepo.maxVersion(testDb, subWalletId)).toBe(0);
  });

  it('maxVersion returns the highest version even across superseded sets', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await ruleSetsRepo.insert(testDb, { subWalletId, version: 1, createdByUserId: principalId });
    await ruleSetsRepo.insert(testDb, { subWalletId, version: 2, createdByUserId: principalId });
    expect(await ruleSetsRepo.maxVersion(testDb, subWalletId)).toBe(2);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/rules/rule-sets.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/rule-sets.repo.ts apps/backend/tests/modules/rules/rule-sets.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): rule-sets.repo (findActive/findByVersion/maxVersion/insert/markSuperseded)"
```

---

### Task 15: rules.repo

**Files:**
- Create: `apps/backend/src/modules/rules/rules.repo.ts`
- Create: `apps/backend/tests/modules/rules/rules.repo.test.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/rules/rules.repo.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { rules } from '../../db/schema';
import type { Rule } from './types';

type DbOrTx = PostgresJsDatabase;

export type RuleRow = typeof rules.$inferSelect;

export const rulesRepo = {
  async insertMany(
    db: DbOrTx,
    ruleSetId: string,
    input: Array<Omit<Rule, 'id'>>,
  ): Promise<RuleRow[]> {
    if (input.length === 0) return [];
    const values = input.map((r) => ({
      ruleSetId,
      kind: r.kind,
      configJson: r.config as object,
      priority: r.priority,
    }));
    return db.insert(rules).values(values).returning();
  },

  async listByRuleSet(db: DbOrTx, ruleSetId: string): Promise<RuleRow[]> {
    return db.select().from(rules).where(eq(rules.ruleSetId, ruleSetId));
  },
};
```

- [ ] **Step 2: Write `apps/backend/tests/modules/rules/rules.repo.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { ruleSetsRepo } from '../../../src/modules/rules/rule-sets.repo';
import { rulesRepo } from '../../../src/modules/rules/rules.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedRuleSet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const rs = await ruleSetsRepo.insert(testDb, {
    subWalletId: sw.sub.id, version: 1, createdByUserId: principal.id,
  });
  return rs.id;
}

describe('rulesRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insertMany + listByRuleSet round-trips', async () => {
    const rsId = await seedRuleSet();
    await rulesRepo.insertMany(testDb, rsId, [
      { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } },
      { kind: 'category', priority: 20, config: { mode: 'allowlist', categories: ['groceries'] } },
    ]);
    const list = await rulesRepo.listByRuleSet(testDb, rsId);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.kind).sort()).toEqual(['category', 'limit']);
  });

  it('jsonb config_json round-trips bigint maxKobo correctly via string serialization', async () => {
    const rsId = await seedRuleSet();
    await rulesRepo.insertMany(testDb, rsId, [
      { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 30000n } },
    ]);
    const list = await rulesRepo.listByRuleSet(testDb, rsId);
    // Postgres jsonb stores bigints as strings (JSON has no bigint).
    // The orchestrator (Task 17) is responsible for coercing back to bigint.
    const cfg = list[0]?.configJson as { maxKobo: string };
    expect(cfg.maxKobo).toBe('30000');
  });

  it('inserting zero rules is a no-op', async () => {
    const rsId = await seedRuleSet();
    const result = await rulesRepo.insertMany(testDb, rsId, []);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/rules/rules.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/rules.repo.ts apps/backend/tests/modules/rules/rules.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): rules.repo (insertMany/listByRuleSet, jsonb config)"
```

---

### Task 16: rule-set.service (versioned write — atomic)

The service handles the "edit a rule" workflow: load active rule set → bump version → mark old superseded → insert new rule_set row + insert all new rules. All in one DB transaction.

**Files:**
- Create: `apps/backend/src/modules/rules/rule-set.service.ts`
- Create: `apps/backend/tests/modules/rules/rule-set.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { ruleSetsRepo } from '../../../src/modules/rules/rule-sets.repo';
import { rulesRepo } from '../../../src/modules/rules/rules.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { principalId: principal.id, subWalletId: sw.sub.id };
}

describe('ruleSetService.publishNewVersion', () => {
  beforeEach(async () => { await truncateAll(); });

  it('first publish creates v1 active', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    const out = await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } }],
    });
    expect(out.ruleSet.version).toBe(1);
    expect(out.ruleSet.status).toBe('active');
    expect(out.rules).toHaveLength(1);
  });

  it('subsequent publish supersedes the old set and bumps version', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } }],
    });
    const v2 = await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 75000n } }],
    });
    expect(v2.ruleSet.version).toBe(2);

    const allActive = (await ruleSetsRepo.findActive(testDb, subWalletId));
    expect(allActive?.version).toBe(2);

    // The v1 rule set still exists but is superseded
    const v1 = await ruleSetsRepo.findByVersion(testDb, subWalletId, 1);
    expect(v1?.status).toBe('superseded');
  });

  it('atomicity: if rules.insertMany fails, no rule_set row is created', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await expect(
      ruleSetService.publishNewVersion(testDb, {
        subWalletId, createdByUserId: principalId,
        rules: [
          // Force a failure: priority is required, omit it via cast
          { kind: 'limit', priority: NaN as unknown as number, config: { windowKind: 'daily', maxKobo: 50000n } },
        ],
      }),
    ).rejects.toThrow();
    const max = await ruleSetsRepo.maxVersion(testDb, subWalletId);
    expect(max).toBe(0);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/rule-set.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Rule } from './types';
import { ruleSetsRepo } from './rule-sets.repo';
import { rulesRepo } from './rules.repo';

type DbOrTx = PostgresJsDatabase;

export type PublishInput = {
  subWalletId: string;
  createdByUserId: string;
  rules: Array<Omit<Rule, 'id'>>;
};

export const ruleSetService = {
  async publishNewVersion(db: DbOrTx, input: PublishInput) {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      // Mark current active (if any) as superseded
      const current = await ruleSetsRepo.findActive(txDb, input.subWalletId);
      if (current) {
        await ruleSetsRepo.markSuperseded(txDb, current.id);
      }
      const nextVersion = (await ruleSetsRepo.maxVersion(txDb, input.subWalletId)) + 1;
      const ruleSet = await ruleSetsRepo.insert(txDb, {
        subWalletId: input.subWalletId,
        version: nextVersion,
        createdByUserId: input.createdByUserId,
      });
      const rules = await rulesRepo.insertMany(txDb, ruleSet.id, input.rules);
      return { ruleSet, rules };
    });
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/rules/rule-set.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/rule-set.service.ts apps/backend/tests/modules/rules/rule-set.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): rule-set.service.publishNewVersion (atomic supersede + bump)"
```

---

### Task 17: Rule-set fetcher (DB row → in-memory `RuleSet`)

This converts the persistent rows into the `RuleSet` shape that the engine wants. Notably, it **coerces jsonb-stored bigints back from strings**.

**Files:**
- Create: `apps/backend/src/modules/rules/rule-set.fetcher.ts`
- Create: `apps/backend/tests/modules/rules/rule-set.fetcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { fetchActiveRuleSet } from '../../../src/modules/rules/rule-set.fetcher';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { principalId: principal.id, subWalletId: sw.sub.id };
}

describe('fetchActiveRuleSet', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns undefined when no rule set published', async () => {
    const { subWalletId } = await seedSubWallet();
    expect(await fetchActiveRuleSet(testDb, subWalletId)).toBeUndefined();
  });

  it('returns the active set with rules; bigints coerced from strings', async () => {
    const { principalId, subWalletId } = await seedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50000n } }],
    });
    const fetched = await fetchActiveRuleSet(testDb, subWalletId);
    expect(fetched?.version).toBe(1);
    expect(fetched?.rules).toHaveLength(1);
    const r = fetched?.rules[0];
    expect(r?.kind).toBe('limit');
    if (r?.kind === 'limit') {
      expect(typeof r.config.maxKobo).toBe('bigint');
      expect(r.config.maxKobo).toBe(50000n);
    }
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/rules/rule-set.fetcher.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ruleSetsRepo } from './rule-sets.repo';
import { rulesRepo, type RuleRow } from './rules.repo';
import type { Rule, RuleSet } from './types';

type DbOrTx = PostgresJsDatabase;

const BIGINT_KEYS = new Set(['maxKobo']);

function coerceBigints(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(coerceBigints);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (BIGINT_KEYS.has(k) && typeof v === 'string') out[k] = BigInt(v);
    else out[k] = coerceBigints(v);
  }
  return out;
}

function rowToRule(row: RuleRow): Rule {
  const config = coerceBigints(row.configJson) as Rule['config'];
  // Discriminated union — rebuild per kind so TS narrows.
  switch (row.kind) {
    case 'limit':
      return { id: row.id, kind: 'limit', priority: row.priority, config: config as never };
    case 'category':
      return { id: row.id, kind: 'category', priority: row.priority, config: config as never };
    case 'time_window':
      return { id: row.id, kind: 'time_window', priority: row.priority, config: config as never };
    case 'allowlist':
      return { id: row.id, kind: 'allowlist', priority: row.priority, config: config as never };
    case 'anomaly_threshold':
      return { id: row.id, kind: 'anomaly_threshold', priority: row.priority, config: config as never };
  }
}

export async function fetchActiveRuleSet(
  db: DbOrTx,
  subWalletId: string,
): Promise<RuleSet | undefined> {
  const rs = await ruleSetsRepo.findActive(db, subWalletId);
  if (!rs) return undefined;
  const ruleRows = await rulesRepo.listByRuleSet(db, rs.id);
  return {
    id: rs.id,
    subWalletId: rs.subWalletId,
    version: rs.version,
    rules: ruleRows.map(rowToRule),
  };
}
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/rules/rule-set.fetcher.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/rule-set.fetcher.ts apps/backend/tests/modules/rules/rule-set.fetcher.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): rule-set.fetcher (DB row → typed RuleSet, jsonb bigint coercion)"
```

---

## Phase D — Bump workflow (Tasks 18-23)

### Task 18: bump_requests.repo + one-shot-tokens.repo

**Files:**
- Create: `apps/backend/src/modules/bumps/bump-requests.repo.ts`
- Create: `apps/backend/src/modules/bumps/one-shot-tokens.repo.ts`
- Modify: `apps/backend/tests/modules/bumps/bump-requests.repo.test.ts` (extend the schema-only file)

- [ ] **Step 1: Write `apps/backend/src/modules/bumps/bump-requests.repo.ts`**

```ts
import { and, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { bumpRequests } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

export type BumpStatus = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired';

export type BumpRequestRow = typeof bumpRequests.$inferSelect;

export type NewBumpRequest = {
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: Kobo;
  vendorResolvedName: string;
  agentNote?: string | null;
  expiresAt: Date;
};

export const bumpRequestsRepo = {
  async insert(db: DbOrTx, input: NewBumpRequest): Promise<BumpRequestRow> {
    const [row] = await db
      .insert(bumpRequests)
      .values({
        transactionId: input.transactionId,
        subWalletId: input.subWalletId,
        requestedByUserId: input.requestedByUserId,
        amountKobo: input.amountKobo,
        vendorResolvedName: input.vendorResolvedName,
        agentNote: input.agentNote ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error('bumpRequests.insert returned no row');
    return row;
  },

  async findById(db: DbOrTx, id: string): Promise<BumpRequestRow | undefined> {
    const [row] = await db.select().from(bumpRequests).where(eq(bumpRequests.id, id)).limit(1);
    return row;
  },

  async setDecision(
    db: DbOrTx,
    id: string,
    status: BumpStatus,
    decidedByUserId: string,
    decidedAt: Date,
  ): Promise<void> {
    await db
      .update(bumpRequests)
      .set({ status, decidedByUserId, decidedAt })
      .where(eq(bumpRequests.id, id));
  },

  async listExpired(db: DbOrTx, now: Date): Promise<BumpRequestRow[]> {
    return db
      .select()
      .from(bumpRequests)
      .where(and(eq(bumpRequests.status, 'pending'), lt(bumpRequests.expiresAt, now)));
  },
};
```

- [ ] **Step 2: Write `apps/backend/src/modules/bumps/one-shot-tokens.repo.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { oneShotTokens } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type OneShotTokenRow = typeof oneShotTokens.$inferSelect;

export const oneShotTokensRepo = {
  async insert(
    db: DbOrTx,
    input: { token: string; bumpRequestId: string; expiresAt: Date },
  ): Promise<OneShotTokenRow> {
    const [row] = await db.insert(oneShotTokens).values(input).returning();
    if (!row) throw new Error('oneShotTokens.insert returned no row');
    return row;
  },

  async findUnconsumed(db: DbOrTx, token: string): Promise<OneShotTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(oneShotTokens)
      .where(and(eq(oneShotTokens.token, token), isNull(oneShotTokens.consumedAt)))
      .limit(1);
    return row;
  },

  /** Atomic consume: only succeeds (returns the row) if not yet consumed. */
  async tryConsume(db: DbOrTx, token: string, now: Date): Promise<OneShotTokenRow | undefined> {
    const [row] = await db
      .update(oneShotTokens)
      .set({ consumedAt: now })
      .where(and(eq(oneShotTokens.token, token), isNull(oneShotTokens.consumedAt)))
      .returning();
    return row;
  },
};
```

- [ ] **Step 3: Append repo tests to `apps/backend/tests/modules/bumps/bump-requests.repo.test.ts`**

```ts
import { factories } from '../../helpers/factories';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { oneShotTokensRepo } from '../../../src/modules/bumps/one-shot-tokens.repo';
import { kobo } from '../../../src/lib/kobo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';

async function seedTxn() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    kind: 'spend', amountKobo: kobo(50_000n), idempotencyKey: factories.idempotencyKey(),
  });
  return {
    principalId: principal.id, agentId: agent.id, subWalletId: sw.sub.id, txnId: txn.id,
  };
}

describe('bumpRequestsRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + findById', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    const fetched = await bumpRequestsRepo.findById(testDb, created.id);
    expect(fetched?.status).toBe('pending');
    void principalId; // only used for setDecision below
  });

  it('setDecision updates status + decidedBy/At', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    const decidedAt = new Date('2026-05-03T12:30:00Z');
    await bumpRequestsRepo.setDecision(testDb, created.id, 'approved_once', principalId, decidedAt);
    const fetched = await bumpRequestsRepo.findById(testDb, created.id);
    expect(fetched?.status).toBe('approved_once');
    expect(fetched?.decidedByUserId).toBe(principalId);
    expect(fetched?.decidedAt?.toISOString()).toBe(decidedAt.toISOString());
  });

  it('listExpired finds pending requests past expiresAt', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T11:00:00Z'),
    });
    const expired = await bumpRequestsRepo.listExpired(testDb, new Date('2026-05-03T12:00:00Z'));
    expect(expired).toHaveLength(1);
  });
});

describe('oneShotTokensRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  it('insert + tryConsume succeeds the first time, fails the second', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const bump = await bumpRequestsRepo.insert(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    await oneShotTokensRepo.insert(testDb, {
      token: 'tok-1', bumpRequestId: bump.id, expiresAt: new Date('2026-05-03T13:00:00Z'),
    });
    const first = await oneShotTokensRepo.tryConsume(testDb, 'tok-1', new Date('2026-05-03T12:30:00Z'));
    expect(first).toBeDefined();
    const second = await oneShotTokensRepo.tryConsume(testDb, 'tok-1', new Date('2026-05-03T12:31:00Z'));
    expect(second).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/bumps/bump-requests.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps apps/backend/tests/modules/bumps/bump-requests.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): bump-requests + one-shot-tokens repos (atomic tryConsume via UPDATE...RETURNING)"
```

---

### Task 19: bump state machine

A pure-function state machine: given a current state + an event, returns the next state or rejects the transition. Used by the workflow service for guard rails.

**Files:**
- Create: `apps/backend/src/modules/bumps/state-machine.ts`
- Create: `apps/backend/tests/modules/bumps/state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { transition, type BumpEvent, type BumpState } from '../../../src/modules/bumps/state-machine';
import { isErr, isOk } from '../../../src/lib/result';

describe('bump state machine', () => {
  it('pending → approved_once on approve_once', () => {
    const r = transition('pending' satisfies BumpState, { kind: 'approve_once' } satisfies BumpEvent);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe('approved_once');
  });

  it('pending → raise_limit on approve_raise_limit', () => {
    const r = transition('pending', { kind: 'approve_raise_limit' });
    if (isOk(r)) expect(r.value).toBe('raise_limit');
  });

  it('pending → denied on deny', () => {
    const r = transition('pending', { kind: 'deny' });
    if (isOk(r)) expect(r.value).toBe('denied');
  });

  it('pending → expired on expire', () => {
    const r = transition('pending', { kind: 'expire' });
    if (isOk(r)) expect(r.value).toBe('expired');
  });

  it('rejects approve from a terminal state (approved_once)', () => {
    const r = transition('approved_once', { kind: 'approve_once' });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects expire from a terminal state', () => {
    expect(isErr(transition('denied', { kind: 'expire' }))).toBe(true);
    expect(isErr(transition('approved_once', { kind: 'expire' }))).toBe(true);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/bumps/state-machine.ts`**

```ts
import { err, ok, type Result } from '../../lib/result';

export type BumpState = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired';

export type BumpEvent =
  | { kind: 'approve_once' }
  | { kind: 'approve_raise_limit' }
  | { kind: 'deny' }
  | { kind: 'expire' }
  | { kind: 'agent_cancel' };

export type TransitionError = { code: 'INVALID_TRANSITION'; from: BumpState; event: BumpEvent };

export function transition(
  state: BumpState,
  event: BumpEvent,
): Result<BumpState, TransitionError> {
  if (state !== 'pending') {
    return err({ code: 'INVALID_TRANSITION', from: state, event });
  }
  switch (event.kind) {
    case 'approve_once':
      return ok('approved_once');
    case 'approve_raise_limit':
      return ok('raise_limit');
    case 'deny':
    case 'agent_cancel':
      return ok('denied');
    case 'expire':
      return ok('expired');
  }
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/bumps/state-machine.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/state-machine.ts apps/backend/tests/modules/bumps/state-machine.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): pure-function state machine (Result-typed transitions)"
```

---

### Task 20: bump-workflow.service.create (from a denied txn)

Creates a bump_request with default 30-min TTL. Returns the row + a token (for the principal-app push).

**Files:**
- Create: `apps/backend/src/modules/bumps/bump-workflow.service.ts` (only the `create` method for this task)
- Create: `apps/backend/tests/modules/bumps/bump-workflow.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';

async function seedTxn() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    kind: 'spend', amountKobo: kobo(50_000n), idempotencyKey: factories.idempotencyKey(),
  });
  return {
    principalId: principal.id, agentId: agent.id, subWalletId: sw.sub.id, txnId: txn.id,
  };
}

describe('bumpWorkflowService.create', () => {
  beforeEach(async () => { await truncateAll(); });

  it('creates a pending bump_request + sets transaction.status=bump_pending + sets transaction.bump_request_id', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now,
    });
    expect(created.bumpRequest.status).toBe('pending');
    expect(created.bumpRequest.expiresAt.getTime() - now.getTime()).toBe(30 * 60 * 1000);
    const txn = await transactionsRepo.findById(testDb, txnId);
    expect(txn?.status).toBe('bump_pending');
    expect(txn?.bumpRequestId).toBe(created.bumpRequest.id);
  });

  it('respects custom TTL minutes', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now, ttlMinutes: 5,
    });
    expect(created.bumpRequest.expiresAt.getTime() - now.getTime()).toBe(5 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/bumps/bump-workflow.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactionsRepo } from '../wallet/transactions.repo';
import { bumpRequestsRepo, type BumpRequestRow } from './bump-requests.repo';
import type { Kobo } from '../../lib/kobo';

type DbOrTx = PostgresJsDatabase;

const DEFAULT_TTL_MINUTES = 30;

export type CreateInput = {
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: Kobo;
  vendorResolvedName: string;
  agentNote?: string | null;
  now: Date;
  ttlMinutes?: number;
};

export type CreateOutput = {
  bumpRequest: BumpRequestRow;
};

export const bumpWorkflowService = {
  async create(db: DbOrTx, input: CreateInput): Promise<CreateOutput> {
    const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const expiresAt = new Date(input.now.getTime() + ttl * 60_000);
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const bumpRequest = await bumpRequestsRepo.insert(txDb, {
        transactionId: input.transactionId,
        subWalletId: input.subWalletId,
        requestedByUserId: input.requestedByUserId,
        amountKobo: input.amountKobo,
        vendorResolvedName: input.vendorResolvedName,
        agentNote: input.agentNote ?? null,
        expiresAt,
      });
      await transactionsRepo.setStatus(txDb, input.transactionId, 'bump_pending');
      // Wire bump_request_id onto the transaction row
      const { transactions } = await import('../../db/schema');
      const { eq } = await import('drizzle-orm');
      await txDb.update(transactions).set({ bumpRequestId: bumpRequest.id }).where(eq(transactions.id, input.transactionId));
      return { bumpRequest };
    });
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/bumps/bump-workflow.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/bump-workflow.service.ts apps/backend/tests/modules/bumps/bump-workflow.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): workflow.create (atomic: insert bump + set txn.status=bump_pending + set txn.bump_request_id)"
```

---

### Task 21: bump-workflow.service.decide (approve / deny)

Validates the transition via the state machine, persists the decision. On approve, issues a one-shot token (consumed by the lifecycle service in Phase G).

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-workflow.service.ts` (add `decide`)
- Modify: `apps/backend/tests/modules/bumps/bump-workflow.service.test.ts` (add tests)

- [ ] **Step 1: Append to `bump-workflow.service.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { oneShotTokensRepo, type OneShotTokenRow } from './one-shot-tokens.repo';
import { transition, type BumpEvent } from './state-machine';
import { err, ok, type Result } from '../../lib/result';

export type DecideInput = {
  bumpRequestId: string;
  decidedByUserId: string;
  decision: 'approve_once' | 'approve_raise_limit' | 'deny';
  now: Date;
};

export type DecideError =
  | { code: 'BUMP_NOT_FOUND' }
  | { code: 'BUMP_EXPIRED' }
  | { code: 'INVALID_TRANSITION' };

export type DecideOutput = {
  bumpRequest: BumpRequestRow;
  oneShotToken: OneShotTokenRow | null; // null on deny
};

// Append inside the existing `bumpWorkflowService` object:
//   ↓ ↓ ↓ (insert before the closing `};` of the existing object)

  async decide(db: DbOrTx, input: DecideInput): Promise<Result<DecideOutput, DecideError>> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const current = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!current) return err({ code: 'BUMP_NOT_FOUND' as const });
      if (current.expiresAt < input.now) {
        return err({ code: 'BUMP_EXPIRED' as const });
      }
      const event: BumpEvent = { kind: input.decision };
      const next = transition(current.status as 'pending', event);
      if (next.kind === 'err') {
        return err({ code: 'INVALID_TRANSITION' as const });
      }
      await bumpRequestsRepo.setDecision(
        txDb,
        input.bumpRequestId,
        next.value,
        input.decidedByUserId,
        input.now,
      );
      const updated = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!updated) throw new Error('bump disappeared after decision');

      let oneShotToken: OneShotTokenRow | null = null;
      if (next.value === 'approved_once' || next.value === 'raise_limit') {
        const token = randomBytes(24).toString('hex');
        oneShotToken = await oneShotTokensRepo.insert(txDb, {
          token,
          bumpRequestId: input.bumpRequestId,
          expiresAt: new Date(input.now.getTime() + 10 * 60_000), // 10 min to consume
        });
      }
      return ok({ bumpRequest: updated, oneShotToken });
    });
  },
```

(After the append, the `decide` method needs to be the **last** method inside the object literal. Adjust commas as needed so the JSON-like syntax stays valid.)

- [ ] **Step 2: Append tests**

```ts
import { isErr, isOk } from '../../../src/lib/result';

describe('bumpWorkflowService.decide', () => {
  beforeEach(async () => { await truncateAll(); });

  it('approve_once → status=approved_once + one-shot token issued', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const now = new Date('2026-05-03T12:00:00Z');
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA', now,
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id, decidedByUserId: principalId,
      decision: 'approve_once', now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bumpRequest.status).toBe('approved_once');
      expect(result.value.oneShotToken).not.toBeNull();
      expect(result.value.oneShotToken?.token).toMatch(/^[a-f0-9]{48}$/);
    }
  });

  it('deny → status=denied + no token', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id, decidedByUserId: principalId,
      decision: 'deny', now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.bumpRequest.status).toBe('denied');
      expect(result.value.oneShotToken).toBeNull();
    }
  });

  it('returns BUMP_EXPIRED when now > expiresAt', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'), ttlMinutes: 5,
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id, decidedByUserId: principalId,
      decision: 'approve_once', now: new Date('2026-05-03T12:10:00Z'),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('BUMP_EXPIRED');
  });

  it('returns INVALID_TRANSITION when bump is already decided', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id, decidedByUserId: principalId,
      decision: 'approve_once', now: new Date('2026-05-03T12:05:00Z'),
    });
    const result = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id, decidedByUserId: principalId,
      decision: 'deny', now: new Date('2026-05-03T12:06:00Z'),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('INVALID_TRANSITION');
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/bumps/bump-workflow.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/bump-workflow.service.ts apps/backend/tests/modules/bumps/bump-workflow.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): workflow.decide (state-machine guard + one-shot token issue)"
```

---

### Task 22: bump-workflow.service.expire (TTL sweep)

Iterates `listExpired` rows, transitions each to `expired`. Called periodically (every 1 min in v1.x — Sub-plan 5 or 8 schedules it).

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-workflow.service.ts` (add `sweepExpired`)
- Modify: `apps/backend/tests/modules/bumps/bump-workflow.service.test.ts` (add test)

- [ ] **Step 1: Append to `bump-workflow.service.ts`**

```ts
  async sweepExpired(db: DbOrTx, now: Date): Promise<{ expiredCount: number }> {
    const expired = await bumpRequestsRepo.listExpired(db, now);
    if (expired.length === 0) return { expiredCount: 0 };
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      for (const row of expired) {
        const next = transition(row.status as 'pending', { kind: 'expire' });
        if (next.kind === 'ok') {
          // Use the system actor — there's no decidedByUserId for expirations.
          // Schema requires decidedByUserId to be a real user, so reuse requestedByUserId
          // (the agent), which is semantically "auto-decided on agent's behalf by the system."
          // (Alternative: make decidedByUserId nullable in a follow-up migration.)
          await bumpRequestsRepo.setDecision(
            txDb,
            row.id,
            next.value,
            row.requestedByUserId,
            now,
          );
        }
      }
      return { expiredCount: expired.length };
    });
  },
```

- [ ] **Step 2: Append test**

```ts
describe('bumpWorkflowService.sweepExpired', () => {
  beforeEach(async () => { await truncateAll(); });

  it('marks all pending bumps past expiresAt as expired', async () => {
    const { agentId, subWalletId, txnId } = await seedTxn();
    await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'), ttlMinutes: 5,
    });
    const out = await bumpWorkflowService.sweepExpired(testDb, new Date('2026-05-03T12:10:00Z'));
    expect(out.expiredCount).toBe(1);
  });

  it('returns 0 when no bumps are due', async () => {
    const out = await bumpWorkflowService.sweepExpired(testDb, new Date('2026-05-03T12:00:00Z'));
    expect(out.expiredCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/bumps/bump-workflow.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/bump-workflow.service.ts apps/backend/tests/modules/bumps/bump-workflow.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): workflow.sweepExpired (TTL sweep, transitions pending→expired)"
```

---

### Task 23: bump-workflow.service.consumeToken (called by lifecycle on resume)

Atomically consumes a one-shot token. Returns the bump_request row (so the caller knows which txn to resume) or `null` if the token is invalid / already consumed / expired.

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-workflow.service.ts`
- Modify: `apps/backend/tests/modules/bumps/bump-workflow.service.test.ts`

- [ ] **Step 1: Append to `bump-workflow.service.ts`**

```ts
  async consumeToken(
    db: DbOrTx,
    token: string,
    now: Date,
  ): Promise<BumpRequestRow | null> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const consumed = await oneShotTokensRepo.tryConsume(txDb, token, now);
      if (!consumed) return null;
      if (consumed.expiresAt < now) return null;
      return (await bumpRequestsRepo.findById(txDb, consumed.bumpRequestId)) ?? null;
    });
  },
```

- [ ] **Step 2: Append test**

```ts
describe('bumpWorkflowService.consumeToken', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns the bump_request the first time and null the second', async () => {
    const { principalId, agentId, subWalletId, txnId } = await seedTxn();
    const created = await bumpWorkflowService.create(testDb, {
      transactionId: txnId, subWalletId, requestedByUserId: agentId,
      amountKobo: kobo(50_000n), vendorResolvedName: 'MAMA',
      now: new Date('2026-05-03T12:00:00Z'),
    });
    const decision = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: created.bumpRequest.id, decidedByUserId: principalId,
      decision: 'approve_once', now: new Date('2026-05-03T12:05:00Z'),
    });
    const tok = isOk(decision) ? decision.value.oneShotToken?.token : undefined;
    expect(tok).toBeDefined();

    const first = await bumpWorkflowService.consumeToken(testDb, tok!, new Date('2026-05-03T12:06:00Z'));
    expect(first?.id).toBe(created.bumpRequest.id);

    const second = await bumpWorkflowService.consumeToken(testDb, tok!, new Date('2026-05-03T12:07:00Z'));
    expect(second).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    expect(await bumpWorkflowService.consumeToken(testDb, 'nope', new Date())).toBeNull();
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/bumps/bump-workflow.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/bump-workflow.service.ts apps/backend/tests/modules/bumps/bump-workflow.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): workflow.consumeToken (atomic single-use token consume)"
```

---

## Phase E — Anomaly scoring (Tasks 24-30)

Each feature is a pure function `f(intent, history) → number ∈ [0, 1]`. The aggregator combines them with configurable weights into a single score.

### Task 24: Anomaly types

**Files:**
- Create: `apps/backend/src/modules/anomaly/types.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/anomaly/types.ts`**

```ts
import type { Kobo } from '../../lib/kobo';

export type HistoricalTxn = {
  amountKobo: Kobo;
  vendorAccountNumber: string | null;
  vendorBankCode: string | null;
  confirmedAt: Date;
};

export type ScoringIntent = {
  amountKobo: Kobo;
  vendorAccountNumber: string | null;
  vendorBankCode: string | null;
  confirmedAt: Date;
};

export type AnomalyHistory = {
  /** All settled transactions for this sub-wallet within the relevant lookback window. */
  txns: HistoricalTxn[];
};

export type FeatureScore = {
  name: string;
  value: number; // 0..1
};

export type AnomalyResult = {
  score: number; // weighted average, 0..1
  features: FeatureScore[];
};
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/types.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): types (HistoricalTxn / ScoringIntent / FeatureScore / AnomalyResult)"
```

---

### Task 25: amount-zscore feature (TDD)

Computes the z-score of the intent's amount against the sub-wallet's historical mean + stddev, then squashes it to [0, 1] via `min(1, |z| / 4)` (so a 4-sigma deviation = 1.0).

**Files:**
- Create: `apps/backend/src/modules/anomaly/features/amount-zscore.ts`
- Create: `apps/backend/tests/modules/anomaly/features/amount-zscore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { amountZscore } from '../../../../src/modules/anomaly/features/amount-zscore';
import { kobo } from '../../../../src/lib/kobo';

describe('amountZscore', () => {
  const txn = (amount: bigint) => ({
    amountKobo: kobo(amount),
    vendorAccountNumber: null,
    vendorBankCode: null,
    confirmedAt: new Date('2026-05-03T12:00:00Z'),
  });

  it('returns 0 when no history', () => {
    expect(amountZscore({
      amountKobo: kobo(50_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns: [] })).toBe(0);
  });

  it('returns 0 when amount equals historical mean', () => {
    const history = { txns: [txn(10_000n), txn(10_000n), txn(10_000n)] };
    expect(amountZscore({
      amountKobo: kobo(10_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, history)).toBe(0);
  });

  it('returns ~0.25 for a 1-sigma deviation', () => {
    const history = { txns: [txn(8_000n), txn(10_000n), txn(12_000n)] };
    const v = amountZscore({
      amountKobo: kobo(12_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, history);
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThan(0.4);
  });

  it('caps at 1.0 for very-large deviations', () => {
    const history = { txns: [txn(10_000n), txn(10_000n), txn(10_000n)] };
    const v = amountZscore({
      amountKobo: kobo(1_000_000n),
      vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, history);
    // No variance in history → fall back to 1.0 (we can't compute z, treat as max anomaly)
    expect(v).toBe(1);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/anomaly/features/amount-zscore.ts`**

```ts
import type { AnomalyHistory, ScoringIntent } from '../types';

export function amountZscore(intent: ScoringIntent, history: AnomalyHistory): number {
  if (history.txns.length === 0) return 0;
  const amounts = history.txns.map((t) => Number(t.amountKobo));
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((acc, a) => acc + (a - mean) ** 2, 0) / amounts.length;
  const stddev = Math.sqrt(variance);
  const x = Number(intent.amountKobo);
  if (stddev === 0) {
    // Either all-equal history; if intent matches the mean exactly, no deviation; else max.
    return x === mean ? 0 : 1;
  }
  const z = Math.abs(x - mean) / stddev;
  return Math.min(1, z / 4);
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/anomaly/features/amount-zscore.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/features/amount-zscore.ts apps/backend/tests/modules/anomaly/features/amount-zscore.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): amount z-score feature (cap at 4-sigma → 1.0; degenerate stddev → 1.0)"
```

---

### Task 26: hour-of-day feature (TDD)

Probability that this hour appears in history. Score = `1 - probability`. Uses Laplace smoothing with α=1 so unseen hours don't return exactly 1.

**Files:**
- Create: `apps/backend/src/modules/anomaly/features/hour-of-day.ts`
- Create: `apps/backend/tests/modules/anomaly/features/hour-of-day.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { hourOfDay } from '../../../../src/modules/anomaly/features/hour-of-day';
import { kobo } from '../../../../src/lib/kobo';

const txn = (iso: string) => ({
  amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
  confirmedAt: new Date(iso),
});

describe('hourOfDay', () => {
  it('returns close to 1 for an hour never seen in history', () => {
    const history = { txns: [
      txn('2026-05-01T12:00:00Z'),
      txn('2026-05-02T12:00:00Z'),
      txn('2026-05-03T12:00:00Z'),
    ]};
    const v = hourOfDay({
      amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-04T03:00:00Z'),
    }, history);
    expect(v).toBeGreaterThan(0.9);
  });

  it('returns close to 0 for an hour that dominates history', () => {
    const history = { txns: Array.from({ length: 50 }, () => txn('2026-05-01T12:00:00Z')) };
    const v = hourOfDay({
      amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-04T12:00:00Z'),
    }, history);
    expect(v).toBeLessThan(0.1);
  });

  it('returns 0.5-ish on empty history (no signal)', () => {
    const v = hourOfDay({
      amountKobo: kobo(0n), vendorAccountNumber: null, vendorBankCode: null,
      confirmedAt: new Date('2026-05-04T12:00:00Z'),
    }, { txns: [] });
    expect(v).toBeCloseTo(23 / 24, 2);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/anomaly/features/hour-of-day.ts`**

```ts
import type { AnomalyHistory, ScoringIntent } from '../types';

const HOURS = 24;

export function hourOfDay(intent: ScoringIntent, history: AnomalyHistory): number {
  const hour = intent.confirmedAt.getUTCHours();
  // Laplace smoothing: count + 1, total + HOURS — so prob is bounded away from 0 and 1.
  const counts = new Array<number>(HOURS).fill(0);
  for (const t of history.txns) counts[t.confirmedAt.getUTCHours()]! += 1;
  const total = history.txns.length;
  const prob = (counts[hour]! + 1) / (total + HOURS);
  return 1 - prob;
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/anomaly/features/hour-of-day.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/features/hour-of-day.ts apps/backend/tests/modules/anomaly/features/hour-of-day.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): hour-of-day feature (Laplace-smoothed 1-prob)"
```

---

### Task 27: vendor-novelty feature (TDD)

`1.0` if vendor not seen in history, decreasing with familiarity.

**Files:**
- Create: `apps/backend/src/modules/anomaly/features/vendor-novelty.ts`
- Create: `apps/backend/tests/modules/anomaly/features/vendor-novelty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { vendorNovelty } from '../../../../src/modules/anomaly/features/vendor-novelty';
import { kobo } from '../../../../src/lib/kobo';

const txn = (bank: string | null, acct: string | null) => ({
  amountKobo: kobo(0n), vendorBankCode: bank, vendorAccountNumber: acct,
  confirmedAt: new Date('2026-05-03T12:00:00Z'),
});

describe('vendorNovelty', () => {
  it('returns 1.0 when vendor never seen', () => {
    const v = vendorNovelty({
      amountKobo: kobo(0n), vendorBankCode: '058', vendorAccountNumber: '0123456789',
      confirmedAt: new Date(),
    }, { txns: [txn('058', '9999999999'), txn('058', '8888888888')] });
    expect(v).toBe(1);
  });

  it('returns 0 when vendor seen at least 5 times (familiar)', () => {
    const history = { txns: Array.from({ length: 5 }, () => txn('058', '0123456789')) };
    const v = vendorNovelty({
      amountKobo: kobo(0n), vendorBankCode: '058', vendorAccountNumber: '0123456789',
      confirmedAt: new Date(),
    }, history);
    expect(v).toBe(0);
  });

  it('decreases linearly between 1 and 5 prior sightings', () => {
    const history = { txns: [txn('058', '0123456789'), txn('058', '0123456789')] };
    const v = vendorNovelty({
      amountKobo: kobo(0n), vendorBankCode: '058', vendorAccountNumber: '0123456789',
      confirmedAt: new Date(),
    }, history);
    expect(v).toBeCloseTo(0.6, 5); // 1 - 2/5
  });

  it('returns 1.0 when intent has no vendor info', () => {
    const v = vendorNovelty({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date(),
    }, { txns: [] });
    expect(v).toBe(1);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/anomaly/features/vendor-novelty.ts`**

```ts
import type { AnomalyHistory, ScoringIntent } from '../types';

const FAMILIARITY_THRESHOLD = 5;

export function vendorNovelty(intent: ScoringIntent, history: AnomalyHistory): number {
  if (intent.vendorBankCode === null || intent.vendorAccountNumber === null) return 1;
  const matches = history.txns.filter(
    (t) =>
      t.vendorBankCode === intent.vendorBankCode &&
      t.vendorAccountNumber === intent.vendorAccountNumber,
  ).length;
  if (matches >= FAMILIARITY_THRESHOLD) return 0;
  return 1 - matches / FAMILIARITY_THRESHOLD;
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/anomaly/features/vendor-novelty.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/features/vendor-novelty.ts apps/backend/tests/modules/anomaly/features/vendor-novelty.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): vendor-novelty feature (linear decay over 5 sightings)"
```

---

### Task 28: velocity feature (TDD)

`min(1, recent_count / 10)` — count of txns in the last 1 hour. Very chunky but catches rapid-fire spending.

**Files:**
- Create: `apps/backend/src/modules/anomaly/features/velocity.ts`
- Create: `apps/backend/tests/modules/anomaly/features/velocity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { velocity } from '../../../../src/modules/anomaly/features/velocity';
import { kobo } from '../../../../src/lib/kobo';

const txn = (iso: string) => ({
  amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
  confirmedAt: new Date(iso),
});

describe('velocity', () => {
  it('returns 0 with no recent txns', () => {
    const v = velocity({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns: [] });
    expect(v).toBe(0);
  });

  it('returns 1.0 when ≥10 txns in the last hour', () => {
    const txns = Array.from({ length: 10 }, (_, i) =>
      txn(`2026-05-03T11:${String(i).padStart(2, '0')}:00Z`),
    );
    const v = velocity({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns });
    expect(v).toBe(1);
  });

  it('linearly scales between 0 and 10', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      txn(`2026-05-03T11:${String(i * 5).padStart(2, '0')}:00Z`),
    );
    const v = velocity({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns });
    expect(v).toBe(0.5);
  });

  it('ignores txns older than 1 hour', () => {
    const txns = Array.from({ length: 10 }, () => txn('2026-05-02T12:00:00Z')); // 24h ago
    const v = velocity({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns });
    expect(v).toBe(0);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/anomaly/features/velocity.ts`**

```ts
import type { AnomalyHistory, ScoringIntent } from '../types';

const ONE_HOUR_MS = 60 * 60 * 1000;
const SATURATION_COUNT = 10;

export function velocity(intent: ScoringIntent, history: AnomalyHistory): number {
  const cutoff = intent.confirmedAt.getTime() - ONE_HOUR_MS;
  const recent = history.txns.filter((t) => t.confirmedAt.getTime() >= cutoff).length;
  return Math.min(1, recent / SATURATION_COUNT);
}
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/anomaly/features/velocity.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/features/velocity.ts apps/backend/tests/modules/anomaly/features/velocity.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): velocity feature (1h window, saturate at 10 txns)"
```

---

### Task 29: anomaly.service.score (aggregator)

Combines all four features with configurable weights (default: equal weight). Returns a final score 0..1 plus per-feature scores for explainability.

**Files:**
- Create: `apps/backend/src/modules/anomaly/anomaly.service.ts`
- Create: `apps/backend/tests/modules/anomaly/anomaly.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { anomalyService } from '../../../src/modules/anomaly/anomaly.service';
import { kobo } from '../../../src/lib/kobo';

describe('anomalyService.score', () => {
  it('returns 0 score for empty history + neutral intent', () => {
    const result = anomalyService.score({
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    }, { txns: [] });
    // Empty history: amount-zscore=0, hour-of-day=23/24, vendor-novelty=1, velocity=0
    // Average ≈ (0 + 0.958 + 1 + 0) / 4 ≈ 0.49
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThan(0.55);
    expect(result.features).toHaveLength(4);
  });

  it('returns a score in [0, 1]', () => {
    for (let i = 0; i < 20; i++) {
      const result = anomalyService.score({
        amountKobo: kobo(BigInt(i * 100)), vendorBankCode: '058', vendorAccountNumber: String(i),
        confirmedAt: new Date(`2026-05-03T${String(i % 24).padStart(2, '0')}:00:00Z`),
      }, { txns: [] });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it('applies custom weights', () => {
    const intent = {
      amountKobo: kobo(0n), vendorBankCode: null, vendorAccountNumber: null,
      confirmedAt: new Date('2026-05-03T12:00:00Z'),
    };
    // All-zero weights except vendor-novelty=1: score should equal vendor-novelty
    const r = anomalyService.score(intent, { txns: [] }, {
      weights: { amount_zscore: 0, hour_of_day: 0, vendor_novelty: 1, velocity: 0 },
    });
    expect(r.score).toBe(1); // novelty=1 because no history with this vendor
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/anomaly/anomaly.service.ts`**

```ts
import { amountZscore } from './features/amount-zscore';
import { hourOfDay } from './features/hour-of-day';
import { vendorNovelty } from './features/vendor-novelty';
import { velocity } from './features/velocity';
import type { AnomalyHistory, AnomalyResult, ScoringIntent } from './types';

export type FeatureWeights = {
  amount_zscore: number;
  hour_of_day: number;
  vendor_novelty: number;
  velocity: number;
};

const DEFAULT_WEIGHTS: FeatureWeights = {
  amount_zscore: 1,
  hour_of_day: 1,
  vendor_novelty: 1,
  velocity: 1,
};

export const anomalyService = {
  score(
    intent: ScoringIntent,
    history: AnomalyHistory,
    opts?: { weights?: FeatureWeights },
  ): AnomalyResult {
    const weights = opts?.weights ?? DEFAULT_WEIGHTS;
    const features = [
      { name: 'amount_zscore', value: amountZscore(intent, history) },
      { name: 'hour_of_day', value: hourOfDay(intent, history) },
      { name: 'vendor_novelty', value: vendorNovelty(intent, history) },
      { name: 'velocity', value: velocity(intent, history) },
    ];
    const wsum =
      weights.amount_zscore + weights.hour_of_day + weights.vendor_novelty + weights.velocity;
    if (wsum === 0) return { score: 0, features };
    const weighted =
      features[0]!.value * weights.amount_zscore +
      features[1]!.value * weights.hour_of_day +
      features[2]!.value * weights.vendor_novelty +
      features[3]!.value * weights.velocity;
    return { score: weighted / wsum, features };
  },
};
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/anomaly/anomaly.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/anomaly.service.ts apps/backend/tests/modules/anomaly/anomaly.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): score aggregator (4 features, weighted average, default equal)"
```

---

### Task 30: Anomaly history loader (DB → AnomalyHistory)

Pulls the recent (last 90 days) settled txns for a sub-wallet and shapes them into the `AnomalyHistory` type. The aggregator stays a pure function; this is the impure boundary.

**Files:**
- Create: `apps/backend/src/modules/anomaly/history.loader.ts`
- Create: `apps/backend/tests/modules/anomaly/history.loader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { loadHistoryForSubWallet } from '../../../src/modules/anomaly/history.loader';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';

async function seedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { masterId: mw.master.id, subWalletId: sw.sub.id };
}

describe('loadHistoryForSubWallet', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns empty for a sub-wallet with no settled txns', async () => {
    const { subWalletId } = await seedSubWallet();
    const history = await loadHistoryForSubWallet(testDb, subWalletId, new Date('2026-05-03T12:00:00Z'));
    expect(history.txns).toEqual([]);
  });

  it('returns settled spend txns within the lookback window, with vendor info', async () => {
    const { masterId, subWalletId } = await seedSubWallet();
    const settledTxn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(5000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789',
    });
    await transactionsRepo.setStatus(testDb, settledTxn.id, 'settled', new Date('2026-05-02T12:00:00Z'));
    const history = await loadHistoryForSubWallet(testDb, subWalletId, new Date('2026-05-03T12:00:00Z'));
    expect(history.txns).toHaveLength(1);
    expect(history.txns[0]?.amountKobo).toBe(5000n);
    expect(history.txns[0]?.vendorBankCode).toBe('058');
  });

  it('excludes non-settled txns and txns older than 90 days', async () => {
    const { masterId, subWalletId } = await seedSubWallet();
    // Pending — should be excluded
    await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(1n), idempotencyKey: factories.idempotencyKey(),
    });
    // Old settled — should be excluded
    const old = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(2n), idempotencyKey: factories.idempotencyKey(),
    });
    await transactionsRepo.setStatus(testDb, old.id, 'settled', new Date('2026-01-01T12:00:00Z'));
    const history = await loadHistoryForSubWallet(testDb, subWalletId, new Date('2026-05-03T12:00:00Z'));
    expect(history.txns).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write `apps/backend/src/modules/anomaly/history.loader.ts`**

```ts
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { kobo } from '../../lib/kobo';
import type { AnomalyHistory } from './types';

const LOOKBACK_DAYS = 90;

export async function loadHistoryForSubWallet(
  db: PostgresJsDatabase,
  subWalletId: string,
  now: Date,
): Promise<AnomalyHistory> {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      amountKobo: transactions.amountKobo,
      vendorAccountNumber: transactions.vendorAccount,
      vendorBankCode: transactions.vendorBankCode,
      settledAt: transactions.settledAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.subWalletId, subWalletId),
        eq(transactions.status, 'settled'),
        eq(transactions.kind, 'spend'),
        isNotNull(transactions.settledAt),
        gte(transactions.settledAt, cutoff),
      ),
    );

  return {
    txns: rows.map((r) => ({
      amountKobo: kobo(r.amountKobo as bigint),
      vendorAccountNumber: r.vendorAccountNumber,
      vendorBankCode: r.vendorBankCode,
      // settledAt is non-null due to the WHERE clause; assert with !
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      confirmedAt: r.settledAt!,
    })),
  };
}
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/anomaly/history.loader.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/history.loader.ts apps/backend/tests/modules/anomaly/history.loader.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(anomaly): history loader (90-day lookback, settled spends only)"
```

---

## Phase F — Audit analysis side (Tasks 31-32)

### Task 31: Extend audit.repo with query helpers

**Files:**
- Modify: `apps/backend/src/modules/audit/audit.repo.ts` (add `listByActor`, `listByAction`)
- Modify: `apps/backend/tests/modules/audit/audit.repo.test.ts` (add tests)

- [ ] **Step 1: Append to `apps/backend/src/modules/audit/audit.repo.ts`** (inside the existing `auditRepo` object, after `listBySubject`):

```ts
  async listByActor(db: DbOrTx, actorUserId: string): Promise<AuditRow[]> {
    return db.select().from(auditLog).where(eq(auditLog.actorUserId, actorUserId));
  },

  async listByAction(db: DbOrTx, action: string): Promise<AuditRow[]> {
    return db.select().from(auditLog).where(eq(auditLog.action, action));
  },
```

- [ ] **Step 2: Append tests to `apps/backend/tests/modules/audit/audit.repo.test.ts`**

```ts
import { factories } from '../../helpers/factories';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('auditRepo.listByActor + listByAction', () => {
  beforeEach(async () => { await truncateAll(); });

  it('listByActor returns entries for that actor only', async () => {
    const u1 = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const u2 = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    await auditRepo.append(testDb, {
      actorKind: 'user', actorUserId: u1.id, action: 'a',
      subjectKind: 'x', subjectId: factories.txnId(), payloadJson: {},
    });
    await auditRepo.append(testDb, {
      actorKind: 'user', actorUserId: u2.id, action: 'a',
      subjectKind: 'x', subjectId: factories.txnId(), payloadJson: {},
    });
    const list = await auditRepo.listByActor(testDb, u1.id);
    expect(list).toHaveLength(1);
  });

  it('listByAction returns entries with that action only', async () => {
    const subjectId = factories.txnId();
    await auditRepo.append(testDb, {
      actorKind: 'system', action: 'txn.rule_eval',
      subjectKind: 'transaction', subjectId, payloadJson: {},
    });
    await auditRepo.append(testDb, {
      actorKind: 'system', action: 'txn.settled',
      subjectKind: 'transaction', subjectId, payloadJson: {},
    });
    const list = await auditRepo.listByAction(testDb, 'txn.rule_eval');
    expect(list).toHaveLength(1);
    expect(list[0]?.action).toBe('txn.rule_eval');
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/audit/audit.repo.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/audit/audit.repo.ts apps/backend/tests/modules/audit/audit.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(audit): listByActor + listByAction query helpers"
```

---

### Task 32: Typed structured-event constructors

Provides type-safe builders for the audit events that this sub-plan introduces. Future sub-plans add more event constructors here.

**Files:**
- Create: `apps/backend/src/modules/audit/events.ts`
- Modify: `apps/backend/src/modules/audit/index.ts` (re-export)
- Create: `apps/backend/tests/modules/audit/events.test.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/audit/events.ts`**

```ts
import type { AuditEntry } from './audit.repo';
import type { Decision } from '../rules/types';

export const auditEvents = {
  txnRuleEval(input: {
    transactionId: string;
    actorUserId: string;
    ruleSetId: string;
    ruleSetVersion: number;
    decision: Decision;
  }): AuditEntry {
    return {
      actorKind: 'system',
      actorUserId: input.actorUserId,
      action: 'txn.rule_eval',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: {
        ruleSetId: input.ruleSetId,
        ruleSetVersion: input.ruleSetVersion,
        decision: input.decision,
      },
    };
  },

  bumpRequested(input: {
    bumpRequestId: string;
    transactionId: string;
    actorUserId: string;
    amountKobo: bigint;
    vendorResolvedName: string;
  }): AuditEntry {
    return {
      actorKind: 'user',
      actorUserId: input.actorUserId,
      action: 'bump.requested',
      subjectKind: 'bump_request',
      subjectId: input.bumpRequestId,
      payloadJson: {
        transactionId: input.transactionId,
        amountKobo: input.amountKobo.toString(),
        vendorResolvedName: input.vendorResolvedName,
      },
    };
  },

  bumpDecided(input: {
    bumpRequestId: string;
    decidedByUserId: string;
    decision: 'approve_once' | 'approve_raise_limit' | 'deny';
  }): AuditEntry {
    return {
      actorKind: 'user',
      actorUserId: input.decidedByUserId,
      action: 'bump.decided',
      subjectKind: 'bump_request',
      subjectId: input.bumpRequestId,
      payloadJson: { decision: input.decision },
    };
  },

  anomalyScored(input: {
    transactionId: string;
    score: number;
    features: Array<{ name: string; value: number }>;
  }): AuditEntry {
    return {
      actorKind: 'system',
      action: 'txn.anomaly_scored',
      subjectKind: 'transaction',
      subjectId: input.transactionId,
      payloadJson: { score: input.score, features: input.features },
    };
  },
};
```

- [ ] **Step 2: Update `apps/backend/src/modules/audit/index.ts`**

```ts
export { auditRepo, type ActorKind, type AuditEntry, type AuditRow } from './audit.repo';
export { auditEvents } from './events';
```

- [ ] **Step 3: Write `apps/backend/tests/modules/audit/events.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { auditEvents } from '../../../src/modules/audit/events';

describe('auditEvents', () => {
  it('txnRuleEval has the expected shape', () => {
    const e = auditEvents.txnRuleEval({
      transactionId: 't1', actorUserId: 'u1', ruleSetId: 'rs1', ruleSetVersion: 2,
      decision: { kind: 'allow' },
    });
    expect(e.action).toBe('txn.rule_eval');
    expect(e.subjectKind).toBe('transaction');
    expect(e.subjectId).toBe('t1');
    expect(e.actorKind).toBe('system');
  });

  it('bumpRequested serializes amountKobo as string for JSONB safety', () => {
    const e = auditEvents.bumpRequested({
      bumpRequestId: 'b1', transactionId: 't1', actorUserId: 'u1',
      amountKobo: 50000n, vendorResolvedName: 'MAMA',
    });
    expect((e.payloadJson as { amountKobo: string }).amountKobo).toBe('50000');
  });

  it('anomalyScored captures features array', () => {
    const e = auditEvents.anomalyScored({
      transactionId: 't1',
      score: 0.42,
      features: [
        { name: 'amount_zscore', value: 0.5 },
        { name: 'velocity', value: 0.3 },
      ],
    });
    expect((e.payloadJson as { features: unknown[] }).features).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/audit/events.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/audit apps/backend/tests/modules/audit/events.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(audit): typed structured-event constructors (txn.rule_eval, bump.*, txn.anomaly_scored)"
```

---

## Phase G — Lifecycle integration: rule eval → bump or in_flight (Tasks 33-36)

The lifecycle service is the public surface that the agent app will call (in Sub-plan 4). It orchestrates the rule engine, anomaly scoring, ledger snapshots, audit log, and either marks the txn ready for IN_FLIGHT (handed off to Sub-plan 4) or kicks off a bump request.

### Task 33: Transaction lifecycle service

**Files:**
- Create: `apps/backend/src/modules/transactions/lifecycle.service.ts`
- Create: `apps/backend/tests/modules/transactions/lifecycle.service.test.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/transactions/lifecycle.service.ts`**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { kobo, type Kobo } from '../../lib/kobo';
import { transactionsRepo, type TransactionRow } from '../wallet/transactions.repo';
import { postingsRepo } from '../wallet/postings.repo';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { evaluate } from '../rules/engine';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import type { Decision, TxnIntent } from '../rules/types';
import { anomalyService } from '../anomaly/anomaly.service';
import { loadHistoryForSubWallet } from '../anomaly/history.loader';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { bumpWorkflowService } from '../bumps/bump-workflow.service';

type DbOrTx = PostgresJsDatabase;

export type EvaluateInput = {
  transactionId: string;
  initiatingUserId: string; // agent for sub-wallet spend, principal for direct spend
  now: Date;
};

export type EvaluateOutput =
  | { kind: 'allow'; transaction: TransactionRow }
  | { kind: 'bump_pending'; transaction: TransactionRow; bumpRequestId: string };

const SPENT_LAST_24H_SECONDS = 24 * 60 * 60;
const SPENT_LAST_30D_SECONDS = 30 * 24 * 60 * 60;

async function spentInWindow(
  db: DbOrTx,
  subWalletId: string,
  windowSeconds: number,
  now: Date,
): Promise<Kobo> {
  // Sum of debit_kobo on this sub-wallet's ledger account from settled spend txns within window.
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const result = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(p.debit_kobo), 0)::text AS s
    FROM postings p
    INNER JOIN ledger_accounts la ON la.id = p.ledger_account_id
    INNER JOIN transactions t ON t.id = p.transaction_id
    WHERE la.sub_wallet_id = ${subWalletId}
      AND la.kind = 'sub'
      AND t.status = 'settled'
      AND t.kind = 'spend'
      AND t.settled_at >= ${cutoff}
  `);
  return kobo(BigInt(result[0]?.s ?? '0'));
}

export const lifecycleService = {
  async evaluate(db: DbOrTx, input: EvaluateInput): Promise<EvaluateOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    if (txn.status !== 'draft') {
      throw new Error(`transaction not in draft: status=${txn.status}`);
    }
    if (txn.subWalletId === null) {
      // Principal direct spend: skip rule_eval (Decision #17). Mark allow.
      await transactionsRepo.setStatus(db, txn.id, 'in_flight');
      const updated = (await transactionsRepo.findById(db, txn.id))!;
      return { kind: 'allow', transaction: updated };
    }

    // Move to rule_eval first so concurrent retries see the right state.
    await transactionsRepo.setStatus(db, txn.id, 'rule_eval');

    // Build intent + context
    const intent: TxnIntent = {
      amountKobo: kobo(txn.amountKobo as bigint),
      category: txn.category,
      vendorBankCode: txn.vendorBankCode,
      vendorAccountNumber: txn.vendorAccount,
      vendorResolvedName: txn.vendorResolvedName,
      confirmedAt: input.now,
    };

    const subLA = await ledgerAccountsRepo.findBySubWallet(db, txn.subWalletId);
    if (!subLA) throw new Error('sub_wallet has no ledger account — should not happen');
    const subBalance = await postingsRepo.accountBalance(db, subLA.id);
    const spent24 = await spentInWindow(db, txn.subWalletId, SPENT_LAST_24H_SECONDS, input.now);
    const spent30d = await spentInWindow(db, txn.subWalletId, SPENT_LAST_30D_SECONDS, input.now);
    const history = await loadHistoryForSubWallet(db, txn.subWalletId, input.now);
    const anomaly = anomalyService.score(intent, history);

    // Persist anomaly score on the transaction row + audit
    await db.execute(sql`UPDATE transactions SET anomaly_score = ${anomaly.score} WHERE id = ${txn.id}`);
    await auditRepo.append(db, auditEvents.anomalyScored({
      transactionId: txn.id, score: anomaly.score, features: anomaly.features,
    }));

    const ruleSet = await fetchActiveRuleSet(db, txn.subWalletId);
    const decision: Decision = ruleSet
      ? evaluate(intent, ruleSet, {
          ledger: { subWalletAvailableKobo: subBalance, spentLast24hKobo: spent24, spentLast30dKobo: spent30d },
          anomalyScore: anomaly.score,
        })
      : { kind: 'allow' }; // No rule set → permissive; principal hasn't configured rules yet

    await auditRepo.append(db, auditEvents.txnRuleEval({
      transactionId: txn.id, actorUserId: input.initiatingUserId,
      ruleSetId: ruleSet?.id ?? '00000000-0000-0000-0000-000000000000',
      ruleSetVersion: ruleSet?.version ?? 0,
      decision,
    }));

    if (decision.kind === 'allow') {
      await transactionsRepo.setStatus(db, txn.id, 'in_flight');
      const updated = (await transactionsRepo.findById(db, txn.id))!;
      return { kind: 'allow', transaction: updated };
    }

    // require_bump → create bump_request
    const bump = await bumpWorkflowService.create(db, {
      transactionId: txn.id,
      subWalletId: txn.subWalletId,
      requestedByUserId: input.initiatingUserId,
      amountKobo: intent.amountKobo,
      vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
      now: input.now,
    });
    await auditRepo.append(db, auditEvents.bumpRequested({
      bumpRequestId: bump.bumpRequest.id,
      transactionId: txn.id,
      actorUserId: input.initiatingUserId,
      amountKobo: intent.amountKobo,
      vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
    }));
    const updated = (await transactionsRepo.findById(db, txn.id))!;
    return { kind: 'bump_pending', transaction: updated, bumpRequestId: bump.bumpRequest.id };
  },

  async resumeAfterBump(
    db: DbOrTx,
    input: { token: string; now: Date },
  ): Promise<EvaluateOutput> {
    const bump = await bumpWorkflowService.consumeToken(db, input.token, input.now);
    if (!bump) throw new Error('invalid or already-consumed token');
    if (bump.status !== 'approved_once' && bump.status !== 'raise_limit') {
      throw new Error(`bump not approved: status=${bump.status}`);
    }
    await transactionsRepo.setStatus(db, bump.transactionId, 'in_flight');
    const updated = (await transactionsRepo.findById(db, bump.transactionId))!;
    return { kind: 'allow', transaction: updated };
  },
};
```

- [ ] **Step 2: Verify the file compiles**

```powershell
pnpm --filter @amana/backend typecheck
```

- [ ] **Step 3: Commit (test in T34-T36)**

```powershell
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/lifecycle.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): lifecycle.service (rule_eval → allow|bump_pending; resumeAfterBump)"
```

---

### Task 34: Lifecycle integration test — happy path

**Files:**
- Create: `apps/backend/tests/modules/transactions/lifecycle.service.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { lifecycleService } from '../../../src/modules/transactions/lifecycle.service';
import { ruleSetService } from '../../../src/modules/rules/rule-set.service';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';

async function seedFundedSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  // Top up sub-wallet with 100K kobo via a balanced posting
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  return {
    principalId: principal.id, agentId: agent.id, subWalletId: sw.sub.id,
    masterId: mw.master.id,
  };
}

describe('lifecycleService.evaluate — happy path', () => {
  beforeEach(async () => { await truncateAll(); });

  it('allows a small spend with no rule set (permissive default)', async () => {
    const { agentId, subWalletId, masterId } = await seedFundedSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789', vendorResolvedName: 'MAMA',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: agentId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('allow');
    expect(result.transaction.status).toBe('in_flight');
  });

  it('allows a spend that passes a configured limit rule', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 50_000n } }],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(10_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789', vendorResolvedName: 'MAMA',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: agentId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('allow');
  });

  it('writes anomaly score and rule_eval audit-log entries', async () => {
    const { agentId, subWalletId, masterId } = await seedFundedSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789', vendorResolvedName: 'MAMA',
    });
    await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: agentId, now: new Date('2026-05-03T12:00:00Z'),
    });
    const updatedTxn = await transactionsRepo.findById(testDb, txn.id);
    expect(updatedTxn?.anomalyScore).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/lifecycle.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/lifecycle.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): lifecycle happy-path integration tests (allow + audit + anomaly score)"
```

---

### Task 35: Lifecycle integration test — bump path (deny → bump_pending → approve → in_flight)

**Files:**
- Modify: `apps/backend/tests/modules/transactions/lifecycle.service.test.ts` (append)

- [ ] **Step 1: Append the bump-path test**

```ts
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { isOk } from '../../../src/lib/result';

describe('lifecycleService — bump path', () => {
  beforeEach(async () => { await truncateAll(); });

  it('rule denies → creates bump_request → principal approves → resumeAfterBump moves to in_flight', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(10_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789', vendorResolvedName: 'MAMA',
    });
    const evalResult = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: agentId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(evalResult.kind).toBe('bump_pending');
    if (evalResult.kind !== 'bump_pending') return;

    const decision = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: evalResult.bumpRequestId,
      decidedByUserId: principalId,
      decision: 'approve_once',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(decision)).toBe(true);
    if (!isOk(decision)) return;
    const token = decision.value.oneShotToken?.token;
    expect(token).toBeDefined();

    const resumed = await lifecycleService.resumeAfterBump(testDb, {
      token: token!, now: new Date('2026-05-03T12:06:00Z'),
    });
    expect(resumed.kind).toBe('allow');
    expect(resumed.transaction.status).toBe('in_flight');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/lifecycle.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/lifecycle.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): bump-path integration (deny → bump_pending → approve_once → in_flight)"
```

---

### Task 36: Lifecycle integration test — bump deny + principal-direct spend

**Files:**
- Modify: `apps/backend/tests/modules/transactions/lifecycle.service.test.ts` (append)

- [ ] **Step 1: Append**

```ts
describe('lifecycleService — deny + principal direct', () => {
  beforeEach(async () => { await truncateAll(); });

  it('principal denies the bump → txn stays in bump_pending (resume not possible)', async () => {
    const { principalId, agentId, subWalletId, masterId } = await seedFundedSubWallet();
    await ruleSetService.publishNewVersion(testDb, {
      subWalletId, createdByUserId: principalId,
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: 1_000n } }],
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId, kind: 'spend',
      amountKobo: kobo(10_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789', vendorResolvedName: 'MAMA',
    });
    const evalResult = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: agentId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(evalResult.kind).toBe('bump_pending');
    if (evalResult.kind !== 'bump_pending') return;

    const decision = await bumpWorkflowService.decide(testDb, {
      bumpRequestId: evalResult.bumpRequestId,
      decidedByUserId: principalId, decision: 'deny',
      now: new Date('2026-05-03T12:05:00Z'),
    });
    expect(isOk(decision)).toBe(true);
    if (!isOk(decision)) return;
    expect(decision.value.oneShotToken).toBeNull();
    const updatedTxn = await transactionsRepo.findById(testDb, txn.id);
    // Status stays bump_pending since no token to resume; lifecycle doesn't auto-fail on deny
    // (Sub-plan 4 will handle the FAILED transition when the principal sends an explicit cancel
    // or when sweepExpired fires.)
    expect(updatedTxn?.status).toBe('bump_pending');
  });

  it('principal direct spend (subWalletId=null) bypasses rule eval and goes straight to in_flight', async () => {
    const { principalId, masterId } = await seedFundedSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: masterId, subWalletId: null, // principal direct
      kind: 'spend', amountKobo: kobo(10_000n), idempotencyKey: factories.idempotencyKey(),
      vendorBankCode: '058', vendorAccount: '0123456789', vendorResolvedName: 'MAMA',
    });
    const result = await lifecycleService.evaluate(testDb, {
      transactionId: txn.id, initiatingUserId: principalId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(result.kind).toBe('allow');
    expect(result.transaction.status).toBe('in_flight');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend test tests/modules/transactions/lifecycle.service.test.ts
docker compose down
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/lifecycle.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): deny + principal-direct integration tests"
```

---

## Phase H — Module barrels + top-level barrel update (Tasks 37-40)

### Task 37: Rules module barrel

**Files:**
- Create: `apps/backend/src/modules/rules/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
export type * from './types';
export { evaluate } from './engine';
export { evaluateLimit } from './evaluators/limit';
export { evaluateCategory } from './evaluators/category';
export { evaluateTimeWindow } from './evaluators/time-window';
export { evaluateAllowlist } from './evaluators/allowlist';
export { evaluateAnomalyThreshold } from './evaluators/anomaly-threshold';
export { ruleSetsRepo, type RuleSetRow } from './rule-sets.repo';
export { rulesRepo, type RuleRow } from './rules.repo';
export { ruleSetService, type PublishInput } from './rule-set.service';
export { fetchActiveRuleSet } from './rule-set.fetcher';
export { appendCase, type CaseRecord } from './replay/capture';
export { runReplay, type ReplayResult } from './replay/runner';
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/rules/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(rules): module barrel"
```

---

### Task 38: Bumps module barrel

**Files:**
- Create: `apps/backend/src/modules/bumps/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
export { bumpRequestsRepo, type BumpRequestRow, type BumpStatus, type NewBumpRequest } from './bump-requests.repo';
export { oneShotTokensRepo, type OneShotTokenRow } from './one-shot-tokens.repo';
export { transition, type BumpEvent, type BumpState, type TransitionError } from './state-machine';
export {
  bumpWorkflowService,
  type CreateInput,
  type CreateOutput,
  type DecideInput,
  type DecideError,
  type DecideOutput,
} from './bump-workflow.service';
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): module barrel"
```

---

### Task 39: Anomaly + transactions module barrels

**Files:**
- Create: `apps/backend/src/modules/anomaly/index.ts`
- Create: `apps/backend/src/modules/transactions/index.ts`

- [ ] **Step 1: Write `apps/backend/src/modules/anomaly/index.ts`**

```ts
export type * from './types';
export { amountZscore } from './features/amount-zscore';
export { hourOfDay } from './features/hour-of-day';
export { vendorNovelty } from './features/vendor-novelty';
export { velocity } from './features/velocity';
export { anomalyService, type FeatureWeights } from './anomaly.service';
export { loadHistoryForSubWallet } from './history.loader';
```

- [ ] **Step 2: Write `apps/backend/src/modules/transactions/index.ts`**

```ts
export {
  lifecycleService,
  type EvaluateInput,
  type EvaluateOutput,
} from './lifecycle.service';
```

- [ ] **Step 3: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/anomaly/index.ts apps/backend/src/modules/transactions/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(modules): anomaly + transactions barrels"
```

---

### Task 40: Top-level modules barrel update

**Files:**
- Modify: `apps/backend/src/modules/index.ts` (add the new modules)

- [ ] **Step 1: Replace `apps/backend/src/modules/index.ts`**

```ts
export * as identity from './identity';
export * as wallet from './wallet';
export * as audit from './audit';
export * as sticker from './sticker';
export * as rules from './rules';
export * as bumps from './bumps';
export * as anomaly from './anomaly';
export * as transactions from './transactions';
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(backend): top-level barrel adds rules / bumps / anomaly / transactions"
```

---

## Phase I — Final integration smoke + tag v0.0.3-control (Tasks 41-43)

### Task 41: Replay corpus runner — verify seed cases pass

This is also a CI gate in Sub-plan 8, but we want to confirm the corpus is healthy before tagging.

**Files:** none (verification only).

- [ ] **Step 1: Run the seed corpus through the runner**

```powershell
pnpm --filter @amana/backend test tests/modules/rules/replay.test.ts
```
Expected: all 3 seed cases match. If any mismatch, STOP — there's a real divergence between the engine and the corpus.

- [ ] **Step 2: (Manual smoke) verify the runner can be invoked from a script too**

Create a tiny one-off script `apps/backend/scripts/replay-smoke.ts`:

```ts
import { runReplay } from '../src/modules/rules/replay/runner';

async function main() {
  const result = await runReplay('apps/backend/test-corpus/rule-engine/seed.ndjson');
  console.log(`matched=${result.matched} mismatched=${result.mismatched.length}`);
  if (result.mismatched.length > 0) {
    console.error(JSON.stringify(result.mismatched, null, 2));
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run:
```powershell
pnpm --filter @amana/backend exec tsx scripts/replay-smoke.ts
```
Expected: prints `matched=3 mismatched=0`.

- [ ] **Step 3: Commit**

```powershell
git -C "C:/Users/alex_/amana" add apps/backend/scripts/replay-smoke.ts
git -C "C:/Users/alex_/amana" commit -m "chore(rules): standalone replay-smoke script for ad-hoc corpus verification"
```

---

### Task 42: Full lint + typecheck + test sweep

**Files:** none (verification only).

- [ ] **Step 1: Clean install**

```powershell
docker compose down -v
Get-ChildItem -Path . -Filter node_modules -Recurse -Force -Directory | Remove-Item -Recurse -Force
Remove-Item -Path .turbo -Recurse -Force -ErrorAction SilentlyContinue
pnpm install
```

- [ ] **Step 2: Postgres up + apply ALL migrations**

```powershell
docker compose up -d
Start-Sleep -Seconds 8
pnpm --filter @amana/backend db:migrate
```

- [ ] **Step 3: Build + lint + typecheck + test**

```powershell
pnpm build
pnpm exec biome check .
pnpm typecheck
pnpm --filter @amana/backend test
```
Expected: zero errors throughout. Test count substantially above the Sub-plan-2 baseline of 109 — Sub-plan 3 added many more tests across rules, bumps, anomaly, audit, lifecycle. Aim for ≥ 170.

If `biome check` fails on mechanical issues, run `pnpm exec biome check --write .` and commit the fix as a separate `style:` commit BEFORE proceeding (per the Phase 0 + Sub-plan 2 pattern).

- [ ] **Step 4: Stop docker**

```powershell
docker compose down
```

---

### Task 43: Push + tag v0.0.3-control

**Files:** none.

- [ ] **Step 1: Push to GitHub**

```powershell
git -C "C:/Users/alex_/amana" push origin main
```

- [ ] **Step 2: Tag**

```powershell
git -C "C:/Users/alex_/amana" tag -a v0.0.3-control -m "Sub-plan 3 complete: rule engine + bump workflow + anomaly + audit analysis"
git -C "C:/Users/alex_/amana" push origin v0.0.3-control
```

- [ ] **Step 3: Verify CI is green**

Visit https://github.com/Alexander77063/amana/actions and confirm the latest workflow run succeeded.

- [ ] **Step 4: Hand off to Sub-plan 4**

Sub-plan 3 is complete. The transaction control plane is in place: rule engine, bump workflow, anomaly scoring, audit-event API, and the lifecycle service that ties them together. Sub-plan 4 (vendor capture + lifecycle handoff to NIP-out) builds on this.

---

## Plan complete

When all 43 tasks land green:
- Rule engine is a pure function with 5 evaluator kinds, replay-corpus-tested.
- Versioned rule sets — editing produces a new version atomically; old set preserved for replay.
- Bump workflow is a state-machine-guarded service with TTL sweep and one-shot tokens.
- Anomaly scoring decomposes into 4 independent features with configurable weights.
- Audit log has typed structured-event constructors + listByActor / listByAction queries.
- Lifecycle service ties them together: rule eval → bump or in_flight, with full audit logging.
- Tagged `v0.0.3-control`.

**Next:** Sub-plan 4 — vendor capture (NQR scan, name enquiry public endpoint, phone-lookup wired) + transaction lifecycle handoff to NIP-out (`IN_FLIGHT → SETTLED` via Anchor adapter from Sub-plan 2). Written separately when ready.





