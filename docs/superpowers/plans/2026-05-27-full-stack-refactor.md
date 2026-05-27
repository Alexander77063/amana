# Full-Stack Layered Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade code quality, scalability, and maintainability across all four layers of the amana monorepo without changing any external behaviour.

**Architecture:** SQL is strictly confined to repository methods; services contain only business logic; routes validate with Zod and delegate to services; principal stores share utilities; agent sub-wallet state is reactive Zustand rather than a module-level singleton; the API client gains opt-in runtime response validation.

**Tech Stack:** Hono, Drizzle ORM, Postgres, Zod (already installed everywhere), Zustand (already in principal; added to agent), Vitest, React Native / Expo.

---

## File Map

**New files:**
- `apps/backend/src/lib/validate.ts` — Zod parseBody helper
- `apps/principal/src/lib/store-utils.ts` — shared `toErrorCode` helper
- `apps/principal/src/lib/logout.ts` — logout side-effect coordinator
- `apps/agent/src/state/agent.store.ts` — Zustand store replacing singleton
- `apps/backend/tests/lib/validate.test.ts` — unit test for parseBody
- `apps/backend/tests/modules/wallet/postings.repo.sumDebits.test.ts` — new repo method test
- `apps/backend/tests/modules/wallet/sub-wallets.repo.findPrincipal.test.ts` — new repo method test
- `apps/backend/tests/modules/bumps/bump-requests.repo.bulkExpire.test.ts` — new repo method test
- `apps/principal/src/lib/store-utils.test.ts` — unit test
- `apps/principal/src/lib/logout.test.ts` — unit test
- `apps/agent/src/state/agent.store.test.ts` — unit test

**Modified files:**
- `apps/backend/src/modules/wallet/postings.repo.ts` — add `sumDebitsInWindow()`
- `apps/backend/src/modules/wallet/sub-wallets.repo.ts` — add `findPrincipalAndAgent()`
- `apps/backend/src/modules/wallet/transactions.repo.ts` — add `attachMedia()`, `setAnomalyScore()`
- `apps/backend/src/modules/bumps/bump-requests.repo.ts` — add `bulkExpire()`
- `apps/backend/src/modules/transactions/lifecycle.service.ts` — transaction wrap + repo calls
- `apps/backend/src/modules/bumps/bump-workflow.service.ts` — use repo, add `cancelByAgent()`, batch sweep
- `apps/backend/src/routes/transactions.ts` — Zod + remove direct DB calls
- `apps/backend/src/routes/auth.ts` — Zod schemas
- `apps/backend/src/routes/sub-wallets.ts` — Zod schemas
- `apps/backend/src/routes/households.ts` — Zod schemas
- `apps/backend/src/routes/webhooks.ts` — Zod schemas
- `apps/backend/src/routes/pairing.ts` — Zod schemas
- `apps/backend/src/routes/devices.ts` — Zod schemas
- `apps/backend/src/routes/notification-prefs.ts` — Zod schemas
- `apps/backend/src/routes/media.ts` — Zod schemas
- `apps/backend/src/middleware/jwt-auth.ts` — log touchLastUsed errors
- `apps/backend/src/server.ts` — group `/` routes into meRouter
- `apps/principal/src/state/*.store.ts` (all 7) — replace local `ERR` with `toErrorCode`
- `apps/principal/src/state/auth.store.ts` — use `api.me.get()` + `runLogout`
- `apps/principal/src/state/subwallets.store.ts` — normalize to `byId`-only
- `apps/principal/src/screens/HomeDashboardScreen.tsx` — merge 3 useEffects into 1
- `apps/agent/package.json` — add `zustand`
- `apps/agent/src/nav/RootNavigator.tsx` — use store
- `apps/agent/src/screens/*.tsx` (11 files) — use store
- `packages/api-client/src/client.ts` — optional `schema` param on `request<T>()`

**Deleted files:**
- `apps/agent/src/lib/sub-wallet-memory.ts`

---

## Layer 1 — Backend

### Task 1: Add `postingsRepo.sumDebitsInWindow()`

**Files:**
- Modify: `apps/backend/src/modules/wallet/postings.repo.ts`
- Create: `apps/backend/tests/modules/wallet/postings.repo.sumDebits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/wallet/postings.repo.sumDebits.test.ts
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('postingsRepo.sumDebitsInWindow', () => {
  beforeEach(async () => { await truncateAll(); });

  async function seed() {
    const principal = await usersRepo.insert(testDb, { role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn() });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const { wallet: mw } = await masterWalletsRepo.provision(testDb, { householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058', anchorAccountId: 'anchor-acct-test' });
    const agent = await usersRepo.insert(testDb, { role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1' });
    const { sub, ledgerAccountId } = await subWalletsRepo.provision(testDb, { masterWalletId: mw.id, agentUserId: agent.id, name: 'Test SW' });
    return { subWalletId: sub.id, ledgerAccountId, masterWalletId: mw.id };
  }

  async function insertSettledSpend(masterWalletId: string, ledgerAccountId: string, amountKobo: bigint, settledAt: Date) {
    const txn = await transactionsRepo.insert(testDb, { masterWalletId, kind: 'spend', amountKobo: kobo(amountKobo), idempotencyKey: factories.idempotencyKey() });
    await transactionsRepo.setStatus(testDb, txn.id, 'settled', settledAt);
    await postingsRepo.insertMany(testDb, [{ transactionId: txn.id, ledgerAccountId, debitKobo: kobo(amountKobo), creditKobo: kobo(0n) }]);
    return txn;
  }

  it('sums debits within window, excludes outside', async () => {
    const { subWalletId, ledgerAccountId, masterWalletId } = await seed();
    const now = new Date('2025-01-10T12:00:00Z');
    const within = new Date('2025-01-09T12:00:00Z'); // 24h ago exactly is within
    const outside = new Date('2025-01-08T11:59:59Z'); // >24h ago is outside

    await insertSettledSpend(masterWalletId, ledgerAccountId, 5000n, within);
    await insertSettledSpend(masterWalletId, ledgerAccountId, 3000n, within);
    await insertSettledSpend(masterWalletId, ledgerAccountId, 9000n, outside);

    const result = await postingsRepo.sumDebitsInWindow(testDb, subWalletId, 24 * 60 * 60, now);
    expect(result).toBe(kobo(8000n));
  });

  it('returns zero when no debits in window', async () => {
    const { subWalletId } = await seed();
    const result = await postingsRepo.sumDebitsInWindow(testDb, subWalletId, 3600, new Date());
    expect(result).toBe(kobo(0n));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd apps/backend && pnpm vitest run tests/modules/wallet/postings.repo.sumDebits.test.ts
```

Expected: FAIL — `postingsRepo.sumDebitsInWindow is not a function`

- [ ] **Step 3: Add the method to `postings.repo.ts`**

In `apps/backend/src/modules/wallet/postings.repo.ts`, add after `accountBalance`:

