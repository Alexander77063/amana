# Sub-plan 8 — Anchor Sandbox Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Anchor virtual-account provisioning in `POST /households` with real Anchor API calls, wire the `kyc.approved`/`kyc.rejected` webhook handlers, and add both mocked integration tests and a real sandbox end-to-end test suite.

**Architecture:** Add `anchor_customer_id` to the `users` table; at household creation call Anchor's `POST /customers` then `POST /virtual-accounts` (both via the existing idempotency-cached adapter); wire `kyc.approved` → `usersRepo.setKycTier`; add `vi.mock`-based route tests for normal CI + a real-HTTP sandbox suite gated on `ANCHOR_API_KEY`.

**Tech Stack:** Drizzle ORM (schema + migration), `AnchorAdapter` (existing), Vitest (`vi.mock` + `describe.skipIf`), `node:crypto` HMAC for webhook simulation.

**Spec:** `docs/superpowers/specs/2026-06-19-sub-plan-8-anchor-sandbox-hardening-design.md`

---

## Pre-flight

```powershell
docker compose up -d
pnpm --filter @amana/backend exec drizzle-kit migrate   # ensure DB is current
pnpm --filter @amana/backend test                        # confirm green baseline
```

Expected: all tests pass.

---

## File Map

**Created:**
- `apps/backend/src/db/migrations/0020_users_anchor_customer_id.sql` — ALTER TABLE migration
- `apps/backend/src/db/migrations/meta/0020_snapshot.json` — drizzle-kit generated
- `apps/backend/tests/modules/identity/users.repo.anchor.test.ts` — new repo method tests
- `apps/backend/tests/sandbox/helpers/anchor-sim.ts` — HMAC webhook simulator
- `apps/backend/tests/sandbox/anchor-e2e.test.ts` — full payment loop against real Anchor sandbox

**Modified:**
- `apps/backend/src/db/schema/identity.ts` — add `anchorCustomerId` column to `users`
- `apps/backend/src/integrations/anchor/types.ts` — 4 new interfaces
- `apps/backend/src/integrations/anchor/adapter.ts` — add `createCustomer()`
- `apps/backend/src/modules/identity/users.repo.ts` — add `setAnchorCustomerId`, `findByAnchorCustomerId`
- `apps/backend/src/routes/households.ts` — replace placeholder with real Anchor calls
- `apps/backend/src/routes/webhooks.ts` — wire KYC handlers
- `apps/backend/tests/routes/households.test.ts` — add `vi.mock` + 5 new cases
- `apps/backend/tests/routes/webhooks.test.ts` — add 4 KYC cases
- `apps/backend/package.json` — add `test:sandbox` script

**Deleted:**
- `apps/backend/src/lib/placeholder-anchor.ts`
- `apps/backend/tests/lib/placeholder-anchor.test.ts`

---

## Task 1: Schema — add `anchor_customer_id` to `users`

**Files:**
- Modify: `apps/backend/src/db/schema/identity.ts`
- Create: `apps/backend/src/db/migrations/0020_users_anchor_customer_id.sql` *(drizzle-kit generated)*

- [ ] **Step 1: Add the column to the Drizzle schema**

In `apps/backend/src/db/schema/identity.ts`, add `anchorCustomerId` to the `users` table definition. The full updated table (show only the changed section — insert after `status`):

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  role: userRoleEnum('role').notNull(),
  phone: text('phone').notNull().unique(),
  bvn: text('bvn'),
  nin: text('nin').notNull(),
  kycTier: kycTierEnum('kyc_tier').notNull(),
  status: userStatusEnum('status').notNull().default('active'),
  anchorCustomerId: text('anchor_customer_id'),   // ← NEW
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

```powershell
pnpm --filter @amana/backend exec drizzle-kit generate --name=users_anchor_customer_id
```

Expected output: `Generated 1 migration file in apps/backend/src/db/migrations`

- [ ] **Step 3: Verify the generated SQL**

Open `apps/backend/src/db/migrations/0020_users_anchor_customer_id.sql`. It must contain exactly:

```sql
ALTER TABLE "users" ADD COLUMN "anchor_customer_id" text;
```

If drizzle-kit generated anything else (DROP, RENAME, etc.) — stop and investigate before proceeding.

- [ ] **Step 4: Apply the migration**

```powershell
pnpm --filter @amana/backend exec drizzle-kit migrate
```

Expected: `1 migration applied`

- [ ] **Step 5: Verify the column exists**