```ts
/**
 * Sum of debit_kobo on sub-wallet's ledger account for 'settled' 'spend' transactions
 * whose settled_at falls within the last `windowSeconds` seconds from `now`.
 */
async sumDebitsInWindow(
  db: DbOrTx,
  subWalletId: string,
  windowSeconds: number,
  now: Date,
): Promise<Kobo> {
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
      AND t.settled_at >= ${cutoff.toISOString()}::timestamptz
  `);
  return kobo(BigInt(result[0]?.s ?? '0'));
},
```

Also add `kobo` to the imports at the top of the file:

```ts
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { postings } from '../../db/schema';
import { type Kobo, kobo } from '../../lib/kobo';
```

- [ ] **Step 4: Run test to confirm it passes**

```
cd apps/backend && pnpm vitest run tests/modules/wallet/postings.repo.sumDebits.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/backend/src/modules/wallet/postings.repo.ts apps/backend/tests/modules/wallet/postings.repo.sumDebits.test.ts
git commit -m "feat(backend): add postingsRepo.sumDebitsInWindow"
```

---

### Task 2: Add `subWalletsRepo.findPrincipalAndAgent()`

**Files:**
- Modify: `apps/backend/src/modules/wallet/sub-wallets.repo.ts`
- Create: `apps/backend/tests/modules/wallet/sub-wallets.repo.findPrincipal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/wallet/sub-wallets.repo.findPrincipal.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('subWalletsRepo.findPrincipalAndAgent', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns principalUserId and agentDisplayName for a valid sub-wallet', async () => {
    const principal = await usersRepo.insert(testDb, { role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn() });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'Test HH' });
    const { wallet: mw } = await masterWalletsRepo.provision(testDb, { householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058', anchorAccountId: 'anchor-acct-test' });
    const agent = await usersRepo.insert(testDb, { role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1' });
    const { sub } = await subWalletsRepo.provision(testDb, { masterWalletId: mw.id, agentUserId: agent.id, name: 'My Sub Wallet' });

    const result = await subWalletsRepo.findPrincipalAndAgent(testDb, sub.id);

    expect(result).not.toBeNull();
    expect(result?.principalUserId).toBe(principal.id);
    expect(result?.agentDisplayName).toBe('My Sub Wallet');
  });

  it('returns null for unknown sub-wallet id', async () => {
    const result = await subWalletsRepo.findPrincipalAndAgent(testDb, 'non-existent-id');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
cd apps/backend && pnpm vitest run tests/modules/wallet/sub-wallets.repo.findPrincipal.test.ts
```

Expected: FAIL — `subWalletsRepo.findPrincipalAndAgent is not a function`

- [ ] **Step 3: Add the method to `sub-wallets.repo.ts`**

Add these imports at the top of `apps/backend/src/modules/wallet/sub-wallets.repo.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { subWallets } from '../../db/schema';
import { ledgerAccountsRepo } from './ledger-accounts.repo';
```

Then add after `setStatus`:

```ts
/**
 * Resolves principal user id and agent display name from a sub-wallet id.
 * Used when dispatching notifications that require knowing who the principal is.
 * Returns null if the sub-wallet or its household chain is not found.
 */
async findPrincipalAndAgent(
  db: DbOrTx,
  subWalletId: string,
): Promise<{ principalUserId: string; agentDisplayName: string } | null> {
  const rows = await db.execute<{
    principal_user_id: string;
    agent_display_name: string;
  }>(sql`
    SELECT h.principal_user_id, sw.name AS agent_display_name
    FROM sub_wallets sw
    INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
    INNER JOIN households h ON h.id = mw.household_id
    WHERE sw.id = ${subWalletId}
    LIMIT 1
  `);
  if (!rows[0]) return null;
  return {
    principalUserId: rows[0].principal_user_id,
    agentDisplayName: rows[0].agent_display_name,
  };
},
```

- [ ] **Step 4: Run test to confirm pass**

```
cd apps/backend && pnpm vitest run tests/modules/wallet/sub-wallets.repo.findPrincipal.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```
git add apps/backend/src/modules/wallet/sub-wallets.repo.ts apps/backend/tests/modules/wallet/sub-wallets.repo.findPrincipal.test.ts
git commit -m "feat(backend): add subWalletsRepo.findPrincipalAndAgent"
```

---

### Task 3: Add `bumpRequestsRepo.bulkExpire()`, `transactionsRepo.attachMedia()`, `transactionsRepo.setAnomalyScore()`

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-requests.repo.ts`
- Modify: `apps/backend/src/modules/wallet/transactions.repo.ts`
- Create: `apps/backend/tests/modules/bumps/bump-requests.repo.bulkExpire.test.ts`

- [ ] **Step 1: Write failing test for bulkExpire**

```ts
// apps/backend/tests/modules/bumps/bump-requests.repo.bulkExpire.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('bumpRequestsRepo.bulkExpire', () => {
  beforeEach(async () => { await truncateAll(); });

  async function seed() {
    const principal = await usersRepo.insert(testDb, { role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn() });
    const agent = await usersRepo.insert(testDb, { role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1' });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const { wallet: mw } = await masterWalletsRepo.provision(testDb, { householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058', anchorAccountId: 'anchor-acct-test' });
    const { sub } = await subWalletsRepo.provision(testDb, { masterWalletId: mw.id, agentUserId: agent.id, name: 'SW' });
    return { principalId: principal.id, agentId: agent.id, subWalletId: sub.id, masterWalletId: mw.id };
  }

  async function insertBump(subWalletId: string, masterWalletId: string, requestedByUserId: string, expiresAt: Date) {
    const txn = await transactionsRepo.insert(testDb, { masterWalletId, kind: 'spend', amountKobo: kobo(1000n), idempotencyKey: factories.idempotencyKey() });
    return bumpRequestsRepo.insert(testDb, { transactionId: txn.id, subWalletId, requestedByUserId, amountKobo: kobo(1000n), vendorResolvedName: 'Vendor', expiresAt });
  }

  it('sets status to expired for all given ids', async () => {
    const { agentId, subWalletId, masterWalletId } = await seed();
    const past = new Date(Date.now() - 60_000);
    const b1 = await insertBump(subWalletId, masterWalletId, agentId, past);
    const b2 = await insertBump(subWalletId, masterWalletId, agentId, past);

    await bumpRequestsRepo.bulkExpire(testDb, [b1.id, b2.id], new Date());

    const r1 = await bumpRequestsRepo.findById(testDb, b1.id);
    const r2 = await bumpRequestsRepo.findById(testDb, b2.id);
    expect(r1?.status).toBe('expired');
    expect(r2?.status).toBe('expired');
  });

  it('is a no-op for empty array', async () => {
    // Should not throw
    await bumpRequestsRepo.bulkExpire(testDb, [], new Date());
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
cd apps/backend && pnpm vitest run tests/modules/bumps/bump-requests.repo.bulkExpire.test.ts
```

Expected: FAIL — `bumpRequestsRepo.bulkExpire is not a function`

- [ ] **Step 3: Add `bulkExpire` to `bump-requests.repo.ts`**

Add to imports: `import { and, desc, eq, inArray, lt } from 'drizzle-orm';`

Append to the `bumpRequestsRepo` object in `apps/backend/src/modules/bumps/bump-requests.repo.ts`:

```ts
/**
 * Batch-expire pending bumps by id in a single UPDATE.
 * Sets decided_by_user_id = requested_by_user_id so the NOT NULL constraint is satisfied.
 */
async bulkExpire(db: DbOrTx, ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    UPDATE bump_requests
    SET status = 'expired',
        decided_at = ${now.toISOString()}::timestamptz,
        decided_by_user_id = requested_by_user_id
    WHERE id = ANY(${ids}::uuid[])
      AND status = 'pending'
  `);
},
```

Also add `sql` to the drizzle-orm imports at the top.

- [ ] **Step 4: Add `attachMedia` and `setAnomalyScore` to `transactions.repo.ts`**

Append to the `transactionsRepo` object in `apps/backend/src/modules/wallet/transactions.repo.ts`:

```ts
async attachMedia(db: DbOrTx, id: string, mediaKey: string): Promise<void> {
  await db
    .update(transactions)
    .set({ attachedMedia: { key: mediaKey, uploadedAt: new Date().toISOString() } })
    .where(eq(transactions.id, id));
},

async setAnomalyScore(db: DbOrTx, id: string, score: number): Promise<void> {
  await db
    .update(transactions)
    .set({ anomalyScore: score })
    .where(eq(transactions.id, id));
},
```

- [ ] **Step 5: Run all wallet + bumps repo tests to confirm nothing broke**

```
cd apps/backend && pnpm vitest run tests/modules/wallet tests/modules/bumps/bump-requests.repo.bulkExpire.test.ts
```

Expected: All PASS

- [ ] **Step 6: Commit**

```
git add apps/backend/src/modules/bumps/bump-requests.repo.ts apps/backend/src/modules/wallet/transactions.repo.ts apps/backend/tests/modules/bumps/bump-requests.repo.bulkExpire.test.ts
git commit -m "feat(backend): add bulkExpire, attachMedia, setAnomalyScore repo methods"
```

---

### Task 4: Create `src/lib/validate.ts`

**Files:**
- Create: `apps/backend/src/lib/validate.ts`
- Create: `apps/backend/tests/lib/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/lib/validate.test.ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody } from '../../src/lib/validate';

describe('parseBody', () => {
  function makeApp(schema: z.ZodType) {
    const app = new Hono();
    app.post('/test', async (c) => {
      const result = await parseBody(c, schema);
      if (result instanceof Response) return result;
      return c.json({ received: result }, 200);
    });
    return app;
  }

  it('returns parsed data on valid body', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const app = makeApp(schema);
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex', age: 30 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toEqual({ name: 'Alex', age: 30 });
  });

  it('returns 400 with validation_error on missing required field', async () => {
    const schema = z.object({ name: z.string() });
    const app = makeApp(schema);
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: true }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('validation_error');
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it('returns 400 on non-JSON body', async () => {
    const schema = z.object({ name: z.string() });
    const app = makeApp(schema);
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('validation_error');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
cd apps/backend && pnpm vitest run tests/lib/validate.test.ts
```

Expected: FAIL — cannot find module `../../src/lib/validate`

- [ ] **Step 3: Create `src/lib/validate.ts`**

```ts
// apps/backend/src/lib/validate.ts
import type { Context } from 'hono';
import type { ZodType } from 'zod';

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T | Response> {
  const raw = await c.req.json().catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return c.json({ error: 'validation_error', issues: result.error.issues }, 400);
  }
  return result.data;
}
```

- [ ] **Step 4: Run to confirm pass**

```
cd apps/backend && pnpm vitest run tests/lib/validate.test.ts
```

Expected: All PASS

- [ ] **Step 5: Commit**

```
git add apps/backend/src/lib/validate.ts apps/backend/tests/lib/validate.test.ts
git commit -m "feat(backend): add parseBody Zod validation helper"
```

---

### Task 5: Update `lifecycleService.evaluate()` — wrap in transaction + use repo methods

**Files:**
- Modify: `apps/backend/src/modules/transactions/lifecycle.service.ts`

The existing tests in `tests/modules/transactions/lifecycle.service.test.ts` must continue to pass unchanged.

- [ ] **Step 1: Verify existing tests pass before touching anything**

```
cd apps/backend && pnpm vitest run tests/modules/transactions/lifecycle.service.test.ts
```

Expected: All PASS (baseline)

- [ ] **Step 2: Replace the file content**

Replace `apps/backend/src/modules/transactions/lifecycle.service.ts` with:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Kobo, kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { anomalyService } from '../anomaly/anomaly.service';
import { loadHistoryForSubWallet } from '../anomaly/history.loader';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { bumpWorkflowService } from '../bumps/bump-workflow.service';
import { notificationService } from '../notifications/notification.service';
import { evaluate } from '../rules/engine';
import { fetchActiveRuleSet } from '../rules/rule-set.fetcher';
import type { Decision, TxnIntent } from '../rules/types';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { postingsRepo } from '../wallet/postings.repo';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { type TransactionRow, transactionsRepo } from '../wallet/transactions.repo';

type DbOrTx = PostgresJsDatabase;

const SPENT_LAST_24H_SECONDS = 24 * 60 * 60;
const SPENT_LAST_30D_SECONDS = 30 * 24 * 60 * 60;

export type EvaluateInput = {
  transactionId: string;
  initiatingUserId: string;
  now: Date;
};

export type EvaluateOutput =
  | { kind: 'allow'; transaction: TransactionRow }
  | { kind: 'bump_pending'; transaction: TransactionRow; bumpRequestId: string };

export const lifecycleService = {
  async evaluate(db: DbOrTx, input: EvaluateInput): Promise<EvaluateOutput> {
    const txn = await transactionsRepo.findById(db, input.transactionId);
    if (!txn) throw new Error(`transaction not found: ${input.transactionId}`);
    if (txn.status !== 'draft') {
      throw new Error(`transaction not in draft: status=${txn.status}`);
    }

    // Principal direct spend: no sub-wallet means no rule evaluation needed.
    if (txn.subWalletId === null) {
      await transactionsRepo.setStatus(db, txn.id, 'in_flight');
      const updated = await transactionsRepo.findById(db, txn.id);
      if (!updated) throw new Error('transaction disappeared after status update');
      return { kind: 'allow', transaction: updated };
    }

    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;

      await transactionsRepo.setStatus(txDb, txn.id, 'rule_eval');

      const intent: TxnIntent = {
        amountKobo: kobo(txn.amountKobo as bigint),
        category: txn.category,
        vendorBankCode: txn.vendorBankCode,
        vendorAccountNumber: txn.vendorAccount,
        vendorResolvedName: txn.vendorResolvedName,
        confirmedAt: input.now,
      };

      const subLA = await ledgerAccountsRepo.findBySubWallet(txDb, txn.subWalletId!);
      if (!subLA) throw new Error('sub_wallet has no ledger account — should not happen');
      const subBalance = await postingsRepo.accountBalance(txDb, subLA.id);
      const spent24 = await postingsRepo.sumDebitsInWindow(txDb, txn.subWalletId!, SPENT_LAST_24H_SECONDS, input.now);
      const spent30d = await postingsRepo.sumDebitsInWindow(txDb, txn.subWalletId!, SPENT_LAST_30D_SECONDS, input.now);
      const history = await loadHistoryForSubWallet(txDb, txn.subWalletId!, input.now);
      const anomaly = anomalyService.score(intent, history);

      await transactionsRepo.setAnomalyScore(txDb, txn.id, anomaly.score);
      await auditRepo.append(txDb, auditEvents.anomalyScored({ transactionId: txn.id, score: anomaly.score, features: anomaly.features }));

      const ruleSet = await fetchActiveRuleSet(txDb, txn.subWalletId!);
      const decision: Decision = ruleSet
        ? evaluate(intent, ruleSet, {
            ledger: { subWalletAvailableKobo: subBalance, spentLast24hKobo: spent24, spentLast30dKobo: spent30d },
            anomalyScore: anomaly.score,
          })
        : { kind: 'allow' };

      await auditRepo.append(txDb, auditEvents.txnRuleEval({
        transactionId: txn.id,
        actorUserId: input.initiatingUserId,
        ruleSetId: ruleSet?.id ?? '00000000-0000-0000-0000-000000000000',
        ruleSetVersion: ruleSet?.version ?? 0,
        decision,
      }));

      if (decision.kind === 'allow') {
        await transactionsRepo.setStatus(txDb, txn.id, 'in_flight');
        const updated = await transactionsRepo.findById(txDb, txn.id);
        if (!updated) throw new Error('transaction disappeared after status update');
        return { kind: 'allow' as const, transaction: updated };
      }

      const bump = await bumpWorkflowService.create(txDb, {
        transactionId: txn.id,
        subWalletId: txn.subWalletId!,
        requestedByUserId: input.initiatingUserId,
        amountKobo: intent.amountKobo,
        vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
        now: input.now,
      });
      await auditRepo.append(txDb, auditEvents.bumpRequested({
        bumpRequestId: bump.bumpRequest.id,
        transactionId: txn.id,
        actorUserId: input.initiatingUserId,
        amountKobo: intent.amountKobo,
        vendorResolvedName: intent.vendorResolvedName ?? 'Unknown vendor',
      }));
      const updated = await transactionsRepo.findById(txDb, txn.id);
      if (!updated) throw new Error('transaction disappeared after status update');
      return { kind: 'bump_pending' as const, transaction: updated, bumpRequestId: bump.bumpRequest.id };
    });

    // Soft anomaly alert — dispatched best-effort outside the transaction so it never blocks.
    if (result.kind === 'allow' || result.kind === 'bump_pending') {
      const subWalletId = txn.subWalletId!;
      const score = result.transaction.anomalyScore as number | null;
      if (score !== null && score >= 0.85) {
        subWalletsRepo.findPrincipalAndAgent(db, subWalletId)
          .then(async (resolved) => {
            if (!resolved) return;
            await notificationService.dispatch(db, {
              kind: 'anomaly_alert',
              recipientUserId: resolved.principalUserId,
              dedupeKey: `anomaly:${txn.id}`,
              anomalyScore: score,
              subWalletId,
              payload: {
                transactionId: txn.id,
                subWalletId,
                amountKobo: txn.amountKobo as bigint,
                vendorResolvedName: txn.vendorResolvedName ?? 'Unknown',
                anomalyScore: score,
              },
            });
          })
          .catch((e: unknown) => logger.error({ err: (e as Error).message }, 'anomaly_alert notification failed'));
      }
    }

    return result;
  },

  async resumeAfterBump(db: DbOrTx, input: { token: string; now: Date }): Promise<EvaluateOutput> {
    const bump = await bumpWorkflowService.consumeToken(db, input.token, input.now);
    if (!bump) throw new Error('invalid or already-consumed token');
    if (bump.status !== 'approved_once' && bump.status !== 'raise_limit') {
      throw new Error(`bump not approved: status=${bump.status}`);
    }
    await transactionsRepo.setStatus(db, bump.transactionId, 'in_flight');
    const updated = await transactionsRepo.findById(db, bump.transactionId);
    if (!updated) throw new Error('transaction disappeared after status update');
    return { kind: 'allow', transaction: updated };
  },
};
```

- [ ] **Step 3: Run existing lifecycle tests**

```
cd apps/backend && pnpm vitest run tests/modules/transactions/lifecycle.service.test.ts
```

Expected: All PASS

- [ ] **Step 4: Commit**

```
git add apps/backend/src/modules/transactions/lifecycle.service.ts
git commit -m "refactor(backend): wrap lifecycleService.evaluate in db.transaction; use repo methods"
```

---

### Task 6: Update `bumpWorkflowService` — use repo, add `cancelByAgent()`, batch `sweepExpired()`

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-workflow.service.ts`

Existing tests at `tests/modules/bumps/bump-workflow.service.test.ts` must continue to pass.

- [ ] **Step 1: Verify existing tests pass**

```
cd apps/backend && pnpm vitest run tests/modules/bumps/bump-workflow.service.test.ts
```

Expected: All PASS (baseline)

- [ ] **Step 2: Replace the file content**

Replace `apps/backend/src/modules/bumps/bump-workflow.service.ts` with:

```ts
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { type Result, err, ok } from '../../lib/result';
import { notificationService } from '../notifications/notification.service';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { transactionsRepo } from '../wallet/transactions.repo';
import { type BumpRequestRow, bumpRequestsRepo } from './bump-requests.repo';
import { type OneShotTokenRow, oneShotTokensRepo } from './one-shot-tokens.repo';
import { type BumpEvent, transition } from './state-machine';

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
  oneShotToken: OneShotTokenRow | null;
};

export const bumpWorkflowService = {
  async create(db: DbOrTx, input: CreateInput): Promise<CreateOutput> {
    const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const expiresAt = new Date(input.now.getTime() + ttl * 60_000);
    const result = await db.transaction(async (tx) => {
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
      await txDb
        .update(transactions)
        .set({ bumpRequestId: bumpRequest.id })
        .where(eq(transactions.id, input.transactionId));
      return { bumpRequest };
    });

    // Dispatch notification best-effort — never blocks bump creation.
    subWalletsRepo.findPrincipalAndAgent(db, input.subWalletId)
      .then(async (resolved) => {
        if (!resolved) return;
        await notificationService.dispatch(db, {
          kind: 'bump_requested',
          recipientUserId: resolved.principalUserId,
          dedupeKey: `bump:${result.bumpRequest.id}`,
          amountKobo: input.amountKobo,
          subWalletId: input.subWalletId,
          payload: {
            bumpRequestId: result.bumpRequest.id,
            transactionId: input.transactionId,
            amountKobo: input.amountKobo,
            vendorResolvedName: input.vendorResolvedName,
            agentDisplayName: resolved.agentDisplayName,
          },
        });
      })
      .catch((e: unknown) => logger.error({ err: (e as Error).message }, 'bump_requested notification failed'));

    return result;
  },

  async decide(db: DbOrTx, input: DecideInput): Promise<Result<DecideOutput, DecideError>> {
    const result = await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const current = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!current) return err({ code: 'BUMP_NOT_FOUND' as const });
      if (current.expiresAt < input.now) return err({ code: 'BUMP_EXPIRED' as const });
      const event: BumpEvent = { kind: input.decision };
      const next = transition(current.status as 'pending', event);
      if (next.kind === 'err') return err({ code: 'INVALID_TRANSITION' as const });
      await bumpRequestsRepo.setDecision(txDb, input.bumpRequestId, next.value, input.decidedByUserId, input.now);
      const updated = await bumpRequestsRepo.findById(txDb, input.bumpRequestId);
      if (!updated) throw new Error('bump disappeared after decision');

      let oneShotToken: OneShotTokenRow | null = null;
      if (next.value === 'approved_once' || next.value === 'raise_limit') {
        const token = randomBytes(24).toString('hex');
        oneShotToken = await oneShotTokensRepo.insert(txDb, {
          token,
          bumpRequestId: input.bumpRequestId,
          expiresAt: new Date(input.now.getTime() + 10 * 60_000),
        });
      }
      return ok({ bumpRequest: updated, oneShotToken });
    });

    if (result.kind === 'ok') {
      notificationService
        .dispatch(db, {
          kind: 'bump_decided',
          recipientUserId: result.value.bumpRequest.requestedByUserId,
          dedupeKey: `bump-decided:${result.value.bumpRequest.id}`,
          amountKobo: result.value.bumpRequest.amountKobo,
          subWalletId: result.value.bumpRequest.subWalletId,
          payload: {
            bumpRequestId: result.value.bumpRequest.id,
            transactionId: result.value.bumpRequest.transactionId,
            amountKobo: result.value.bumpRequest.amountKobo,
            vendorResolvedName: result.value.bumpRequest.vendorResolvedName,
            decision: input.decision,
          },
        })
        .catch((e: unknown) => logger.error({ err: (e as Error).message }, 'bump_decided notification failed'));
    }

    return result;
  },

  async sweepExpired(db: DbOrTx, now: Date): Promise<{ expiredCount: number }> {
    const expired = await bumpRequestsRepo.listExpired(db, now);
    if (expired.length === 0) return { expiredCount: 0 };
    await bumpRequestsRepo.bulkExpire(db, expired.map((r) => r.id), now);
    return { expiredCount: expired.length };
  },

  /**
   * Cancel a bump_pending transaction on behalf of the agent.
   * Caller is responsible for verifying the agent owns the sub-wallet.
   */
  async cancelByAgent(db: DbOrTx, transactionId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      await bumpRequestsRepo.cancelByTransactionId(txDb, transactionId);
      await transactionsRepo.setStatus(txDb, transactionId, 'failed');
      await txDb
        .update(transactions)
        .set({ errorMessage: 'CANCELLED_BY_AGENT' })
        .where(eq(transactions.id, transactionId));
    });
  },

  async consumeToken(db: DbOrTx, token: string, now: Date): Promise<BumpRequestRow | null> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const consumed = await oneShotTokensRepo.tryConsume(txDb, token, now);
      if (!consumed) return null;
      if (consumed.expiresAt < now) return null;
      return (await bumpRequestsRepo.findById(txDb, consumed.bumpRequestId)) ?? null;
    });
  },
};
```

- [ ] **Step 3: Add `cancelByTransactionId` to `bump-requests.repo.ts`**

Append to `bumpRequestsRepo` in `apps/backend/src/modules/bumps/bump-requests.repo.ts`:

```ts
async cancelByTransactionId(db: DbOrTx, transactionId: string): Promise<void> {
  await db
    .update(bumpRequests)
    .set({ status: 'cancelled' as BumpStatus })
    .where(eq(bumpRequests.transactionId, transactionId));
},
```

Also add `'cancelled'` to `BumpStatus` in that file:

```ts
export type BumpStatus = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired' | 'cancelled';
```

- [ ] **Step 4: Run all bump tests**

```
cd apps/backend && pnpm vitest run tests/modules/bumps
```

Expected: All PASS

- [ ] **Step 6: Commit**

```
git add apps/backend/src/modules/bumps/bump-workflow.service.ts apps/backend/src/modules/bumps/bump-requests.repo.ts
git commit -m "refactor(backend): use repo in bumpWorkflowService; add cancelByAgent; batch sweepExpired"
```

---

### Task 7: Clean up `routes/transactions.ts` — remove direct DB, add Zod

**Files:**
- Modify: `apps/backend/src/routes/transactions.ts`

Existing route tests at `tests/routes/transactions.test.ts` must pass unchanged.

- [ ] **Step 1: Verify existing tests pass**

```
cd apps/backend && pnpm vitest run tests/routes/transactions.test.ts
```

Expected: All PASS (baseline)

- [ ] **Step 2: Replace the file**

Replace `apps/backend/src/routes/transactions.ts` with:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { kobo } from '../lib/kobo';
import { parseBody } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { bumpWorkflowService } from '../modules/bumps/bump-workflow.service';
import { transactionDetailService } from '../modules/transactions/detail.service';
import { lifecycleService } from '../modules/transactions/lifecycle.service';
import { nipOutService } from '../modules/transactions/nip-out.service';
import { txnIntentService } from '../modules/transactions/txn-intent.service';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../modules/wallet/transactions.repo';

const IntentBodySchema = z.object({
  masterWalletId: z.string().uuid(),
  subWalletId: z.string().uuid().nullable(),
  amountKobo: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().min(1),
  vendorBankCode: z.string().min(1),
  vendorAccountNumber: z.string().min(1),
  vendorResolvedName: z.string().min(1),
  category: z.string().nullable().default(null),
  agentNote: z.string().nullable().default(null),
});

const ResumeBodySchema = z.object({ token: z.string().min(1) });

const AttachMediaBodySchema = z.object({ mediaKey: z.string().min(1) });

export const transactionsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/intent', async (c) => {
    const body = await parseBody(c, IntentBodySchema);
    if (body instanceof Response) return body;
    const txn = await txnIntentService.create(db, {
      masterWalletId: body.masterWalletId,
      subWalletId: body.subWalletId,
      amountKobo: kobo(BigInt(body.amountKobo)),
      idempotencyKey: body.idempotencyKey,
      vendorBankCode: body.vendorBankCode,
      vendorAccountNumber: body.vendorAccountNumber,
      vendorResolvedName: body.vendorResolvedName,
      category: body.category,
      agentNote: body.agentNote,
    });
    return c.json({ transactionId: txn.id, status: txn.status }, 201);
  })
  .post('/:id/evaluate', async (c) => {
    const id = c.req.param('id');
    const a = c.get('actor') as Actor;
    const result = await lifecycleService.evaluate(db, { transactionId: id, initiatingUserId: a.userId, now: new Date() });
    if (result.kind === 'allow') {
      return c.json({ kind: 'allow', status: result.transaction.status }, 200);
    }
    return c.json({ kind: 'bump_pending', bumpRequestId: result.bumpRequestId, status: result.transaction.status }, 202);
  })
  .post('/:id/send', async (c) => {
    const id = c.req.param('id');
    const txn = await transactionsRepo.findById(db, id);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    const mw = await masterWalletsRepo.findById(db, txn.masterWalletId);
    if (!mw) return c.json({ error: 'master_wallet_not_found' }, 404);
    const hh = await householdsRepo.findById(db, mw.householdId);
    const householdRef = hh ? hh.id : txn.masterWalletId;
    const result = await nipOutService.send(db, anchorAdapterSingleton, { transactionId: id, householdRef, now: new Date() });
    return c.json(result, 202);
  })
  .post('/:id/resume-after-bump', async (c) => {
    const body = await parseBody(c, ResumeBodySchema);
    if (body instanceof Response) return body;
    const result = await lifecycleService.resumeAfterBump(db, { token: body.token, now: new Date() });
    return c.json({ status: result.transaction.status }, 200);
  })
  .get('/:id', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    if (a.role === 'principal') {
      const detail = await transactionDetailService.getByIdForPrincipal(db, id, a.userId);
      if (!detail) return c.json({ error: 'not_found' }, 404);
      return c.json({ transaction: detail }, 200);
    }
    if (a.role === 'agent') {
      const detail = await transactionDetailService.getByIdForAgent(db, id, a.userId);
      if (!detail) return c.json({ error: 'not_found' }, 404);
      return c.json({ transaction: detail }, 200);
    }
    return c.json({ error: 'forbidden' }, 403);
  })
  .patch('/:id/media', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    const body = await parseBody(c, AttachMediaBodySchema);
    if (body instanceof Response) return body;
    const txn = await transactionsRepo.findById(db, id);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'settled') return c.json({ error: 'not_settled' }, 409);
    await transactionsRepo.attachMedia(db, id, body.mediaKey);
    return c.json({ ok: true }, 200);
  })
  .delete('/:id/bump', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    const txn = await transactionsRepo.findById(db, id);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'bump_pending') return c.json({ error: 'not_bump_pending' }, 409);
    await bumpWorkflowService.cancelByAgent(db, id);
    return c.json({ ok: true }, 200);
  });
```

- [ ] **Step 3: Run route tests**

```
cd apps/backend && pnpm vitest run tests/routes/transactions.test.ts
```

Expected: All PASS

- [ ] **Step 4: Commit**

```
git add apps/backend/src/routes/transactions.ts
git commit -m "refactor(backend): clean transactions route — Zod validation, remove direct DB calls"
```

---

### Task 8: Add Zod validation to remaining routes

**Files:**
- Modify: `apps/backend/src/routes/auth.ts`
- Modify: `apps/backend/src/routes/sub-wallets.ts`
- Modify: `apps/backend/src/routes/households.ts`
- Modify: `apps/backend/src/routes/webhooks.ts`
- Modify: `apps/backend/src/routes/pairing.ts`
- Modify: `apps/backend/src/routes/devices.ts`
- Modify: `apps/backend/src/routes/notification-prefs.ts`

- [ ] **Step 1: Verify all route tests pass first**

```
cd apps/backend && pnpm vitest run tests/routes
```

Expected: All PASS (baseline)

- [ ] **Step 2: Update `routes/auth.ts`**

Add imports and replace the manual validation in `apps/backend/src/routes/auth.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { otpService } from '../modules/auth/otp.service';
import { pairingService } from '../modules/auth/pairing.service';
import { sessionService } from '../modules/auth/session.service';
import { usersRepo } from '../modules/identity/users.repo';