```powershell
docker exec -it amana-postgres-1 psql -U amana -d amana_dev -c "\d users"
```

Look for `anchor_customer_id | text` in the column list.

- [ ] **Step 6: Confirm tests still pass**

```powershell
pnpm --filter @amana/backend test
```

Expected: all tests pass (the new nullable column breaks nothing).

- [ ] **Step 7: Commit**

```powershell
git add apps/backend/src/db/schema/identity.ts apps/backend/src/db/migrations/0020_users_anchor_customer_id.sql apps/backend/src/db/migrations/meta/0020_snapshot.json
git commit -m "feat(backend): add anchor_customer_id column to users"
```

---

## Task 2: New Anchor types

**Files:**
- Modify: `apps/backend/src/integrations/anchor/types.ts`

- [ ] **Step 1: Add the four new interfaces**

At the bottom of `apps/backend/src/integrations/anchor/types.ts`, append:

```ts
export interface AnchorCreateCustomerRequest {
  phoneNumber: string;
  nin: string;
  bvn: string;
  fullName?: string;
}

export interface AnchorCreateCustomerResponse {
  id: string;
  fullName: string;
  phoneNumber: string;
  kycLevel: 'TIER_1' | 'TIER_2' | 'TIER_3';
}

export interface AnchorKycApprovedData {
  customerId: string;
  newKycLevel: 'TIER_2' | 'TIER_3';
}

export interface AnchorKycRejectedData {
  customerId: string;
  reason: string;
}
```

`fullName` is optional because Anchor derives it from BVN/NIN verification for Nigerian accounts. Pass it if Anchor sandbox requires it during integration testing.

- [ ] **Step 2: Verify `AnchorWebhookEventType` already includes KYC types**

Open `apps/backend/src/integrations/anchor/types.ts` and confirm `AnchorWebhookEventType` already includes `'kyc.approved' | 'kyc.rejected'`. It does — do not add them again.

- [ ] **Step 3: Typecheck**

```powershell
pnpm --filter @amana/backend typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add apps/backend/src/integrations/anchor/types.ts
git commit -m "feat(backend): add Anchor customer + KYC webhook types"
```

---

## Task 3: Anchor adapter — `createCustomer`

**Files:**
- Modify: `apps/backend/src/integrations/anchor/adapter.ts`

- [ ] **Step 1: Add the import reference and the method**

In `apps/backend/src/integrations/anchor/adapter.ts`, add `createCustomer` after the `provisionVirtualAccount` method (around line 44):

```ts
async createCustomer(
  input: import('./types').AnchorCreateCustomerRequest,
  idempotencyKey: string,
): Promise<import('./types').AnchorCreateCustomerResponse> {
  return this.execIdempotent('anchor.customer', idempotencyKey, () =>
    this.client.post<import('./types').AnchorCreateCustomerResponse>(
      '/customers',
      input,
      { idempotencyKey },
    ),
  );
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm --filter @amana/backend typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add apps/backend/src/integrations/anchor/adapter.ts
git commit -m "feat(backend): add AnchorAdapter.createCustomer()"
```

---

## Task 4: Users repo — `setAnchorCustomerId` + `findByAnchorCustomerId`

**Files:**
- Modify: `apps/backend/src/modules/identity/users.repo.ts`
- Create: `apps/backend/tests/modules/identity/users.repo.anchor.test.ts`

Note: `setKycTier` already exists in `users.repo.ts` (line 47). Do not add it again.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/modules/identity/users.repo.anchor.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('usersRepo.setAnchorCustomerId', () => {
  beforeEach(async () => { await truncateAll(); });

  it('persists anchor_customer_id on the user row', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });

    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-abc');

    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.anchorCustomerId).toBe('anchor-cust-abc');
  });
});

describe('usersRepo.findByAnchorCustomerId', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns user matching the anchor customer id', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-xyz');

    const found = await usersRepo.findByAnchorCustomerId(testDb, 'anchor-cust-xyz');
    expect(found?.id).toBe(user.id);
  });

  it('returns null when no user has that anchor customer id', async () => {
    const found = await usersRepo.findByAnchorCustomerId(testDb, 'nonexistent');
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pnpm --filter @amana/backend exec vitest run tests/modules/identity/users.repo.anchor.test.ts
```

Expected: FAIL — `usersRepo.setAnchorCustomerId is not a function`

- [ ] **Step 3: Add the two methods to `users.repo.ts`**

In `apps/backend/src/modules/identity/users.repo.ts`, add after the `setKycTier` method:

```ts
async setAnchorCustomerId(
  db: DbOrTx,
  id: string,
  anchorCustomerId: string,
): Promise<void> {
  await db.update(users).set({ anchorCustomerId }).where(eq(users.id, id));
},

async findByAnchorCustomerId(
  db: DbOrTx,
  anchorCustomerId: string,
): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.anchorCustomerId, anchorCustomerId))
    .limit(1);
  return row ?? null;
},
```

- [ ] **Step 4: Run to confirm pass**

```powershell
pnpm --filter @amana/backend exec vitest run tests/modules/identity/users.repo.anchor.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full suite to confirm no regressions**