const PHONE_RE = /^\+\d{8,15}$/;

const OtpRequestSchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  purpose: z.enum(['login', 'pair']),
});

const OtpVerifySchema = z.object({
  phone: z.string().regex(PHONE_RE, 'invalid_phone'),
  code: z.string().min(1),
  pairingCode: z.string().optional(),
  nin: z.string().optional(),
  bvn: z.string().optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
  userId: z.string().uuid(),
  role: z.enum(['principal', 'agent']),
});

export const authRoute = new Hono()
  .post('/otp/request', async (c) => {
    const body = await parseBody(c, OtpRequestSchema);
    if (body instanceof Response) return body;
    const r = await otpService.requestCode(db, { phone: body.phone, purpose: body.purpose });
    return c.json({ challengeId: r.challengeId, expiresAt: r.expiresAt.toISOString() }, 200);
  })
  .post('/otp/verify', async (c) => {
    const body = await parseBody(c, OtpVerifySchema);
    if (body instanceof Response) return body;
    const v = await otpService.verifyCode(db, { phone: body.phone, code: body.code });
    if (v.kind !== 'verified') return c.json({ error: v.kind }, 401);

    let user = await usersRepo.findByPhone(db, body.phone);

    if (!user && body.pairingCode) {
      if (!body.nin) return c.json({ error: 'nin_required_for_signup' }, 400);
      user = await usersRepo.insert(db, { role: 'agent', phone: body.phone, nin: body.nin, kycTier: '1' });
      const consumed = await pairingService.consume(db, { code: body.pairingCode, agentUserId: user.id });
      if (consumed.kind !== 'consumed') return c.json({ error: 'pairing_failed', reason: consumed.kind }, 400);
    }

    if (!user) {
      if (!body.nin || !body.bvn) return c.json({ error: 'nin_and_bvn_required_for_principal_signup' }, 400);
      user = await usersRepo.insert(db, { role: 'principal', phone: body.phone, nin: body.nin, bvn: body.bvn, kycTier: '1' });
    }

    const tokens = await sessionService.issue(db, { userId: user.id, role: user.role });
    return c.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt.toISOString(),
      refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
      user: { id: user.id, role: user.role, phone: user.phone, kycTier: user.kycTier },
    }, 200);
  })
  .post('/refresh', async (c) => {
    const body = await parseBody(c, RefreshSchema);
    if (body instanceof Response) return body;
    const r = await sessionService.refresh(db, body.refreshToken, body.role, body.userId);
    if (r.kind !== 'rotated') return c.json({ error: r.kind }, 401);
    return c.json({
      accessToken: r.tokens.accessToken,
      refreshToken: r.tokens.refreshToken,
      accessExpiresAt: r.tokens.accessExpiresAt.toISOString(),
      refreshExpiresAt: r.tokens.refreshExpiresAt.toISOString(),
    }, 200);
  });

export const meRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me', async (c) => {
    const a = c.get('actor');
    const u = await usersRepo.findById(db, a.userId);
    if (!u) return c.json({ error: 'user_not_found' }, 404);
    return c.json({ id: u.id, role: u.role, phone: u.phone, kycTier: u.kycTier, status: u.status }, 200);
  });

export const logoutRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/auth/logout', async (c) => {
    const a = c.get('actor');
    await sessionService.revoke(db, a.sessionId);
    return c.json({ revoked: true }, 200);
  });
```

- [ ] **Step 3: Update `routes/sub-wallets.ts`**

Add Zod schema for the status patch. At the top of `apps/backend/src/routes/sub-wallets.ts`, add:

```ts
import { z } from 'zod';
import { parseBody } from '../lib/validate';
```

Replace the `.patch('/:id', ...)` handler body:

```ts
.patch('/:id', async (c) => {
  const PatchSchema = z.object({ status: z.enum(['active', 'suspended', 'closed']) });
  const a = c.get('actor');
  if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
  const check = await ownerCheck(db, c.req.param('id'), a.userId);
  if (!check.ok) return c.json({ error: check.code }, check.status);
  const body = await parseBody(c, PatchSchema);
  if (body instanceof Response) return body;
  await subWalletsRepo.setStatus(db, c.req.param('id'), body.status);
  const sw = await subWalletsRepo.findById(db, c.req.param('id'));
  return c.json({ subWallet: sw }, 200);
})
```

- [ ] **Step 4: Update `routes/pairing.ts`**

Add imports at the top of `apps/backend/src/routes/pairing.ts`:

```ts
import { z } from 'zod';
import { parseBody } from '../lib/validate';
```

Replace the two `c.req.json()` calls:

```ts
// In POST /  (issue pairing token):
const IssueSchema = z.object({ householdId: z.string().uuid() });
// Replace:  const body = await c.req.json<{ householdId: string }>();
// With:
const body = await parseBody(c, IssueSchema);
if (body instanceof Response) return body;

// In POST /complete:
const CompleteSchema = z.object({ token: z.string().min(1) });
// Replace:  const body = await c.req.json<{ token?: string }>();
//           if (!body.token) return c.json({ error: 'missing_token' }, 400);
// With:
const body = await parseBody(c, CompleteSchema);
if (body instanceof Response) return body;
// (remove the manual missing_token check — Zod now enforces it)
```

- [ ] **Step 5: Update `routes/devices.ts`**

Add imports at the top of `apps/backend/src/routes/devices.ts`:

```ts
import { z } from 'zod';
import { parseBody } from '../lib/validate';
```

Replace the `c.req.json()` call and manual guard in `POST /`:

```ts
const RegisterSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  deviceLabel: z.string().nullable().optional(),
});

// Replace:  const body = await c.req.json<{...}>();
//           if (!body.expoPushToken || !body.platform) { return c.json(...) }
// With:
const body = await parseBody(c, RegisterSchema);
if (body instanceof Response) return body;
// Remove the manual if (!body.expoPushToken || !body.platform) guard
```

- [ ] **Step 6: Run all route tests to confirm nothing broke**

```
cd apps/backend && pnpm vitest run tests/routes
```

Expected: All PASS

- [ ] **Step 7: Commit**

```
git add apps/backend/src/routes/auth.ts apps/backend/src/routes/sub-wallets.ts apps/backend/src/routes/pairing.ts apps/backend/src/routes/devices.ts apps/backend/src/routes/notification-prefs.ts apps/backend/src/routes/households.ts apps/backend/src/routes/webhooks.ts
git commit -m "refactor(backend): add Zod request validation to all routes"
```

---

### Task 9: Fix `jwt-auth.ts` logging + refactor `server.ts` meRouter

**Files:**
- Modify: `apps/backend/src/middleware/jwt-auth.ts`
- Modify: `apps/backend/src/server.ts`

- [ ] **Step 1: Fix touchLastUsed error logging in `jwt-auth.ts`**

Replace line 28 in `apps/backend/src/middleware/jwt-auth.ts`:

```ts
// Before:
authSessionsRepo.touchLastUsed(db, session.id, new Date()).catch(() => {});

// After:
authSessionsRepo.touchLastUsed(db, session.id, new Date())
  .catch((e: unknown) => logger.warn({ err: (e as Error).message }, 'session touch failed'));
```

Add the logger import at the top:

```ts
import { logger } from '../lib/logger';
```

- [ ] **Step 2: Refactor `server.ts` to group `me` routes**

Replace `apps/backend/src/server.ts` with:

```ts
import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { authRoute, logoutRoute, meRoute } from './routes/auth';
import { bumpsRoute } from './routes/bumps';
import { devicesRoute } from './routes/devices';
import { healthRoute } from './routes/health';
import { householdsRoute, meHouseholdRoute } from './routes/households';
import { meBumpsRoute } from './routes/me-bumps';
import { meSubWalletRoute } from './routes/me-sub-wallet';
import { mediaRoute } from './routes/media';
import { notificationPrefsRoute } from './routes/notification-prefs';
import { notificationsListRoute } from './routes/notifications';
import { pairingRoute } from './routes/pairing';
import { subWalletsRoute } from './routes/sub-wallets';
import { transactionsRoute } from './routes/transactions';
import { vendorsRoute } from './routes/vendors';
import { webhooksRoute } from './routes/webhooks';