```powershell
pnpm --filter @amana/backend test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/backend/src/modules/identity/users.repo.ts apps/backend/tests/modules/identity/users.repo.anchor.test.ts
git commit -m "feat(backend): add usersRepo.setAnchorCustomerId and findByAnchorCustomerId"
```

---

## Task 5: Update `POST /households` with real Anchor calls

**Files:**
- Modify: `apps/backend/src/routes/households.ts`
- Modify: `apps/backend/tests/routes/households.test.ts`

### Step 5a — Update the mocked tests first

- [ ] **Step 1: Add `vi.mock` and new imports to `households.test.ts`**

At the very top of `apps/backend/tests/routes/households.test.ts` (before existing imports), add:

```ts
import { vi } from 'vitest';

vi.mock('../../src/integrations/anchor', () => ({
  anchorAdapterSingleton: {
    createCustomer: vi.fn(),
    provisionVirtualAccount: vi.fn(),
  },
}));
```

Then add these imports after the existing import block:

```ts
import { anchorAdapterSingleton } from '../../src/integrations/anchor';
import { AnchorHttpError } from '../../src/integrations/anchor/client';
```

- [ ] **Step 2: Update existing `POST /households` happy-path test to set mock return values**

Replace the existing `'creates household + master wallet for principal'` test body with:

```ts
it('creates household + master wallet for principal', async () => {
  vi.mocked(anchorAdapterSingleton.createCustomer).mockResolvedValueOnce({
    id: 'anchor-cust-1',
    fullName: 'Test Principal',
    phoneNumber: '+2348012345678',
    kycLevel: 'TIER_1',
  });
  vi.mocked(anchorAdapterSingleton.provisionVirtualAccount).mockResolvedValueOnce({
    id: 'anchor-va-1',
    accountNumber: '0123456789',
    bankCode: '058',
    accountName: 'AMANA/TEST',
    customerId: 'anchor-cust-1',
    status: 'ACTIVE',
  });

  const u = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const headers = await bearerHeaders(u);
  const app = createServer();
  const res = await app.request('/households', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Adegbola family' }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    household: { id: string; name: string };
    masterWallet: { anchorVirtualAccount: string; anchorBankCode: string };
  };
  expect(body.household.name).toBe('Adegbola family');
  expect(body.masterWallet.anchorVirtualAccount).toBe('0123456789');
  expect(body.masterWallet.anchorBankCode).toBe('058');
  expect(vi.mocked(anchorAdapterSingleton.createCustomer)).toHaveBeenCalledOnce();
  expect(vi.mocked(anchorAdapterSingleton.provisionVirtualAccount)).toHaveBeenCalledOnce();

  // anchor_customer_id should be persisted on the user
  const updatedUser = await usersRepo.findById(testDb, u.id);
  expect(updatedUser?.anchorCustomerId).toBe('anchor-cust-1');

  const mw = await masterWalletsRepo.findByHousehold(testDb, body.household.id);
  expect(mw).toBeDefined();
  expect(mw?.anchorAccountId).toBe('anchor-va-1');
});
```

- [ ] **Step 3: Add `vi.clearAllMocks()` to the `POST /households` beforeEach**

```ts
describe('POST /households', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
  });
  // ... existing tests
```

- [ ] **Step 4: Add new error-case tests inside the `POST /households` describe block**