function buildMeRouter(): Hono {
  return new Hono()
    .route('/', meRoute)
    .route('/', logoutRoute)
    .route('/', meHouseholdRoute)
    .route('/', meBumpsRoute)
    .route('/', meSubWalletRoute)
    .route('/', notificationPrefsRoute)
    .route('/', notificationsListRoute);
}

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  app.route('/webhooks', webhooksRoute);
  app.route('/vendors', vendorsRoute);
  app.route('/transactions', transactionsRoute);
  app.route('/bumps', bumpsRoute);
  app.route('/devices', devicesRoute);
  app.route('/auth', authRoute);
  app.route('/pairing', pairingRoute);
  app.route('/households', householdsRoute);
  app.route('/sub-wallets', subWalletsRoute);
  app.route('/media', mediaRoute);
  app.route('/', buildMeRouter());
  app.onError(errorHandler);
  return app;
}
```

- [ ] **Step 3: Run full backend test suite**

```
cd apps/backend && pnpm vitest run
```

Expected: All PASS

- [ ] **Step 4: Commit**

```
git add apps/backend/src/middleware/jwt-auth.ts apps/backend/src/server.ts
git commit -m "refactor(backend): log session touch errors; group me-routes into buildMeRouter"
```

---

## Layer 2 — Principal App

### Task 10: Create `lib/store-utils.ts` and `lib/logout.ts`

**Files:**
- Create: `apps/principal/src/lib/store-utils.ts`
- Create: `apps/principal/src/lib/logout.ts`
- Create: `apps/principal/src/lib/store-utils.test.ts`
- Create: `apps/principal/src/lib/logout.test.ts`

- [ ] **Step 1: Write failing test for `toErrorCode`**

```ts
// apps/principal/src/lib/store-utils.test.ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '@amana/api-client';
import { toErrorCode } from './store-utils';