```ts
it('503 when Anchor createCustomer fails', async () => {
  vi.mocked(anchorAdapterSingleton.createCustomer).mockRejectedValueOnce(
    new AnchorHttpError(500, { error: 'internal' }, 'Anchor POST /customers → 500'),
  );
  const u = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const app = createServer();
  const res = await app.request('/households', {
    method: 'POST',
    headers: await bearerHeaders(u),
    body: JSON.stringify({ name: 'Broken household' }),
  });
  expect(res.status).toBe(503);
  // No household row should have been committed
  const hh = await householdsRepo.findByPrincipal(testDb, u.id);
  expect(hh).toBeNull();
});

it('503 when Anchor provisionVirtualAccount fails', async () => {
  vi.mocked(anchorAdapterSingleton.createCustomer).mockResolvedValueOnce({
    id: 'anchor-cust-2',
    fullName: 'Test',
    phoneNumber: '+2348012345678',
    kycLevel: 'TIER_1',
  });
  vi.mocked(anchorAdapterSingleton.provisionVirtualAccount).mockRejectedValueOnce(
    new AnchorHttpError(503, { error: 'unavailable' }, 'Anchor POST /virtual-accounts → 503'),
  );
  const u = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const app = createServer();
  const res = await app.request('/households', {
    method: 'POST',
    headers: await bearerHeaders(u),
    body: JSON.stringify({ name: 'Half-created' }),
  });
  expect(res.status).toBe(503);
  const hh = await householdsRepo.findByPrincipal(testDb, u.id);
  expect(hh).toBeNull();
});

it('skips createCustomer when user already has anchorCustomerId (re-entrancy)', async () => {
  vi.mocked(anchorAdapterSingleton.provisionVirtualAccount).mockResolvedValueOnce({
    id: 'anchor-va-2',
    accountNumber: '9876543210',
    bankCode: '058',
    accountName: 'AMANA/REENTRANT',
    customerId: 'anchor-cust-existing',
    status: 'ACTIVE',
  });
  const u = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  // Pre-set anchor customer id (simulates a previous partial attempt)
  await usersRepo.setAnchorCustomerId(testDb, u.id, 'anchor-cust-existing');

  const app = createServer();
  const res = await app.request('/households', {
    method: 'POST',
    headers: await bearerHeaders(u),
    body: JSON.stringify({ name: 'Re-entrant household' }),
  });
  expect(res.status).toBe(201);
  // createCustomer must NOT have been called
  expect(vi.mocked(anchorAdapterSingleton.createCustomer)).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Add `householdsRepo` import to `households.test.ts`** (needed for `findByPrincipal` null check)

The import already exists at line 2 of `households.test.ts`. Confirm `findByPrincipal` exists on `householdsRepo`. If not (the existing test uses `householdsRepo.insert`), you may need to use a direct DB query instead:

```ts
import { sql } from 'drizzle-orm';
// In the test:
const rows = await testDb.execute<{ id: string }>(
  sql`SELECT id FROM households WHERE principal_user_id = ${u.id}`,
);
expect(rows).toHaveLength(0);
```

Check `apps/backend/src/modules/identity/households.repo.ts` for available methods before using the first approach.

- [ ] **Step 6: Run tests to confirm they fail as expected (route not yet updated)**

```powershell
pnpm --filter @amana/backend exec vitest run tests/routes/households.test.ts
```

Expected: the updated happy-path test FAILS (route still calls placeholder), the three new tests FAIL. The 409/403/400 tests still pass.

### Step 5b — Update the route

- [ ] **Step 7: Rewrite `apps/backend/src/routes/households.ts`**

Replace the entire file content with:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { AnchorHttpError, anchorAdapterSingleton } from '../integrations/anchor';
import { parseBody } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { usersRepo } from '../modules/identity/users.repo';
import { subwalletSnoozeRepo } from '../modules/notifications/subwallet-snooze.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

export const householdsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const CreateHouseholdSchema = z.object({ name: z.string().min(1) });
    const body = await parseBody(c, CreateHouseholdSchema);
    if (body instanceof Response) return body;
    const existing = await householdsRepo.findByPrincipal(db, a.userId);
    if (existing) return c.json({ error: 'household_exists', householdId: existing.id }, 409);

    // Fetch user BEFORE transaction — need nin/bvn/anchorCustomerId
    const user = await usersRepo.findById(db, a.userId);
    if (!user) return c.json({ error: 'user_not_found' }, 404);

    try {
      return await db.transaction(async (tx) => {
        const txDb = tx as unknown as typeof db;

        const hh = await householdsRepo.insert(txDb, {
          principalUserId: a.userId,
          name: body.name.trim(),
        });

        // Re-entrancy guard: skip createCustomer if user already has an Anchor customer id
        let anchorCustomerId = user.anchorCustomerId;
        if (!anchorCustomerId) {
          const customer = await anchorAdapterSingleton.createCustomer(
            {
              phoneNumber: user.phone,
              nin: user.nin,
              bvn: user.bvn ?? '',
              // fullName is optional; Anchor derives it from BVN/NIN for Nigerian accounts.
              // If sandbox requires it, pass user.phone as a provisional value.
            },
            `anchor.customer.${a.userId}`,
          );
          anchorCustomerId = customer.id;
          await usersRepo.setAnchorCustomerId(txDb, a.userId, anchorCustomerId);
        }

        const va = await anchorAdapterSingleton.provisionVirtualAccount(
          { customerId: anchorCustomerId, label: hh.name },
          `anchor.va.${hh.id}`,
        );

        const provisioned = await masterWalletsRepo.provision(txDb, {
          householdId: hh.id,
          anchorVirtualAccount: va.accountNumber,
          anchorBankCode: va.bankCode,
          anchorAccountId: va.id,
        });

        return c.json(
          {
            household: { id: hh.id, name: hh.name, principalUserId: hh.principalUserId },
            masterWallet: {
              id: provisioned.master.id,
              anchorVirtualAccount: provisioned.master.anchorVirtualAccount,
              anchorBankCode: provisioned.master.anchorBankCode,
              currency: provisioned.master.currency,
            },
          },
          201,
        );
      });
    } catch (e) {
      if (e instanceof AnchorHttpError) {
        return c.json({ error: 'anchor_unavailable', detail: e.message }, 503);
      }
      throw e;
    }
  })
  .get('/:id/sub-wallets', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findById(db, c.req.param('id'));
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
    if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
    const subs = await subWalletsRepo.listByMaster(db, mw.id);
    const snoozes = await subwalletSnoozeRepo.listForUser(db, a.userId);
    const now = new Date();
    const snoozeMap = new Map<string, string | null>();
    for (const s of snoozes) {
      if (s.expiresAt === null || s.expiresAt > now) {
        snoozeMap.set(s.subWalletId, s.expiresAt?.toISOString() ?? null);
      }
    }
    const result = subs.map((sw) => ({
      ...sw,
      snoozedUntil: snoozeMap.has(sw.id) ? (snoozeMap.get(sw.id) ?? null) : null,
    }));
    return c.json({ subWallets: result }, 200);
  })
  .post('/:id/sub-wallets', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findById(db, c.req.param('id'));
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const CreateSubWalletSchema = z.object({
      agentUserId: z.string().uuid(),
      name: z.string().min(1),
    });
    const body = await parseBody(c, CreateSubWalletSchema);
    if (body instanceof Response) return body;
    const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
    if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
    const members = await householdsRepo.findMembers(db, hh.id);
    const isMember = members.some((m) => m.userId === body.agentUserId && m.role === 'agent');
    if (!isMember) return c.json({ error: 'agent_not_paired' }, 400);
    const provisioned = await subWalletsRepo.provision(db, {
      masterWalletId: mw.id,
      agentUserId: body.agentUserId,
      name: body.name.trim(),
    });
    return c.json(
      {
        subWallet: provisioned.sub,
        ledgerAccountId: provisioned.ledgerAccountId,
      },
      201,
    );
  });

export const meHouseholdRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/household', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findByPrincipal(db, a.userId);
    if (!hh) return c.json({ error: 'no_household' }, 404);
    const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
    if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
    return c.json(
      {
        household: { id: hh.id, name: hh.name, principalUserId: hh.principalUserId },
        masterWallet: {
          id: mw.id,
          anchorVirtualAccount: mw.anchorVirtualAccount,
          anchorBankCode: mw.anchorBankCode,
          currency: mw.currency,
          status: mw.status,
        },
      },
      200,
    );
  })
  .get('/me/household/members', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findByPrincipal(db, a.userId);
    if (!hh) return c.json({ error: 'no_household' }, 404);
    const members = await householdsRepo.findMembers(db, hh.id);
    return c.json({ members }, 200);
  });
```

- [ ] **Step 8: Run the household tests to confirm they pass**

```powershell
pnpm --filter @amana/backend exec vitest run tests/routes/households.test.ts
```

Expected: all tests pass (5 original + 3 new = 8 total in `POST /households` describe).

- [ ] **Step 9: Run full test suite**

```powershell
pnpm --filter @amana/backend test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```powershell
git add apps/backend/src/routes/households.ts apps/backend/tests/routes/households.test.ts
git commit -m "feat(backend): replace placeholder Anchor provisioning with real API calls in POST /households"
```

---

## Task 6: Wire KYC webhook handlers

**Files:**
- Modify: `apps/backend/src/routes/webhooks.ts`
- Modify: `apps/backend/tests/routes/webhooks.test.ts`

### Step 6a — Add test cases first

- [ ] **Step 1: Add KYC test cases to `webhooks.test.ts`**

Add a new `describe` block at the bottom of `apps/backend/tests/routes/webhooks.test.ts`:

```ts
describe('POST /webhooks/anchor — KYC events', () => {
  beforeEach(async () => {
    await truncateAll();
    process.env.ANCHOR_WEBHOOK_SECRET = SECRET;
  });

  it('kyc.approved TIER_2 → updates user kycTier to 2', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-kyc-1');

    const app = createServer();
    const payload = JSON.stringify({
      id: 'evt-kyc-1',
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-kyc-1', newKycLevel: 'TIER_2' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.kycTier).toBe('2');
  });

  it('kyc.approved TIER_3 → updates user kycTier to 3', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-kyc-2');

    const app = createServer();
    const payload = JSON.stringify({
      id: 'evt-kyc-2',
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-kyc-2', newKycLevel: 'TIER_3' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.kycTier).toBe('3');
  });

  it('kyc.rejected → 200 ack, kycTier unchanged', async () => {
    const user = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '1',
      bvn: factories.bvn(),
    });
    await usersRepo.setAnchorCustomerId(testDb, user.id, 'anchor-cust-kyc-3');

    const app = createServer();
    const payload = JSON.stringify({
      id: 'evt-kyc-3',
      type: 'kyc.rejected',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-kyc-3', reason: 'BVN mismatch' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const updated = await usersRepo.findById(testDb, user.id);
    expect(updated?.kycTier).toBe('1');  // unchanged
  });

  it('kyc.approved with unknown customerId → 200 ack (warn, no crash)', async () => {
    const app = createServer();
    const payload = JSON.stringify({
      id: 'evt-kyc-4',
      type: 'kyc.approved',
      createdAt: new Date().toISOString(),
      data: { customerId: 'anchor-cust-unknown', newKycLevel: 'TIER_2' },
    });
    const res = await app.request('/webhooks/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-signature': sign(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);
  });
});
```

Add these imports to `webhooks.test.ts` (alongside existing imports):

```ts
import { usersRepo } from '../../src/modules/identity/users.repo';
import { factories } from '../helpers/factories';
```

- [ ] **Step 2: Run to confirm the 4 new tests fail**

```powershell
pnpm --filter @amana/backend exec vitest run tests/routes/webhooks.test.ts
```

Expected: the 4 new `KYC events` tests FAIL (ack-only handler doesn't update kycTier). Existing tests still pass.

### Step 6b — Implement the handlers

- [ ] **Step 3: Update `apps/backend/src/routes/webhooks.ts`**

Add these imports at the top of the file (alongside existing imports):

```ts
import type { AnchorKycApprovedData, AnchorKycRejectedData } from '../integrations/anchor/types';
import { usersRepo } from '../modules/identity/users.repo';
```

Then replace the ack-only `kyc.*` branch inside the `try { ... }` dispatch block. Find:

```ts
} else {
  // kyc.* events: ack only for now (KYC service lands in Sub-plan 6)
  logger.info({ type: event.type }, 'anchor webhook: ack-only (handler not yet implemented)');
}
```

Replace it with:

```ts
} else if (event.type === 'kyc.approved') {
  const data = event.data as AnchorKycApprovedData;
  const ourTier = data.newKycLevel === 'TIER_3' ? '3' : '2';
  const user = await usersRepo.findByAnchorCustomerId(db, data.customerId);
  if (user) {
    await usersRepo.setKycTier(db, user.id, ourTier);
  } else {
    logger.warn({ customerId: data.customerId }, 'kyc.approved: no matching user');
  }
} else if (event.type === 'kyc.rejected') {
  const data = event.data as AnchorKycRejectedData;
  logger.warn({ customerId: data.customerId, reason: data.reason }, 'kyc.rejected');
} else {
  logger.info({ type: event.type }, 'anchor webhook: unhandled event type');
}
```

- [ ] **Step 4: Run webhook tests to confirm all pass**

```powershell
pnpm --filter @amana/backend exec vitest run tests/routes/webhooks.test.ts
```

Expected: all tests pass (existing + 4 new KYC cases).

- [ ] **Step 5: Run full test suite**

```powershell
pnpm --filter @amana/backend test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/backend/src/routes/webhooks.ts apps/backend/tests/routes/webhooks.test.ts
git commit -m "feat(backend): wire kyc.approved and kyc.rejected webhook handlers"
```

---

## Task 7: Delete `placeholder-anchor`

**Files:**
- Delete: `apps/backend/src/lib/placeholder-anchor.ts`
- Delete: `apps/backend/tests/lib/placeholder-anchor.test.ts`

- [ ] **Step 1: Confirm no remaining imports**

```powershell
pnpm --filter @amana/backend exec grep -r "placeholder-anchor" src/ tests/
```

Expected: no output. If any file still imports it, fix the import before deleting.

- [ ] **Step 2: Delete the files**

```powershell
Remove-Item apps/backend/src/lib/placeholder-anchor.ts
Remove-Item apps/backend/tests/lib/placeholder-anchor.test.ts
```

- [ ] **Step 3: Run full test suite**

```powershell
pnpm --filter @amana/backend test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "chore(backend): delete placeholder-anchor (replaced by real Anchor provisioning)"
```

---

## Task 8: Sandbox webhook simulator helper

**Files:**
- Create: `apps/backend/tests/sandbox/helpers/anchor-sim.ts`

- [ ] **Step 1: Create the directory and helper**

```powershell
New-Item -ItemType Directory -Force apps/backend/tests/sandbox/helpers
```

Create `apps/backend/tests/sandbox/helpers/anchor-sim.ts`:

```ts
import { createHmac } from 'node:crypto';

const BASE_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

export async function simulateWebhook(event: {
  id: string;
  type: string;
  createdAt: string;
  data: unknown;
}): Promise<{ status: number; body: unknown }> {
  const secret = process.env.ANCHOR_WEBHOOK_SECRET;
  if (!secret) throw new Error('ANCHOR_WEBHOOK_SECRET must be set to simulate webhooks');

  const raw = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(raw).digest('hex');

  const res = await fetch(`${BASE_URL}/webhooks/anchor`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-anchor-signature': sig,
    },
    body: raw,
  });

  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm --filter @amana/backend typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add apps/backend/tests/sandbox/helpers/anchor-sim.ts