describe('toErrorCode', () => {
  it('extracts code from ApiError', () => {
    const err = new ApiError('wrong_code', 401, 'wrong_code', null);
    expect(toErrorCode(err)).toBe('wrong_code');
  });

  it('extracts message from generic Error', () => {
    expect(toErrorCode(new Error('network down'))).toBe('network down');
  });

  it('returns unknown_error for non-Error values', () => {
    expect(toErrorCode('oops')).toBe('unknown_error');
    expect(toErrorCode(null)).toBe('unknown_error');
    expect(toErrorCode(42)).toBe('unknown_error');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
cd apps/principal && pnpm vitest run src/lib/store-utils.test.ts
```

Expected: FAIL — cannot find module `./store-utils`

- [ ] **Step 3: Create `store-utils.ts`**

```ts
// apps/principal/src/lib/store-utils.ts
import { ApiError } from '@amana/api-client';

export const toErrorCode = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';
```

- [ ] **Step 4: Run to confirm pass**

```
cd apps/principal && pnpm vitest run src/lib/store-utils.test.ts
```

Expected: PASS

- [ ] **Step 5: Write failing test for `runLogout`**

```ts
// apps/principal/src/lib/logout.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runLogout } from './logout';

describe('runLogout', () => {
  function makeTokenStore(hasAuth: boolean) {
    return {
      read: vi.fn().mockResolvedValue(
        hasAuth
          ? { tokens: { accessToken: 'A1', refreshToken: 'R1', accessExpiresAt: '', refreshExpiresAt: '' }, user: { id: 'u1', role: 'principal', phone: '', kycTier: '1' } }
          : null
      ),
      write: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makeApi(logoutShouldFail = false) {
    return {
      auth: {
        logout: logoutShouldFail
          ? vi.fn().mockRejectedValue(new Error('network'))
          : vi.fn().mockResolvedValue(undefined),
      },
    } as never;
  }

  it('calls unregisterPush, revokes token, clears storage', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const store = makeTokenStore(true);
    const api = makeApi();

    await runLogout(api, store as never, unregister);

    expect(unregister).toHaveBeenCalledOnce();
    expect(api.auth.logout).toHaveBeenCalledWith('A1');
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it('clears storage even if revoke fails', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const store = makeTokenStore(true);
    const api = makeApi(true);

    await runLogout(api, store as never, unregister);

    expect(store.clear).toHaveBeenCalledOnce();
  });

  it('skips revoke if no stored auth', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const store = makeTokenStore(false);
    const api = makeApi();

    await runLogout(api, store as never, unregister);

    expect(api.auth.logout).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6: Run to confirm failure**

```
cd apps/principal && pnpm vitest run src/lib/logout.test.ts
```

Expected: FAIL — cannot find module `./logout`

- [ ] **Step 7: Create `logout.ts`**

```ts
// apps/principal/src/lib/logout.ts
import type { AmanaApiClient } from '@amana/api-client';
import type { TokenStore } from '@amana/api-client';

export async function runLogout(
  api: AmanaApiClient,
  tokenStore: TokenStore,
  unregisterPush: () => Promise<void>,
): Promise<void> {
  await unregisterPush().catch(() => {});
  const stored = await tokenStore.read();
  if (stored) await api.auth.logout(stored.tokens.accessToken).catch(() => {});
  await tokenStore.clear();
}
```

- [ ] **Step 8: Run to confirm pass**

```
cd apps/principal && pnpm vitest run src/lib/store-utils.test.ts src/lib/logout.test.ts
```

Expected: All PASS

- [ ] **Step 9: Commit**

```
git add apps/principal/src/lib/store-utils.ts apps/principal/src/lib/store-utils.test.ts apps/principal/src/lib/logout.ts apps/principal/src/lib/logout.test.ts
git commit -m "feat(principal): add toErrorCode helper and runLogout coordinator"
```

---

### Task 11: Replace `ERR` with `toErrorCode` in all 7 stores

**Files:**
- Modify: `apps/principal/src/state/auth.store.ts`
- Modify: `apps/principal/src/state/bumps.store.ts`
- Modify: `apps/principal/src/state/household.store.ts`
- Modify: `apps/principal/src/state/notifications.store.ts`
- Modify: `apps/principal/src/state/preferences.store.ts`
- Modify: `apps/principal/src/state/push.store.ts`
- Modify: `apps/principal/src/state/subwallets.store.ts`

Each store has this identical block to remove:

```ts
// REMOVE this from every store:
const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';
```

And this import to remove:

```ts
import { ApiError } from '@amana/api-client';  // remove if only used by ERR
```

And this import to add:

```ts
import { toErrorCode } from '../lib/store-utils';
```

And replace every `ERR(e)` call with `toErrorCode(e)`.

- [ ] **Step 1: Apply to `bumps.store.ts`**

In `apps/principal/src/state/bumps.store.ts`:
1. Remove the `import { ApiError }` line
2. Remove the `const ERR = ...` block
3. Add `import { toErrorCode } from '../lib/store-utils';`
4. Replace `ERR(e)` with `toErrorCode(e)` (2 occurrences)

- [ ] **Step 2: Apply to `household.store.ts`**

In `apps/principal/src/state/household.store.ts`:
1. Keep the `import { ApiError }` — it is still used in the `bootstrap` error check:
   `if (e instanceof ApiError && e.code === 'no_household')`
2. Remove the `const ERR = ...` block
3. Add `import { toErrorCode } from '../lib/store-utils';`
4. Replace `ERR(e)` with `toErrorCode(e)` (3 occurrences)

- [ ] **Step 3: Apply to `notifications.store.ts`**

Remove `import { ApiError }`, remove `const ERR`, add `toErrorCode` import, replace `ERR(e)` (3 occurrences).

- [ ] **Step 4: Apply to `preferences.store.ts`**

Remove `import { ApiError }`, remove `const ERR`, add `toErrorCode` import, replace `ERR(e)` (2 occurrences).

- [ ] **Step 5: Apply to `push.store.ts`**

Remove `import { ApiError }`, remove `const ERR`, add `toErrorCode` import, replace `ERR(e)` (2 occurrences).

- [ ] **Step 6: Apply to `subwallets.store.ts`**

Remove `import { ApiError }`, remove `const ERR`, add `toErrorCode` import, replace `ERR(e)` (5 occurrences).

- [ ] **Step 7: Run typecheck**

```
cd apps/principal && pnpm typecheck
```

Expected: no errors

- [ ] **Step 8: Commit**

```
git add apps/principal/src/state/
git commit -m "refactor(principal): replace duplicate ERR helper with shared toErrorCode"
```

---

### Task 12: Update `auth.store.ts` — `api.me.get()` and `runLogout`

**Files:**
- Modify: `apps/principal/src/state/auth.store.ts`

- [ ] **Step 1: Replace `api.request<User>('/me')` with `api.me.get()`**

In `apps/principal/src/state/auth.store.ts`, inside `bootstrap()`:

```ts
// Before:
const me = await api.request<User>('/me');

// After:
const me = await api.me.get();
```

Remove the `import type { ... User }` from `@amana/types` if `User` is no longer directly referenced (the `api.me.get()` return type is inferred). Keep `LoginResponse` if still used in `verifyOtp`.

- [ ] **Step 2: Replace inline logout logic with `runLogout`**

Remove `import { usePushStore } from './push.store';` from `auth.store.ts`.

Add `import { runLogout } from '../lib/logout';`

Replace the `logout()` action body:

```ts
async logout() {
  set({ busy: true });
  try {
    await runLogout(api, secureTokenStore, () => usePushStore.getState().unregister());
    set({ status: 'logged_out', user: null, pendingPhone: null, busy: false, errorCode: null });
  } catch (e) {
    set({ busy: false, errorCode: toErrorCode(e) });
    throw e;
  }
},
```

Wait — `usePushStore` must still be imported to pass the callback. The import stays, but it is now in a callback argument rather than being called directly inside the store action. The coupling moves from "store A calls store B's internals" to "store A passes store B's method as a callback to a coordinator."

Retain the import:

```ts
import { usePushStore } from './push.store';
```

Final `logout()` in `auth.store.ts`:

```ts
async logout() {
  set({ busy: true });
  try {
    await runLogout(api, secureTokenStore, () => usePushStore.getState().unregister());
    set({ status: 'logged_out', user: null, pendingPhone: null, busy: false, errorCode: null });
  } catch (e) {
    set({ busy: false, errorCode: toErrorCode(e) });
    throw e;
  }
},
```

- [ ] **Step 3: Typecheck**

```
cd apps/principal && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add apps/principal/src/state/auth.store.ts
git commit -m "refactor(principal): use api.me.get() in bootstrap; extract logout side-effects to runLogout"
```

---

### Task 13: Normalize `subwallets.store.ts` to `byId`-only

**Files:**
- Modify: `apps/principal/src/state/subwallets.store.ts`
- Modify any screen that reads `store.list` (check with grep)

- [ ] **Step 1: Find all callers of the `list` field**

```
grep -rn "useSubWalletsStore\|subwalletsStore" apps/principal/src --include="*.tsx" --include="*.ts"
```

Note every location that reads `.list` or passes `list` as a prop.

- [ ] **Step 2: Replace `subwallets.store.ts`**

Replace `apps/principal/src/state/subwallets.store.ts` with:

```ts
import type { ActiveRuleSet, RuleInput, SubWallet, SubWalletStatus } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';
import { toErrorCode } from '../lib/store-utils';

export type SubWalletsState = {
  byId: Record<string, SubWallet>;
  balanceById: Record<string, string>;
  rulesById: Record<string, ActiveRuleSet | null>;
  errorCode: string | null;
  busy: boolean;
  _snoozeSeq: Record<string, number>;

  refreshList(householdId: string): Promise<void>;
  create(householdId: string, agentUserId: string, name: string): Promise<SubWallet>;
  refreshOne(subWalletId: string): Promise<void>;
  refreshBalance(subWalletId: string): Promise<void>;
  refreshRules(subWalletId: string): Promise<void>;
  publishRules(subWalletId: string, rules: RuleInput[]): Promise<void>;
  setStatus(subWalletId: string, status: SubWalletStatus): Promise<void>;
  snooze(subWalletId: string, until: string | null): Promise<void>;
  unsnooze(subWalletId: string): Promise<void>;
};

export const useSubWalletsStore = create<SubWalletsState>((set, get) => ({
  byId: {},
  balanceById: {},
  rulesById: {},
  errorCode: null,
  busy: false,
  _snoozeSeq: {},

  async refreshList(householdId) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.listSubWallets(householdId);
      const byId: Record<string, SubWallet> = {};
      for (const s of r.subWallets) byId[s.id] = s;
      set({ byId, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
    }
  },

  async create(householdId, agentUserId, name) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.createSubWallet(householdId, { agentUserId, name });
      set({ byId: { ...get().byId, [r.subWallet.id]: r.subWallet }, busy: false });
      return r.subWallet;
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async refreshOne(subWalletId) {
    try {
      const r = await api.subWallet.get(subWalletId);
      set({ byId: { ...get().byId, [subWalletId]: r.subWallet } });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async refreshBalance(subWalletId) {
    try {
      const r = await api.subWallet.getBalance(subWalletId);
      set({ balanceById: { ...get().balanceById, [subWalletId]: r.balanceKobo } });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async refreshRules(subWalletId) {
    try {
      const r = await api.subWallet.getRules(subWalletId);
      set({ rulesById: { ...get().rulesById, [subWalletId]: r.activeRuleSet } });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async publishRules(subWalletId, rules) {
    set({ busy: true, errorCode: null });
    try {
      await api.subWallet.publishRules(subWalletId, { rules });
      await get().refreshRules(subWalletId);
      set({ busy: false });
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async setStatus(subWalletId, status) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.subWallet.patchStatus(subWalletId, { status });
      set({ byId: { ...get().byId, [subWalletId]: r.subWallet }, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async snooze(subWalletId, until) {
    const seq = (get()._snoozeSeq[subWalletId] ?? 0) + 1;
    const before = get().byId[subWalletId];
    if (!before) return;
    const optimistic = { ...before, snoozedUntil: until };
    set({ byId: { ...get().byId, [subWalletId]: optimistic }, _snoozeSeq: { ...get()._snoozeSeq, [subWalletId]: seq } });
    try {
      const r = await api.subWallet.snooze(subWalletId, until);
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      const cur = get().byId[subWalletId];
      if (!cur) return;
      set({ byId: { ...get().byId, [subWalletId]: { ...cur, snoozedUntil: r.snoozedUntil } } });
    } catch (e) {
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      set({ byId: { ...get().byId, [subWalletId]: before }, errorCode: toErrorCode(e) });
    }
  },

  async unsnooze(subWalletId) {
    const seq = (get()._snoozeSeq[subWalletId] ?? 0) + 1;
    const before = get().byId[subWalletId];
    if (!before) return;
    const optimistic = { ...before, snoozedUntil: null };
    set({ byId: { ...get().byId, [subWalletId]: optimistic }, _snoozeSeq: { ...get()._snoozeSeq, [subWalletId]: seq } });
    try {
      await api.subWallet.unsnooze(subWalletId);
    } catch (e) {
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      set({ byId: { ...get().byId, [subWalletId]: before }, errorCode: toErrorCode(e) });
    }
  },
}));
```

- [ ] **Step 3: Update all callers that read `.list`**

For every screen that previously accessed `useSubWalletsStore((s) => s.list)`, replace with:

```ts
const list = useSubWalletsStore((s) => Object.values(s.byId));
```

Run the grep from Step 1 to find all files, then update each one.

- [ ] **Step 4: Typecheck**

```
cd apps/principal && pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```
git add apps/principal/src/state/subwallets.store.ts apps/principal/src/screens/
git commit -m "refactor(principal): normalize subwallet store to byId-only; derive list at call sites"
```

---

### Task 14: Simplify `HomeDashboardScreen.tsx` — merge 3 useEffects

**Files:**
- Modify: `apps/principal/src/screens/HomeDashboardScreen.tsx`

- [ ] **Step 1: Replace the three `useEffect` blocks**

In `apps/principal/src/screens/HomeDashboardScreen.tsx`, replace:

```ts
useEffect(() => {
  if (status === 'idle') void bootstrap();
}, [status, bootstrap]);

useEffect(() => {
  if (status === 'has_household') {
    void refreshBumps();
    void refreshNotifications();
  }
}, [status, refreshBumps, refreshNotifications]);

useEffect(() => {
  if (status === 'no_household') navigation.replace('HouseholdSetup');
}, [status, navigation]);
```

With:

```ts
useEffect(() => {
  if (status === 'idle') { void bootstrap(); return; }
  if (status === 'no_household') { navigation.replace('HouseholdSetup'); return; }
  if (status === 'has_household') {
    void refreshBumps();
    void refreshNotifications();
  }
}, [status, bootstrap, navigation, refreshBumps, refreshNotifications]);
```

- [ ] **Step 2: Typecheck**

```
cd apps/principal && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```
git add apps/principal/src/screens/HomeDashboardScreen.tsx
git commit -m "refactor(principal): merge HomeDashboardScreen waterfall into single useEffect"
```

---

## Layer 3 — Agent App

### Task 15: Create `state/agent.store.ts` and add Zustand dependency

**Files:**
- Modify: `apps/agent/package.json`
- Create: `apps/agent/src/state/agent.store.ts`
- Create: `apps/agent/src/state/agent.store.test.ts`

- [ ] **Step 1: Add zustand to agent's package.json**

In `apps/agent/package.json`, add to `dependencies` (after `"zod": "3.23.8"`):

```json
"zustand": "^5.0.0"
```

- [ ] **Step 2: Install**

```
pnpm install
```

- [ ] **Step 3: Write failing test**

```ts
// apps/agent/src/state/agent.store.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useAgentStore } from './agent.store';

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().clearSubWallet();
  });

  it('starts with null selectedSubWallet', () => {
    expect(useAgentStore.getState().selectedSubWallet).toBeNull();
  });

  it('setSubWallet stores the sub-wallet', () => {
    const sw = { id: 'sw-1', name: 'Test', masterWalletId: 'mw-1' };
    useAgentStore.getState().setSubWallet(sw);
    expect(useAgentStore.getState().selectedSubWallet).toEqual(sw);
  });

  it('clearSubWallet resets to null', () => {
    useAgentStore.getState().setSubWallet({ id: 'sw-1', name: 'Test', masterWalletId: 'mw-1' });
    useAgentStore.getState().clearSubWallet();
    expect(useAgentStore.getState().selectedSubWallet).toBeNull();
  });
});
```

- [ ] **Step 4: Run to confirm failure**

```
cd apps/agent && pnpm vitest run src/state/agent.store.test.ts
```

Expected: FAIL — cannot find module `./agent.store`

- [ ] **Step 5: Create `src/state/agent.store.ts`**

```ts
// apps/agent/src/state/agent.store.ts
import { create } from 'zustand';

export type SubWalletIdentity = {
  id: string;
  name: string;
  masterWalletId: string;
};

type AgentState = {
  selectedSubWallet: SubWalletIdentity | null;
  setSubWallet(sw: SubWalletIdentity): void;
  clearSubWallet(): void;
};

export const useAgentStore = create<AgentState>((set) => ({
  selectedSubWallet: null,
  setSubWallet: (sw) => set({ selectedSubWallet: sw }),
  clearSubWallet: () => set({ selectedSubWallet: null }),
}));
```

- [ ] **Step 6: Run to confirm pass**

```
cd apps/agent && pnpm vitest run src/state/agent.store.test.ts
```

Expected: All PASS

- [ ] **Step 7: Commit**

```
git add apps/agent/package.json apps/agent/src/state/agent.store.ts apps/agent/src/state/agent.store.test.ts pnpm-lock.yaml
git commit -m "feat(agent): add Zustand agent.store to replace sub-wallet-memory singleton"
```

---

### Task 16: Migrate all callers from `subWalletMemory` to `useAgentStore`; delete the singleton

**Files to update** (all 11 callers found by grep):
- `apps/agent/src/nav/RootNavigator.tsx`
- `apps/agent/src/screens/HomeScreen.tsx`
- `apps/agent/src/screens/TransactionListScreen.tsx`
- `apps/agent/src/screens/NQRScanScreen.tsx`
- `apps/agent/src/screens/QRScanScreen.tsx`
- `apps/agent/src/screens/NFCPairScreen.tsx`
- `apps/agent/src/screens/PairingMethodScreen.tsx`
- `apps/agent/src/screens/PhoneLookupScreen.tsx`
- `apps/agent/src/screens/CaptureMethodScreen.tsx`
- `apps/agent/src/screens/AccountEntryScreen.tsx`
- `apps/agent/src/screens/ConfirmScreen.tsx`
- `apps/agent/src/screens/SettingsScreen.tsx`

**Delete:** `apps/agent/src/lib/sub-wallet-memory.ts`

Migration rules per usage pattern:

| Old | New |
|-----|-----|
| `import { subWalletMemory } from '../lib/sub-wallet-memory'` | `import { useAgentStore } from '../state/agent.store'` |
| `const sw = subWalletMemory.get()` (in component body) | `const sw = useAgentStore((s) => s.selectedSubWallet)` |
| `subWalletMemory.get()` (inside callback/effect) | `useAgentStore.getState().selectedSubWallet` |
| `subWalletMemory.set(value)` | `useAgentStore.getState().setSubWallet(value)` |
| `subWalletMemory.clear()` | `useAgentStore.getState().clearSubWallet()` |

- [ ] **Step 1: Update `RootNavigator.tsx`**

```ts
// Remove:
import { subWalletMemory } from '../lib/sub-wallet-memory';
// Add:
import { useAgentStore } from '../state/agent.store';

// Replace in checkPairing():
subWalletMemory.set(me.subWallet);
// With:
useAgentStore.getState().setSubWallet(me.subWallet);
```

- [ ] **Step 2: Update `HomeScreen.tsx`**

```ts
// Remove:
import { subWalletMemory } from '../lib/sub-wallet-memory';
// Add:
import { useAgentStore } from '../state/agent.store';

// Replace (in component body — reactive selector):
const sw = subWalletMemory.get();
// With:
const sw = useAgentStore((s) => s.selectedSubWallet);
```

The `useFocusEffect` dependency `[sw]` remains unchanged — now `sw` is reactive.

- [ ] **Step 3: Update `TransactionListScreen.tsx`**

```ts
// Remove:
import { subWalletMemory } from '../lib/sub-wallet-memory';
// Add:
import { useAgentStore } from '../state/agent.store';

// Replace (in component body):
const sw = subWalletMemory.get();
// With:
const sw = useAgentStore((s) => s.selectedSubWallet);
```

- [ ] **Step 4: Update `NQRScanScreen.tsx`, `QRScanScreen.tsx`**

In `QRScanScreen.tsx`, `subWalletMemory.set(me.subWallet)` is inside a callback:

```ts
useAgentStore.getState().setSubWallet(me.subWallet);
```

In `NQRScanScreen.tsx`, `subWalletMemory.get()` is inside a callback:

```ts
useAgentStore.getState().selectedSubWallet
```

- [ ] **Step 5: Update `NFCPairScreen.tsx`, `PairingMethodScreen.tsx`**

Both call `subWalletMemory.set(...)` inside async callbacks — use `useAgentStore.getState().setSubWallet(...)`.

- [ ] **Step 6: Update `PhoneLookupScreen.tsx`, `CaptureMethodScreen.tsx`**

Both read `subWalletMemory.get()` inside callbacks — use `useAgentStore.getState().selectedSubWallet`.

- [ ] **Step 7: Update `AccountEntryScreen.tsx`, `ConfirmScreen.tsx`**

Both read inside callbacks — use `useAgentStore.getState().selectedSubWallet`.

- [ ] **Step 8: Update `SettingsScreen.tsx`**

```ts
// Remove:
import { subWalletMemory } from '../lib/sub-wallet-memory';
// Add:
import { useAgentStore } from '../state/agent.store';

// Replace:
const sw = subWalletMemory.get();
// With:
const sw = useAgentStore((s) => s.selectedSubWallet);

// Replace:
subWalletMemory.clear();
// With:
useAgentStore.getState().clearSubWallet();
```

- [ ] **Step 9: Delete the singleton file**

```
rm apps/agent/src/lib/sub-wallet-memory.ts
```

- [ ] **Step 10: Typecheck**

```
cd apps/agent && pnpm typecheck
```

Expected: no errors

- [ ] **Step 11: Confirm no remaining references to sub-wallet-memory**

```
grep -r "sub-wallet-memory\|subWalletMemory" apps/agent/src
```

Expected: no output

- [ ] **Step 12: Commit**

```
git add apps/agent/src/ apps/agent/package.json
git commit -m "refactor(agent): replace sub-wallet-memory singleton with Zustand useAgentStore"
```

---

## Layer 4 — API Client

### Task 17: Add optional Zod `schema` param to `request<T>()`

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/tests/client.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/api-client/tests/client.test.ts` inside the `describe('AmanaApiClient.request', ...)` block:

```ts
it('validates response with provided Zod schema', async () => {
  await seedAuth(tokenStore, 'A1');
  const schema = z.object({ name: z.string() });
  fetchImpl.mockResolvedValueOnce(ok({ name: 'Alex' }));
  const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
  const result = await client.request('/profile', {}, schema);
  expect(result.name).toBe('Alex');
});

it('throws ZodError when response does not match schema', async () => {
  await seedAuth(tokenStore, 'A1');
  const schema = z.object({ name: z.string() });
  fetchImpl.mockResolvedValueOnce(ok({ wrong: true }));
  const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore });
  await expect(client.request('/profile', {}, schema)).rejects.toThrow();
});
```

Also add the import at the top of the test file:

```ts
import { z } from 'zod';
```

- [ ] **Step 2: Run to confirm failure**

```
cd packages/api-client && pnpm vitest run tests/client.test.ts
```

Expected: FAIL — `request` does not accept a third argument

- [ ] **Step 3: Update `client.ts`**

Add to imports:

```ts
import type { ZodType } from 'zod';
```

Change `request<T>` signature in `AmanaApiClient`:

```ts
async request<T>(path: string, init: RequestInit2 = {}, schema?: ZodType<T>): Promise<T> {
  if (!this.tokenStore) throw new Error('AmanaApiClient.request requires a tokenStore');
  return this.requestOnce<T>(path, init, false, schema);
}
```

Change `requestOnce<T>` signature:

```ts
private async requestOnce<T>(path: string, init: RequestInit2, retried: boolean, schema?: ZodType<T>): Promise<T> {
```

After the `const parsed = await res.json()` line (currently `return (await res.json()) as T`), replace with:

```ts
const parsed = await res.json();
if (schema) return schema.parse(parsed) as T;
return parsed as T;
```

Update the retry call in `requestOnce` to forward the schema:

```ts
if (res.status === 401 && !retried) {
  await this.refreshNow();
  return this.requestOnce<T>(path, init, true, schema);
}
```

- [ ] **Step 4: Run tests to confirm pass**

```
cd packages/api-client && pnpm vitest run
```

Expected: All PASS

- [ ] **Step 5: Typecheck the workspace**

```
cd packages/api-client && pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```
git add packages/api-client/src/client.ts packages/api-client/tests/client.test.ts
git commit -m "feat(api-client): add optional Zod schema validation to request<T>()"
```

---

## Final Verification

- [ ] **Run the full backend test suite**

```
cd apps/backend && pnpm vitest run
```

Expected: All PASS

- [ ] **Run the full API client test suite**

```
cd packages/api-client && pnpm vitest run
```

Expected: All PASS

- [ ] **Typecheck all packages from root**

```
pnpm typecheck
```

Expected: no errors

- [ ] **Lint from root**

```
pnpm lint
```

Expected: no errors

- [ ] **Commit any lint fixes if needed, then tag the refactor complete**

```
git commit -m "chore: lint fixes from full-stack refactor"
```