git commit -m "test(backend): add anchor-sim webhook helper for sandbox tests"
```

---

## Task 9: Sandbox end-to-end test

**Files:**
- Create: `apps/backend/tests/sandbox/anchor-e2e.test.ts`

**Prerequisites before running this test:**
- `ANCHOR_API_KEY` env var pointing at Anchor's sandbox (`https://api.sandbox.getanchor.co`)
- `ANCHOR_WEBHOOK_SECRET` set to a value matching the running dev server's secret
- `DEV_OTP_BYPASS_CODE` set (bypass Termii in local dev)
- Backend dev server running: `pnpm --filter @amana/backend dev`

- [ ] **Step 1: Create the sandbox test file**

Create `apps/backend/tests/sandbox/anchor-e2e.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';
import { simulateWebhook } from './helpers/anchor-sim';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

async function apiRequest(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe.skipIf(!process.env.ANCHOR_API_KEY)(
  'Anchor sandbox — full payment loop',
  () => {
    it('provisions a real virtual account and settles a spend', async () => {
      await truncateAll();

      // Step 1 — Register a principal directly (bypasses OTP for speed)
      const phone = factories.phone();
      const nin = factories.nin();
      const bvn = factories.bvn();
      const principal = await usersRepo.insert(testDb, {
        role: 'principal',
        phone,
        nin,
        bvn,
        kycTier: '1',
      });

      // Step 2 — Get an access token via OTP bypass
      const otpReq = await apiRequest('POST', '/auth/otp/request', {
        body: { phone, purpose: 'login' },
      });
      expect(otpReq.status).toBe(200);

      const otpVerify = await apiRequest('POST', '/auth/otp/verify', {
        body: { phone, code: process.env.DEV_OTP_BYPASS_CODE ?? '000000' },
      });
      expect(otpVerify.status).toBe(200);
      const { accessToken } = otpVerify.body as { accessToken: string };

      // Step 3 — Create household (real Anchor createCustomer + provisionVirtualAccount)
      const hhRes = await apiRequest('POST', '/households', {
        token: accessToken,
        body: { name: 'Sandbox Family' },
      });
      expect(hhRes.status).toBe(201);
      const { household, masterWallet } = hhRes.body as {
        household: { id: string };
        masterWallet: { anchorVirtualAccount: string; anchorBankCode: string };
      };

      // Verify real virtual account was persisted
      expect(masterWallet.anchorVirtualAccount).toMatch(/^\d{10}$/);
      expect(masterWallet.anchorBankCode).toBeTruthy();

      const updatedUser = await usersRepo.findById(testDb, principal.id);
      expect(updatedUser?.anchorCustomerId).toBeTruthy();

      const mw = await masterWalletsRepo.findByHousehold(testDb, household.id);
      expect(mw?.anchorAccountId).not.toMatch(/^placeholder-anchor-/);

      // Step 4 — Simulate a topup via webhook
      const topupAmount = 10_000_00; // ₦10,000 in kobo
      const nibssTopupId = factories.nibssSessionId();
      const topupEvt = await simulateWebhook({
        id: `sandbox-topup-${randomUUID()}`,
        type: 'virtual_account.credited',
        createdAt: new Date().toISOString(),
        data: {
          virtualAccountId: mw?.anchorAccountId,
          amountKobo: String(topupAmount),
          senderBankCode: '058',
          senderAccountNumber: factories.bankAccount(),
          senderAccountName: 'SANDBOX SENDER',
          nibssSessionId: nibssTopupId,
        },
      });
      expect(topupEvt.status).toBe(200);

      // Verify topup transaction was booked
      const topupTxn = await transactionsRepo.findByIdempotencyKey(
        testDb,
        `topup:${nibssTopupId}`,
      );
      expect(topupTxn).toBeDefined();
      expect(topupTxn?.status).toBe('settled');

      // Step 5 — Verify kyc.approved webhook updates tier
      const kycEvt = await simulateWebhook({
        id: `sandbox-kyc-${randomUUID()}`,
        type: 'kyc.approved',
        createdAt: new Date().toISOString(),
        data: {
          customerId: updatedUser?.anchorCustomerId,
          newKycLevel: 'TIER_2',
        },
      });
      expect(kycEvt.status).toBe(200);

      const tierUpdated = await usersRepo.findById(testDb, principal.id);
      expect(tierUpdated?.kycTier).toBe('2');
    }, 60_000); // 60s timeout — Anchor sandbox can be slow
  },
);
```

- [ ] **Step 2: Verify the test file typechecks**

```powershell
pnpm --filter @amana/backend typecheck
```

Expected: no errors.

- [ ] **Step 3: Verify the test is skipped in normal test runs (no API key)**

```powershell
pnpm --filter @amana/backend test
```

Expected: all existing tests pass; the sandbox test shows as skipped (not failed).

- [ ] **Step 4: Commit**

```powershell
git add apps/backend/tests/sandbox/anchor-e2e.test.ts
git commit -m "test(backend): add Anchor sandbox e2e test (gated on ANCHOR_API_KEY)"
```

---

## Task 10: Add `test:sandbox` script

**Files:**
- Modify: `apps/backend/package.json`

- [ ] **Step 1: Add the script**

In `apps/backend/package.json`, add to the `"scripts"` block after `"test:watch"`:

```json
"test:sandbox": "vitest run tests/sandbox/",
```

The final scripts block:

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "dev": "tsx watch src/index.ts",
  "start": "node dist/index.js",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "lint": "biome check .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:sandbox": "vitest run tests/sandbox/",
  "cron": "tsx bin/cron.ts",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio"
},
```

- [ ] **Step 2: Verify the script resolves**

```powershell
pnpm --filter @amana/backend run test:sandbox 2>&1 | Select-String -Pattern "skip|pass|fail|error" | Select-Object -First 10
```

Expected: test shows as skipped (no `ANCHOR_API_KEY` set) — not failed.

- [ ] **Step 3: Run final full test suite**

```powershell
pnpm --filter @amana/backend test
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck all packages**

```powershell
pnpm --filter @amana/backend typecheck
```

Expected: no errors.

- [ ] **Step 5: Final commit**

```powershell
git add apps/backend/package.json
git commit -m "chore(backend): add test:sandbox script for Anchor sandbox e2e tests"
```

---

## Post-implementation checklist

- [ ] All existing tests still pass: `pnpm --filter @amana/backend test`
- [ ] No TypeScript errors: `pnpm --filter @amana/backend typecheck`
- [ ] `placeholder-anchor.ts` and its test are deleted
- [ ] `POST /households` no longer imports from `placeholder-anchor`
- [ ] `users.anchor_customer_id` column exists in the DB
- [ ] `pnpm test:sandbox` exits 0 when `ANCHOR_API_KEY` is not set (all skipped, not failed)
- [ ] When `ANCHOR_API_KEY` is available: run `pnpm --filter @amana/backend run test:sandbox` against a running dev server to verify the full payment loop
