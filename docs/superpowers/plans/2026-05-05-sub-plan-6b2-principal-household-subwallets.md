# Sub-plan 6b-2 — Principal Mobile App: household + sub-wallet management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A principal user can set up their household, pair agents, create sub-wallets backed by paired agents, edit per-sub-wallet rules, and suspend/resume them — end to end across backend HTTP + mobile UI.

**Architecture:** Two layers added on top of v0.0.6b1. (1) Backend HTTP gap-fill — eight new principal-only routes (`/me/household`, `POST /households`, `GET/POST /households/:id/sub-wallets`, `GET/PATCH /sub-wallets/:id`, `GET /sub-wallets/:id/{balance,rules}`, `POST /sub-wallets/:id/rules`, plus `GET /me/household/members`). The `POST /households` route also provisions the master wallet using a **placeholder Anchor virtual account** (deterministic 10-digit derived from household ID + bank code `058`); real Anchor virtual-account provisioning is deferred to Sub-plan 7. (2) Mobile — extend `@amana/api-client` with `HouseholdApi` + `SubWalletApi` + `PairingApi`, add Zustand `household.store` and `subwallets.store`, replace the placeholder Home with a real Dashboard plus screens for household setup, pairing, sub-wallet CRUD, and rule editing.

**Tech Stack:** Backend — Hono + Drizzle (existing). Mobile — Expo SDK 51 + React Navigation v7 + Zustand 5 + react-hook-form + zod (existing). No new top-level dependencies.

---

## Pre-flight: dist build (do once at the start)

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
```

The mobile app consumes `@amana/types` and `@amana/api-client` as workspace packages. After Phase B adds new exports, repeat these builds before any subsequent mobile typecheck.

---

## File structure produced by this plan

**Backend (new):**
- `apps/backend/src/routes/households.ts` — `POST /households` + `GET /me/household` + `GET /me/household/members` + `GET /households/:id/sub-wallets` + `POST /households/:id/sub-wallets`
- `apps/backend/src/routes/sub-wallets.ts` — `GET /sub-wallets/:id` + `PATCH /sub-wallets/:id` + `GET /sub-wallets/:id/balance` + `GET /sub-wallets/:id/rules` + `POST /sub-wallets/:id/rules`
- `apps/backend/src/lib/placeholder-anchor.ts` — deterministic-fake virtual account generator
- `apps/backend/src/modules/wallet/balance.service.ts` — `accountBalanceForSubWallet(db, subWalletId)`
- `apps/backend/tests/routes/households.test.ts`, `tests/routes/sub-wallets.test.ts`, `tests/lib/placeholder-anchor.test.ts`, `tests/modules/wallet/balance.service.test.ts`

**Backend (modified):**
- `apps/backend/src/server.ts` — mount the two new route groups
- `apps/backend/src/modules/identity/households.repo.ts` — add `findMembers` (joined-rows view)
- `apps/backend/src/modules/wallet/sub-wallets.repo.ts` — add `findByIdWithMaster` helper
- `apps/backend/src/modules/rules/rule-set.service.ts` — add `getActiveWithRules(db, subWalletId)` read helper

**Shared types (new in `packages/types/src`):**
- `household.ts` — `Household`, `HouseholdMember`, `MasterWalletPublic`, `SubWallet`, `SubWalletStatus`, `RuleConfig`
- `index.ts` — re-export

**API client (new in `packages/api-client/src`):**
- `household-api.ts` — `HouseholdApi` (createHousehold, getMyHousehold, listMembers, listSubWallets, createSubWallet)
- `sub-wallet-api.ts` — `SubWalletApi` (get, patchStatus, getBalance, getRules, publishRules)
- `pairing-api.ts` — `PairingApi` (issuePairingCode)
- `index.ts` — re-export
- `tests/household-api.test.ts`, `tests/sub-wallet-api.test.ts`, `tests/pairing-api.test.ts`

**Principal mobile (new in `apps/principal/src`):**
- `state/household.store.ts` — Zustand: `bootstrap` (load own household), `createHousehold`, `members`, etc.
- `state/subwallets.store.ts` — Zustand: list/create/get sub-wallets, edit rules
- `nav/MainStack.tsx` — extend with Pairing, Members, SubWallet*, Rules screens
- `screens/HouseholdSetupScreen.tsx` — first-time household creation form
- `screens/HomeDashboardScreen.tsx` — replaces the 6b-1 Home placeholder
- `screens/PairingScreen.tsx` — issue pairing code + display + copy
- `screens/MembersScreen.tsx` — list paired agents
- `screens/SubWalletsListScreen.tsx`
- `screens/CreateSubWalletScreen.tsx`
- `screens/SubWalletDetailScreen.tsx`
- `screens/EditRulesScreen.tsx`

---

## Phase A — Backend gap-fill (Tasks 1-9)

### Task 1 — Placeholder Anchor virtual-account generator

**Files:**
- Create: `apps/backend/src/lib/placeholder-anchor.ts`
- Create: `apps/backend/tests/lib/placeholder-anchor.test.ts`

The intent is to unblock household provisioning without a real Anchor account. Real provisioning lands in Sub-plan 7.

- [ ] **Step 1: Implementation**

```ts
// apps/backend/src/lib/placeholder-anchor.ts
/**
 * Deterministic fake virtual-account generator used until Sub-plan 7 wires
 * real Anchor virtual-account provisioning. Same household ID always yields
 * the same 10-digit account so test seeds + manual smokes are stable.
 *
 * NEVER use this in production. The boot guard in `provisionMasterWalletWithPlaceholderAnchor`
 * throws if `NODE_ENV === 'production'` AND the env flag `ANCHOR_REAL_PROVISIONING` is unset —
 * by Sub-plan 7 the flag will be set and a real call replaces this function.
 */
import { createHash } from 'node:crypto';

export type PlaceholderAnchorAccount = {
  anchorVirtualAccount: string;
  anchorBankCode: string;
  anchorAccountId: string;
};

export const PLACEHOLDER_BANK_CODE = '058'; // Anchor's typical sandbox bank code

export function placeholderAnchorAccountForHousehold(householdId: string): PlaceholderAnchorAccount {
  const digest = createHash('sha256').update(`amana:household:${householdId}`).digest('hex');
  // Take 10 hex chars, parse as int, mod 1e10, pad with leading zeros.
  const slice = digest.slice(0, 12);
  const num = Number.parseInt(slice, 16) % 10_000_000_000;
  const anchorVirtualAccount = String(num).padStart(10, '0');
  return {
    anchorVirtualAccount,
    anchorBankCode: PLACEHOLDER_BANK_CODE,
    anchorAccountId: `placeholder-anchor-${householdId}`,
  };
}
```

- [ ] **Step 2: Test**

```ts
// apps/backend/tests/lib/placeholder-anchor.test.ts
import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_BANK_CODE,
  placeholderAnchorAccountForHousehold,
} from '../../src/lib/placeholder-anchor';

describe('placeholderAnchorAccountForHousehold', () => {
  it('returns a 10-digit virtual account', () => {
    const a = placeholderAnchorAccountForHousehold('11111111-1111-1111-1111-111111111111');
    expect(a.anchorVirtualAccount).toMatch(/^\d{10}$/);
    expect(a.anchorBankCode).toBe(PLACEHOLDER_BANK_CODE);
  });

  it('is deterministic for the same household ID', () => {
    const id = '22222222-2222-2222-2222-222222222222';
    const a = placeholderAnchorAccountForHousehold(id);
    const b = placeholderAnchorAccountForHousehold(id);
    expect(a).toEqual(b);
  });

  it('produces different accounts for different households', () => {
    const a = placeholderAnchorAccountForHousehold('11111111-1111-1111-1111-111111111111');
    const b = placeholderAnchorAccountForHousehold('33333333-3333-3333-3333-333333333333');
    expect(a.anchorVirtualAccount).not.toBe(b.anchorVirtualAccount);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/lib/placeholder-anchor.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/lib/placeholder-anchor.ts apps/backend/tests/lib/placeholder-anchor.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(lib): placeholder Anchor virtual-account generator (deterministic per household; sub-plan 7 replaces with real provisioning)"
```

---

### Task 2 — `balance.service.accountBalanceForSubWallet`

**Files:**
- Create: `apps/backend/src/modules/wallet/balance.service.ts`
- Create: `apps/backend/tests/modules/wallet/balance.service.test.ts`
- Modify: `apps/backend/src/modules/wallet/index.ts` — re-export

The HTTP route `GET /sub-wallets/:id/balance` returns kobo as a string (BigInt-safe). The service does the lookup + sums postings via the existing `postingsRepo.accountBalance(db, ledgerAccountId)`.

- [ ] **Step 1: Service**

```ts
// apps/backend/src/modules/wallet/balance.service.ts
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ledgerAccounts } from '../../db/schema';
import { postingsRepo } from './postings.repo';

type DbOrTx = PostgresJsDatabase;

export const balanceService = {
  /** Returns the sub-wallet's current ledger balance in kobo. */
  async accountBalanceForSubWallet(db: DbOrTx, subWalletId: string): Promise<bigint> {
    const [la] = await db
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.subWalletId, subWalletId), eq(ledgerAccounts.kind, 'sub')))
      .limit(1);
    if (!la) throw new Error(`balance: no sub ledger-account for ${subWalletId}`);
    return postingsRepo.accountBalance(db, la.id);
  },
};
```

- [ ] **Step 2: Re-export from `apps/backend/src/modules/wallet/index.ts`** — append:

```ts
export { balanceService } from './balance.service';
```

- [ ] **Step 3: Test**

```ts
// apps/backend/tests/modules/wallet/balance.service.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { balanceService } from '../../../src/modules/wallet/balance.service';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('balanceService.accountBalanceForSubWallet', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns 0 for a fresh sub-wallet', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0123456789',
      anchorBankCode: '058', anchorAccountId: 'a-1',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'A',
    });
    expect(await balanceService.accountBalanceForSubWallet(testDb, sw.sub.id)).toBe(0n);
  });

  it('reflects topup posting (debit sub, credit suspense) — sum debit minus credit on sub LA = topup amount', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0123456789',
      anchorBankCode: '058', anchorAccountId: 'a-2',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'A',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(50_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(50_000n), creditKobo: kobo(0n) },
      { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(50_000n) },
    ]);
    expect(await balanceService.accountBalanceForSubWallet(testDb, sw.sub.id)).toBe(50_000n);
  });

  it('throws when sub-wallet has no ledger account', async () => {
    await expect(
      balanceService.accountBalanceForSubWallet(testDb, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/no sub ledger-account/);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend test tests/modules/wallet/balance.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/wallet/balance.service.ts apps/backend/src/modules/wallet/index.ts apps/backend/tests/modules/wallet/balance.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(wallet): balance.service.accountBalanceForSubWallet"
```

---

### Task 3 — Households repo helpers + rule-set read helper

**Files:**
- Modify: `apps/backend/src/modules/identity/households.repo.ts` — add `findMembers` (joins household_members + users)
- Modify: `apps/backend/src/modules/rules/rule-set.service.ts` — add `getActiveWithRules`
- Modify: `apps/backend/src/modules/rules/index.ts` — re-export `getActiveWithRules` already covered by service barrel; verify

- [ ] **Step 1: Add `findMembers` to households.repo**

Edit `apps/backend/src/modules/identity/households.repo.ts`. Inside the `householdsRepo` object, after `findByPrincipal`, append:

```ts
  /**
   * Returns paired agents (household_members joined to users) for a household.
   * Includes the user's id, role, phone, nin, kycTier, and the member's status + joined_at.
   */
  async findMembers(
    db: DbOrTx,
    householdId: string,
  ): Promise<Array<{
    userId: string;
    phone: string;
    role: 'principal' | 'agent';
    kycTier: '1' | '2' | '3';
    status: 'active' | 'suspended';
    joinedAt: Date;
  }>> {
    const rows = await db.execute<{
      user_id: string;
      phone: string;
      role: 'principal' | 'agent';
      kyc_tier: '1' | '2' | '3';
      status: 'active' | 'suspended';
      joined_at: Date;
    }>(sql`
      SELECT u.id AS user_id, u.phone, u.role, u.kyc_tier, hm.status, hm.joined_at
      FROM household_members hm
      INNER JOIN users u ON u.id = hm.user_id
      WHERE hm.household_id = ${householdId}
      ORDER BY hm.joined_at ASC
    `);
    return rows.map((r) => ({
      userId: r.user_id,
      phone: r.phone,
      role: r.role,
      kycTier: r.kyc_tier,
      status: r.status,
      joinedAt: r.joined_at,
    }));
  },
```

The file already imports `eq` from `drizzle-orm`; you also need `sql`. Add to the existing import:

```ts
import { eq, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Add `getActiveWithRules` to rule-set service**

Edit `apps/backend/src/modules/rules/rule-set.service.ts`. Inside `ruleSetService`, after `publishNewVersion`, append:

```ts
  async getActiveWithRules(
    db: DbOrTx,
    subWalletId: string,
  ): Promise<{
    ruleSetId: string;
    version: number;
    rules: Array<{ id: string; kind: string; priority: number; configJson: unknown }>;
  } | null> {
    const active = await ruleSetsRepo.findActive(db, subWalletId);
    if (!active) return null;
    const rs = await rulesRepo.listByRuleSet(db, active.id);
    return {
      ruleSetId: active.id,
      version: active.version,
      rules: rs.map((r) => ({
        id: r.id,
        kind: r.kind,
        priority: r.priority,
        configJson: r.configJson,
      })),
    };
  },
```

If `rulesRepo.listByRuleSet` doesn't exist, add it to `apps/backend/src/modules/rules/rules.repo.ts`:

```ts
async listByRuleSet(db: DbOrTx, ruleSetId: string): Promise<RuleRow[]> {
  return db.select().from(rules).where(eq(rules.ruleSetId, ruleSetId)).orderBy(rules.priority);
},
```

- [ ] **Step 3: Tests**

For now, these helpers are exercised by the route tests in T4-T8. No unit test is required at this layer if the repo + service are simple read-paths.

- [ ] **Step 4: Verify biome + typecheck + commit**

```bash
cd "C:/Users/alex_/amana/apps/backend"
pnpm exec biome check src/modules/identity/households.repo.ts src/modules/rules/rule-set.service.ts src/modules/rules/rules.repo.ts
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend exec tsc --noEmit -p tsconfig.json
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/identity/households.repo.ts apps/backend/src/modules/rules/rule-set.service.ts apps/backend/src/modules/rules/rules.repo.ts
git -C "C:/Users/alex_/amana" commit -m "feat(wallet/rules): findMembers + getActiveWithRules helpers"
```

---

### Task 4 — `households.ts` route group: POST + GET /me/household + members

**Files:**
- Create: `apps/backend/src/routes/households.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/households.test.ts`

This task adds three endpoints; the next task adds two more sub-wallet-related endpoints to the same route group.

- [ ] **Step 1: Initial route file**

```ts
// apps/backend/src/routes/households.ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { placeholderAnchorAccountForHousehold } from '../lib/placeholder-anchor';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';

export const householdsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const body = await c.req.json<{ name: string }>();
    if (!body.name || body.name.trim().length === 0) {
      return c.json({ error: 'name_required' }, 400);
    }
    const existing = await householdsRepo.findByPrincipal(db, a.userId);
    if (existing) return c.json({ error: 'household_exists', householdId: existing.id }, 409);

    return db.transaction(async (tx) => {
      const txDb = tx as typeof db;
      const hh = await householdsRepo.insert(txDb, {
        principalUserId: a.userId,
        name: body.name.trim(),
      });
      const anchor = placeholderAnchorAccountForHousehold(hh.id);
      const provisioned = await masterWalletsRepo.provision(txDb, {
        householdId: hh.id,
        anchorVirtualAccount: anchor.anchorVirtualAccount,
        anchorBankCode: anchor.anchorBankCode,
        anchorAccountId: anchor.anchorAccountId,
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
    return c.json({
      household: { id: hh.id, name: hh.name, principalUserId: hh.principalUserId },
      masterWallet: {
        id: mw.id,
        anchorVirtualAccount: mw.anchorVirtualAccount,
        anchorBankCode: mw.anchorBankCode,
        currency: mw.currency,
        status: mw.status,
      },
    }, 200);
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

- [ ] **Step 2: Mount in `server.ts`**

In `apps/backend/src/server.ts`, add the imports and mounts:

```ts
import { householdsRoute, meHouseholdRoute } from './routes/households';
// inside createServer, alongside the other route mounts:
app.route('/households', householdsRoute);
app.route('/', meHouseholdRoute);
```

- [ ] **Step 3: Initial tests**

```ts
// apps/backend/tests/routes/households.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionService } from '../../src/modules/auth/session.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

describe('POST /households', () => {
  beforeEach(async () => { await truncateAll(); });

  it('creates household + master wallet for principal', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Adegbola family' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      household: { id: string; name: string };
      masterWallet: { anchorVirtualAccount: string; anchorBankCode: string };
    };
    expect(body.household.name).toBe('Adegbola family');
    expect(body.masterWallet.anchorVirtualAccount).toMatch(/^\d{10}$/);
    expect(body.masterWallet.anchorBankCode).toBe('058');

    // Master wallet really exists in DB.
    const mw = await masterWalletsRepo.findByHousehold(testDb, body.household.id);
    expect(mw).toBeDefined();
  });

  it('409 when principal already has a household', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    await householdsRepo.insert(testDb, { principalUserId: u.id, name: 'First' });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Second' }),
    });
    expect(res.status).toBe(409);
  });

  it('403 for agents', async () => {
    const a = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const headers = await bearerHeaders(a);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'nope' }),
    });
    expect(res.status).toBe(403);
  });

  it('400 on empty name', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/households', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /me/household', () => {
  beforeEach(async () => { await truncateAll(); });

  it('404 when principal has no household', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/me/household', { headers });
    expect(res.status).toBe(404);
  });

  it('returns household + master wallet after creation', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: u.id, name: 'HH' });
    await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0123456789',
      anchorBankCode: '058', anchorAccountId: 'a-1',
    });
    const headers = await bearerHeaders(u);
    const app = createServer();
    const res = await app.request('/me/household', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { household: { name: string }; masterWallet: { anchorVirtualAccount: string } };
    expect(body.household.name).toBe('HH');
    expect(body.masterWallet.anchorVirtualAccount).toBe('0123456789');
  });
});

describe('GET /me/household/members', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns paired agents', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    // Direct upsert (the pairing service path is covered in 6a tests)
    await testDb.execute(
      `INSERT INTO household_members (household_id, user_id) VALUES ('${hh.id}', '${agent.id}')` as unknown as TemplateStringsArray,
    );

    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request('/me/household/members', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { members: Array<{ userId: string; role: string }> };
    expect(body.members).toHaveLength(1);
    expect(body.members[0].userId).toBe(agent.id);
  });
});
```

(For the `INSERT INTO household_members` test, the implementer should use Drizzle's `db.execute(sql\`...\`)` properly — the snippet above is illustrative. Use the `householdMembersRepo.add(testDb, hh.id, agent.id)` method instead, which already exists.)

Replace the inline SQL with:
```ts
import { householdMembersRepo } from '../../src/modules/identity/household-members.repo';
// ...
await householdMembersRepo.add(testDb, hh.id, agent.id);
```

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/households.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/households.ts apps/backend/src/server.ts apps/backend/tests/routes/households.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /households + GET /me/household + GET /me/household/members"
```

All 7 tests must pass.

---

### Task 5 — Sub-wallet list + create routes (extend `households.ts`)

**Files:**
- Modify: `apps/backend/src/routes/households.ts`
- Modify: `apps/backend/tests/routes/households.test.ts`

The two endpoints are nested under `/households/:id/sub-wallets`. Both are principal-only and check `household.principalUserId === actor.userId`.

- [ ] **Step 1: Extend the route**

In `apps/backend/src/routes/households.ts`, add to the `householdsRoute` chain (after `.post('/', ...)`):

```ts
.get('/:id/sub-wallets', async (c) => {
  const a = c.get('actor');
  if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
  const hh = await householdsRepo.findById(db, c.req.param('id'));
  if (!hh) return c.json({ error: 'household_not_found' }, 404);
  if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
  const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
  if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
  const subs = await subWalletsRepo.listByMaster(db, mw.id);
  return c.json({ subWallets: subs }, 200);
})
.post('/:id/sub-wallets', async (c) => {
  const a = c.get('actor');
  if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
  const hh = await householdsRepo.findById(db, c.req.param('id'));
  if (!hh) return c.json({ error: 'household_not_found' }, 404);
  if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
  const body = await c.req.json<{ agentUserId: string; name: string }>();
  if (!body.agentUserId || !body.name?.trim()) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
  if (!mw) return c.json({ error: 'no_master_wallet' }, 500);

  // Agent must already be a household member.
  const members = await householdsRepo.findMembers(db, hh.id);
  const isMember = members.some((m) => m.userId === body.agentUserId && m.role === 'agent');
  if (!isMember) return c.json({ error: 'agent_not_paired' }, 400);

  const provisioned = await subWalletsRepo.provision(db, {
    masterWalletId: mw.id,
    agentUserId: body.agentUserId,
    name: body.name.trim(),
  });
  return c.json({
    subWallet: provisioned.sub,
    ledgerAccountId: provisioned.ledgerAccountId,
  }, 201);
});
```

Also add the `subWalletsRepo` import at the top:

```ts
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';
```

- [ ] **Step 2: Tests** — append to `apps/backend/tests/routes/households.test.ts`:

```ts
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';

describe('GET /households/:id/sub-wallets', () => {
  beforeEach(async () => { await truncateAll(); });

  it('lists sub-wallets for the principal\'s own household', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0123456789',
      anchorBankCode: '058', anchorAccountId: 'a-1',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
    });
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/households/${hh.id}/sub-wallets`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWallets: Array<{ name: string }> };
    expect(body.subWallets).toHaveLength(1);
    expect(body.subWallets[0].name).toBe('Driver');
  });

  it('403 not_your_household when querying another principal\'s household', async () => {
    const principalA = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const principalB = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hhB = await householdsRepo.insert(testDb, { principalUserId: principalB.id, name: 'B' });
    const headers = await bearerHeaders(principalA);
    const app = createServer();
    const res = await app.request(`/households/${hhB.id}/sub-wallets`, { headers });
    expect(res.status).toBe(403);
  });
});

describe('POST /households/:id/sub-wallets', () => {
  beforeEach(async () => { await truncateAll(); });

  it('creates a sub-wallet for a paired agent', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0123456789',
      anchorBankCode: '058', anchorAccountId: 'a-1',
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    await householdMembersRepo.add(testDb, hh.id, agent.id);
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/households/${hh.id}/sub-wallets`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentUserId: agent.id, name: 'School fees' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { subWallet: { name: string; agentUserId: string } };
    expect(body.subWallet.name).toBe('School fees');
    expect(body.subWallet.agentUserId).toBe(agent.id);
  });

  it('400 agent_not_paired when agent is not a household member', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0123456789',
      anchorBankCode: '058', anchorAccountId: 'a-1',
    });
    const orphanAgent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/households/${hh.id}/sub-wallets`, {
      method: 'POST', headers,
      body: JSON.stringify({ agentUserId: orphanAgent.id, name: 'X' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'agent_not_paired' });
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/households.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/households.ts apps/backend/tests/routes/households.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): GET/POST /households/:id/sub-wallets (paired-agent gate)"
```

---

### Task 6 — `sub-wallets.ts` route group: detail, status, balance

**Files:**
- Create: `apps/backend/src/routes/sub-wallets.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/sub-wallets.test.ts`

This route group covers the per-sub-wallet operations. Owner check goes through `subWallet.master_wallet_id → master_wallet.household_id → household.principal_user_id === actor.userId`.

- [ ] **Step 1: Owner-check helper + initial routes**

```ts
// apps/backend/src/routes/sub-wallets.ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { balanceService } from '../modules/wallet/balance.service';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

type DbType = typeof db;

/** Authorize that the actor (principal) owns the household that contains the sub-wallet. */
async function ownerCheck(
  database: DbType,
  subWalletId: string,
  actorUserId: string,
): Promise<{ ok: true; subWalletId: string } | { ok: false; status: 403 | 404; code: string }> {
  const sw = await subWalletsRepo.findById(database, subWalletId);
  if (!sw) return { ok: false, status: 404, code: 'sub_wallet_not_found' };
  const mw = await masterWalletsRepo.findById(database, sw.masterWalletId);
  if (!mw) return { ok: false, status: 404, code: 'master_wallet_not_found' };
  const hh = await householdsRepo.findById(database, mw.householdId);
  if (!hh) return { ok: false, status: 404, code: 'household_not_found' };
  if (hh.principalUserId !== actorUserId) return { ok: false, status: 403, code: 'not_your_sub_wallet' };
  return { ok: true, subWalletId };
}

export const subWalletsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/:id', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const sw = await subWalletsRepo.findById(db, c.req.param('id'));
    return c.json({ subWallet: sw }, 200);
  })
  .patch('/:id', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const body = await c.req.json<{ status: 'active' | 'suspended' | 'closed' }>();
    if (!['active', 'suspended', 'closed'].includes(body.status)) {
      return c.json({ error: 'invalid_status' }, 400);
    }
    await subWalletsRepo.setStatus(db, c.req.param('id'), body.status);
    const sw = await subWalletsRepo.findById(db, c.req.param('id'));
    return c.json({ subWallet: sw }, 200);
  })
  .get('/:id/balance', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const balance = await balanceService.accountBalanceForSubWallet(db, c.req.param('id'));
    // Serialise BigInt as a string to keep JSON safe.
    return c.json({ balanceKobo: balance.toString() }, 200);
  });
```

- [ ] **Step 2: Mount in `server.ts`**

```ts
import { subWalletsRoute } from './routes/sub-wallets';
// ...
app.route('/sub-wallets', subWalletsRoute);
```

- [ ] **Step 3: Initial tests**

```ts
// apps/backend/tests/routes/sub-wallets.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { householdMembersRepo } from '../../src/modules/identity/household-members.repo';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { ledgerService } from '../../src/modules/wallet/ledger.service';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedHouseholdWithSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(),
    kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '0123456789',
    anchorBankCode: '058', anchorAccountId: 'a-1',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  await householdMembersRepo.add(testDb, hh.id, agent.id);
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return { principal, agent, hh, mw, sw };
}

describe('GET /sub-wallets/:id', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns sub-wallet for owner principal', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWallet: { name: string } };
    expect(body.subWallet.name).toBe('Driver');
  });

  it('403 not_your_sub_wallet for a different principal', async () => {
    const { sw } = await seedHouseholdWithSubWallet();
    const otherPrincipal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const headers = await bearerHeaders(otherPrincipal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, { headers });
    expect(res.status).toBe(403);
  });

  it('404 sub_wallet_not_found for unknown id', async () => {
    const { principal } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request('/sub-wallets/00000000-0000-0000-0000-000000000000', { headers });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /sub-wallets/:id', () => {
  beforeEach(async () => { await truncateAll(); });

  it('suspends a sub-wallet', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWallet: { status: string } };
    expect(body.subWallet.status).toBe('suspended');
  });

  it('400 invalid_status', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'whatever' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /sub-wallets/:id/balance', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns balanceKobo as a string', async () => {
    const { principal, sw, mw } = await seedHouseholdWithSubWallet();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(75_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await ledgerService.writeDoubleEntry(testDb, txn.id, [
      { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(75_000n), creditKobo: kobo(0n) },
      { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(75_000n) },
    ]);
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/balance`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balanceKobo: '75000' });
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/sub-wallets.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/sub-wallets.ts apps/backend/src/server.ts apps/backend/tests/routes/sub-wallets.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): GET/PATCH /sub-wallets/:id + GET /sub-wallets/:id/balance"
```

---

### Task 7 — Sub-wallet rules routes (extend `sub-wallets.ts`)

**Files:**
- Modify: `apps/backend/src/routes/sub-wallets.ts`
- Modify: `apps/backend/tests/routes/sub-wallets.test.ts`

- [ ] **Step 1: Add `/rules` GET + POST to the route**

In `apps/backend/src/routes/sub-wallets.ts`, append to the `subWalletsRoute` chain:

```ts
.get('/:id/rules', async (c) => {
  const a = c.get('actor');
  if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
  const check = await ownerCheck(db, c.req.param('id'), a.userId);
  if (!check.ok) return c.json({ error: check.code }, check.status);
  const active = await ruleSetService.getActiveWithRules(db, c.req.param('id'));
  return c.json({ activeRuleSet: active }, 200);
})
.post('/:id/rules', async (c) => {
  const a = c.get('actor');
  if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
  const check = await ownerCheck(db, c.req.param('id'), a.userId);
  if (!check.ok) return c.json({ error: check.code }, check.status);
  const body = await c.req.json<{
    rules: Array<{
      kind: 'limit' | 'category' | 'window' | 'allowlist';
      priority: number;
      config: unknown;
    }>;
  }>();
  if (!Array.isArray(body.rules)) return c.json({ error: 'rules_required' }, 400);
  const result = await ruleSetService.publishNewVersion(db, {
    subWalletId: c.req.param('id'),
    createdByUserId: a.userId,
    rules: body.rules,
  });
  return c.json({
    ruleSet: result.ruleSet,
    rules: result.rules,
  }, 201);
});
```

Add the import at the top of the file:

```ts
import { ruleSetService } from '../modules/rules/rule-set.service';
```

- [ ] **Step 2: Tests** — append to `apps/backend/tests/routes/sub-wallets.test.ts`:

```ts
describe('GET /sub-wallets/:id/rules', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns null activeRuleSet when none published', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/rules`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeRuleSet: null });
  });
});

describe('POST /sub-wallets/:id/rules', () => {
  beforeEach(async () => { await truncateAll(); });

  it('publishes a new rule set version', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/rules`, {
      method: 'POST', headers,
      body: JSON.stringify({
        rules: [
          {
            kind: 'limit',
            priority: 10,
            config: { windowKind: 'daily', maxKobo: '100000' },
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { ruleSet: { version: number }; rules: Array<{ kind: string }> };
    expect(body.ruleSet.version).toBe(1);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].kind).toBe('limit');

    // GET should now return the published set.
    const get = await app.request(`/sub-wallets/${sw.sub.id}/rules`, { headers });
    const getBody = await get.json() as { activeRuleSet: { version: number; rules: Array<unknown> } };
    expect(getBody.activeRuleSet.version).toBe(1);
    expect(getBody.activeRuleSet.rules).toHaveLength(1);
  });

  it('a second publish increments the version', async () => {
    const { principal, sw } = await seedHouseholdWithSubWallet();
    const headers = await bearerHeaders(principal);
    const app = createServer();
    await app.request(`/sub-wallets/${sw.sub.id}/rules`, {
      method: 'POST', headers,
      body: JSON.stringify({
        rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '100000' } }],
      }),
    });
    const r2 = await app.request(`/sub-wallets/${sw.sub.id}/rules`, {
      method: 'POST', headers,
      body: JSON.stringify({
        rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '50000' } }],
      }),
    });
    expect(r2.status).toBe(201);
    const body = await r2.json() as { ruleSet: { version: number } };
    expect(body.ruleSet.version).toBe(2);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/sub-wallets.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/sub-wallets.ts apps/backend/tests/routes/sub-wallets.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): GET/POST /sub-wallets/:id/rules (versioned publish)"
```

---

### Task 8 — README + smoke-check the new routes

**Files:**
- Modify: `apps/backend/README.md`

- [ ] **Step 1: Update Public HTTP routes section** in `apps/backend/README.md`:

Append to the route list (insert after the existing `POST /pairing` line):

```markdown
- `POST /households` — body: `{name}` → `{household, masterWallet}` (creates household + provisions placeholder Anchor virtual account; principal-only)
- `GET  /me/household` — returns the principal's household + master wallet
- `GET  /me/household/members` — returns paired agents
- `GET  /households/:id/sub-wallets` — list sub-wallets in a household (principal-only, owner-checked)
- `POST /households/:id/sub-wallets` — body: `{agentUserId, name}` (agent must already be paired)
- `GET  /sub-wallets/:id` — sub-wallet detail
- `PATCH /sub-wallets/:id` — body: `{status: 'active' | 'suspended' | 'closed'}`
- `GET  /sub-wallets/:id/balance` — `{balanceKobo: string}`
- `GET  /sub-wallets/:id/rules` — `{activeRuleSet}` (or `null`)
- `POST /sub-wallets/:id/rules` — body: `{rules: [...]}` → publishes a new rule set version
```

Also update the "Modules" section — add a one-liner under `modules/wallet`:

```markdown
- `modules/wallet` — master + sub wallets, ledger accounts, transactions, postings, double-entry write helper, **balance.service** (sub-wallet balance read).
```

- [ ] **Step 2: Smoke**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test tests/routes/households.test.ts tests/routes/sub-wallets.test.ts
```

All tests must pass.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/README.md
git -C "C:/Users/alex_/amana" commit -m "docs(backend): document /households + /sub-wallets HTTP surface"
```

---

### Task 9 — Phase A backend sweep (typecheck + biome + tests)

**Files:** none.

- [ ] **Step 1: Sweep**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend exec tsc --noEmit -p tsconfig.json
pnpm exec biome check apps/backend/src apps/backend/tests
pnpm --filter @amana/backend test
```

Expected: typecheck green, biome 0 errors (pre-existing warnings in anomaly/lifecycle still allowed), backend tests ≥ 380 passing (365 existing + ~15 new).

- [ ] **Step 2: If biome flags style issues, run --write + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm exec biome check --write apps/backend
git -C "C:/Users/alex_/amana" add -A
git -C "C:/Users/alex_/amana" commit -m "style: biome auto-format (Sub-plan 6b-2 backend phase)"
```

(Skip the commit if no changes.)

- [ ] **Step 3: Stop docker if running** — `docker compose down`. Phase B doesn't need DB.

---

## Phase B — `@amana/api-client` extension (Tasks 10-13)

### Task 10 — Shared household + sub-wallet types

**Files:**
- Create: `packages/types/src/household.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Types**

```ts
// packages/types/src/household.ts
import type { Role } from './auth';

export type Household = {
  id: string;
  name: string;
  principalUserId: string;
};

export type MasterWalletPublic = {
  id: string;
  anchorVirtualAccount: string;
  anchorBankCode: string;
  currency: string;
  status?: 'active' | 'frozen';
};

export type HouseholdMember = {
  userId: string;
  phone: string;
  role: Role;
  kycTier: '1' | '2' | '3';
  status: 'active' | 'suspended';
  joinedAt: string;
};

export type SubWalletStatus = 'active' | 'suspended' | 'closed';

export type SubWallet = {
  id: string;
  masterWalletId: string;
  agentUserId: string;
  name: string;
  status: SubWalletStatus;
  createdAt: string;
};

export type RuleConfigLimit = {
  windowKind: 'daily' | 'weekly' | 'monthly';
  /** Decimal-string serialisation of bigint kobo. */
  maxKobo: string;
};

export type Rule = {
  id?: string;
  kind: 'limit' | 'category' | 'window' | 'allowlist';
  priority: number;
  config: RuleConfigLimit | Record<string, unknown>;
};

export type ActiveRuleSet = {
  ruleSetId: string;
  version: number;
  rules: Array<{
    id: string;
    kind: string;
    priority: number;
    configJson: unknown;
  }>;
};
```

- [ ] **Step 2: Re-export**

`packages/types/src/index.ts`:

```ts
export * from './auth';
export * from './household';
```

- [ ] **Step 3: Build + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
git -C "C:/Users/alex_/amana" add packages/types/src
git -C "C:/Users/alex_/amana" commit -m "feat(types): household + sub-wallet + rule shapes"
```

---

### Task 11 — `HouseholdApi` typed methods

**Files:**
- Create: `packages/api-client/src/household-api.ts`
- Create: `packages/api-client/tests/household-api.test.ts`

This API uses the bearer-aware `request<T>` on the parent client, NOT raw fetch — so it takes the client and reuses the auth + 401-refresh path. Pattern: pass the client into the API constructor.

- [ ] **Step 1: API class**

```ts
// packages/api-client/src/household-api.ts
import type { Household, HouseholdMember, MasterWalletPublic, SubWallet } from '@amana/types';
import type { AmanaApiClient } from './client';

export type CreateHouseholdInput = { name: string };
export type CreateHouseholdResult = {
  household: Household;
  masterWallet: MasterWalletPublic;
};

export type GetMyHouseholdResult = {
  household: Household;
  masterWallet: MasterWalletPublic;
};

export type CreateSubWalletInput = { agentUserId: string; name: string };
export type CreateSubWalletResult = {
  subWallet: SubWallet;
  ledgerAccountId: string;
};

export class HouseholdApi {
  constructor(private readonly client: AmanaApiClient) {}

  createHousehold(input: CreateHouseholdInput): Promise<CreateHouseholdResult> {
    return this.client.request<CreateHouseholdResult>('/households', {
      method: 'POST',
      jsonBody: input,
    });
  }

  getMyHousehold(): Promise<GetMyHouseholdResult> {
    return this.client.request<GetMyHouseholdResult>('/me/household');
  }

  listMembers(): Promise<{ members: HouseholdMember[] }> {
    return this.client.request<{ members: HouseholdMember[] }>('/me/household/members');
  }

  listSubWallets(householdId: string): Promise<{ subWallets: SubWallet[] }> {
    return this.client.request<{ subWallets: SubWallet[] }>(`/households/${householdId}/sub-wallets`);
  }

  createSubWallet(householdId: string, input: CreateSubWalletInput): Promise<CreateSubWalletResult> {
    return this.client.request<CreateSubWalletResult>(`/households/${householdId}/sub-wallets`, {
      method: 'POST',
      jsonBody: input,
    });
  }
}
```

- [ ] **Step 2: Test**

```ts
// packages/api-client/tests/household-api.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmanaApiClient } from '../src/client';
import { HouseholdApi } from '../src/household-api';
import { createInMemoryTokenStore, type TokenStore } from '../src/token-store';
import type { StoredAuth } from '../src/token-store';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const seedAuth = async (store: TokenStore): Promise<StoredAuth> => {
  const auth: StoredAuth = {
    tokens: {
      accessToken: 'A1', refreshToken: 'R1',
      accessExpiresAt: '2026-05-05T00:05:00Z',
      refreshExpiresAt: '2026-06-04T00:00:00Z',
    },
    user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '2' },
  };
  await store.write(auth);
  return auth;
};

describe('HouseholdApi', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let store: TokenStore;
  let client: AmanaApiClient;
  let api: HouseholdApi;

  beforeEach(async () => {
    fetchImpl = vi.fn();
    store = createInMemoryTokenStore();
    await seedAuth(store);
    client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore: store });
    api = new HouseholdApi(client);
  });

  it('createHousehold POSTs to /households with bearer + jsonBody', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({
        household: { id: 'h1', name: 'HH', principalUserId: 'u1' },
        masterWallet: { id: 'mw1', anchorVirtualAccount: '0123456789', anchorBankCode: '058', currency: 'NGN' },
      }, 201),
    );
    const r = await api.createHousehold({ name: 'HH' });
    expect(r.household.id).toBe('h1');
    expect(r.masterWallet.anchorVirtualAccount).toBe('0123456789');
    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toBe('https://api.x/households');
    const init = call[1] as { headers: { authorization: string }; body: string };
    expect(init.headers.authorization).toBe('Bearer A1');
    expect(JSON.parse(init.body)).toEqual({ name: 'HH' });
  });

  it('getMyHousehold GETs /me/household', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({
        household: { id: 'h1', name: 'HH', principalUserId: 'u1' },
        masterWallet: { id: 'mw1', anchorVirtualAccount: '0', anchorBankCode: '058', currency: 'NGN', status: 'active' },
      }),
    );
    const r = await api.getMyHousehold();
    expect(r.household.id).toBe('h1');
  });

  it('listMembers GETs /me/household/members', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({ members: [{ userId: 'u2', phone: '+234802', role: 'agent', kycTier: '1', status: 'active', joinedAt: '2026-05-05T00:00:00Z' }] }),
    );
    const r = await api.listMembers();
    expect(r.members).toHaveLength(1);
    expect(r.members[0].role).toBe('agent');
  });

  it('listSubWallets GETs the nested path', async () => {
    fetchImpl.mockResolvedValueOnce(ok({ subWallets: [] }));
    await api.listSubWallets('h1');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.x/households/h1/sub-wallets');
  });

  it('createSubWallet POSTs the body', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({
        subWallet: { id: 'sw1', masterWalletId: 'mw1', agentUserId: 'u2', name: 'X', status: 'active', createdAt: 'now' },
        ledgerAccountId: 'la1',
      }, 201),
    );
    await api.createSubWallet('h1', { agentUserId: 'u2', name: 'X' });
    const init = fetchImpl.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ agentUserId: 'u2', name: 'X' });
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test tests/household-api.test.ts
git -C "C:/Users/alex_/amana" add packages/api-client/src/household-api.ts packages/api-client/tests/household-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): HouseholdApi (createHousehold/getMyHousehold/listMembers/listSubWallets/createSubWallet)"
```

---

### Task 12 — `SubWalletApi` + `PairingApi` typed methods

**Files:**
- Create: `packages/api-client/src/sub-wallet-api.ts`
- Create: `packages/api-client/src/pairing-api.ts`
- Create: `packages/api-client/tests/sub-wallet-api.test.ts`
- Create: `packages/api-client/tests/pairing-api.test.ts`

- [ ] **Step 1: SubWalletApi**

```ts
// packages/api-client/src/sub-wallet-api.ts
import type { ActiveRuleSet, Rule, SubWallet, SubWalletStatus } from '@amana/types';
import type { AmanaApiClient } from './client';

export type PatchStatusInput = { status: SubWalletStatus };
export type GetBalanceResult = { balanceKobo: string };
export type GetRulesResult = { activeRuleSet: ActiveRuleSet | null };
export type PublishRulesInput = { rules: Array<Omit<Rule, 'id'>> };
export type PublishRulesResult = {
  ruleSet: { id: string; subWalletId: string; version: number; status: string };
  rules: Array<{ id: string; kind: string; priority: number }>;
};

export class SubWalletApi {
  constructor(private readonly client: AmanaApiClient) {}

  get(subWalletId: string): Promise<{ subWallet: SubWallet }> {
    return this.client.request<{ subWallet: SubWallet }>(`/sub-wallets/${subWalletId}`);
  }

  patchStatus(subWalletId: string, input: PatchStatusInput): Promise<{ subWallet: SubWallet }> {
    return this.client.request<{ subWallet: SubWallet }>(`/sub-wallets/${subWalletId}`, {
      method: 'PATCH',
      jsonBody: input,
    });
  }

  getBalance(subWalletId: string): Promise<GetBalanceResult> {
    return this.client.request<GetBalanceResult>(`/sub-wallets/${subWalletId}/balance`);
  }

  getRules(subWalletId: string): Promise<GetRulesResult> {
    return this.client.request<GetRulesResult>(`/sub-wallets/${subWalletId}/rules`);
  }

  publishRules(subWalletId: string, input: PublishRulesInput): Promise<PublishRulesResult> {
    return this.client.request<PublishRulesResult>(`/sub-wallets/${subWalletId}/rules`, {
      method: 'POST',
      jsonBody: input,
    });
  }
}
```

- [ ] **Step 2: PairingApi**

```ts
// packages/api-client/src/pairing-api.ts
import type { AmanaApiClient } from './client';

export type IssuePairingInput = { householdId: string };
export type IssuePairingResult = {
  pairingTokenId: string;
  code: string;
  expiresAt: string;
};

export class PairingApi {
  constructor(private readonly client: AmanaApiClient) {}

  issue(input: IssuePairingInput): Promise<IssuePairingResult> {
    return this.client.request<IssuePairingResult>('/pairing', {
      method: 'POST',
      jsonBody: input,
    });
  }
}
```

- [ ] **Step 3: Tests**

```ts
// packages/api-client/tests/sub-wallet-api.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmanaApiClient } from '../src/client';
import { SubWalletApi } from '../src/sub-wallet-api';
import { createInMemoryTokenStore, type TokenStore } from '../src/token-store';
import type { StoredAuth } from '../src/token-store';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const seedAuth = async (store: TokenStore) => {
  const auth: StoredAuth = {
    tokens: {
      accessToken: 'A1', refreshToken: 'R1',
      accessExpiresAt: '2026-05-05T00:05:00Z',
      refreshExpiresAt: '2026-06-04T00:00:00Z',
    },
    user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '2' },
  };
  await store.write(auth);
};

describe('SubWalletApi', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let api: SubWalletApi;

  beforeEach(async () => {
    fetchImpl = vi.fn();
    const store = createInMemoryTokenStore();
    await seedAuth(store);
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore: store });
    api = new SubWalletApi(client);
  });

  it('get hits /sub-wallets/:id', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({ subWallet: { id: 'sw1', masterWalletId: 'mw1', agentUserId: 'u2', name: 'X', status: 'active', createdAt: 'now' } }),
    );
    const r = await api.get('sw1');
    expect(r.subWallet.id).toBe('sw1');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.x/sub-wallets/sw1');
  });

  it('patchStatus PATCHes with body', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({ subWallet: { id: 'sw1', masterWalletId: 'mw1', agentUserId: 'u2', name: 'X', status: 'suspended', createdAt: 'now' } }),
    );
    const r = await api.patchStatus('sw1', { status: 'suspended' });
    expect(r.subWallet.status).toBe('suspended');
    const init = fetchImpl.mock.calls[0][1] as { method: string; body: string };
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ status: 'suspended' });
  });

  it('getBalance returns balanceKobo string', async () => {
    fetchImpl.mockResolvedValueOnce(ok({ balanceKobo: '12345' }));
    const r = await api.getBalance('sw1');
    expect(r.balanceKobo).toBe('12345');
  });

  it('getRules returns activeRuleSet (or null)', async () => {
    fetchImpl.mockResolvedValueOnce(ok({ activeRuleSet: null }));
    const r = await api.getRules('sw1');
    expect(r.activeRuleSet).toBeNull();
  });

  it('publishRules POSTs the rules array', async () => {
    fetchImpl.mockResolvedValueOnce(
      ok({
        ruleSet: { id: 'rs1', subWalletId: 'sw1', version: 1, status: 'active' },
        rules: [{ id: 'r1', kind: 'limit', priority: 10 }],
      }, 201),
    );
    const r = await api.publishRules('sw1', {
      rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '100000' } }],
    });
    expect(r.ruleSet.version).toBe(1);
  });
});
```

```ts
// packages/api-client/tests/pairing-api.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmanaApiClient } from '../src/client';
import { PairingApi } from '../src/pairing-api';
import { createInMemoryTokenStore, type TokenStore } from '../src/token-store';
import type { StoredAuth } from '../src/token-store';

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const seedAuth = async (store: TokenStore) => {
  await store.write({
    tokens: {
      accessToken: 'A1', refreshToken: 'R1',
      accessExpiresAt: '2026-05-05T00:05:00Z',
      refreshExpiresAt: '2026-06-04T00:00:00Z',
    },
    user: { id: 'u1', role: 'principal', phone: '+234801', kycTier: '2' },
  });
};

describe('PairingApi.issue', () => {
  it('POSTs to /pairing with householdId', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      ok({ pairingTokenId: 'pt1', code: 'ABC123', expiresAt: '2026-05-06T00:00:00Z' }, 201),
    );
    const store = createInMemoryTokenStore();
    await seedAuth(store);
    const client = new AmanaApiClient({ baseUrl: 'https://api.x', fetchImpl, tokenStore: store });
    const api = new PairingApi(client);
    const r = await api.issue({ householdId: 'h1' });
    expect(r.code).toBe('ABC123');
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test
git -C "C:/Users/alex_/amana" add packages/api-client/src/sub-wallet-api.ts packages/api-client/src/pairing-api.ts packages/api-client/tests/sub-wallet-api.test.ts packages/api-client/tests/pairing-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): SubWalletApi + PairingApi (typed wrappers using client.request)"
```

---

### Task 13 — Wire HouseholdApi/SubWalletApi/PairingApi onto `AmanaApiClient`

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Add accessors to the client**

In `packages/api-client/src/client.ts`, add imports at the top:

```ts
import { HouseholdApi } from './household-api';
import { PairingApi } from './pairing-api';
import { SubWalletApi } from './sub-wallet-api';
```

Inside the `AmanaApiClient` class, declare the new public fields:

```ts
public readonly household: HouseholdApi;
public readonly subWallet: SubWalletApi;
public readonly pairing: PairingApi;
```

In the constructor, after `this.auth = new AuthApi(...)`:

```ts
this.household = new HouseholdApi(this);
this.subWallet = new SubWalletApi(this);
this.pairing = new PairingApi(this);
```

- [ ] **Step 2: Re-export**

In `packages/api-client/src/index.ts`, add the exports:

```ts
export { HouseholdApi } from './household-api';
export type {
  CreateHouseholdInput,
  CreateHouseholdResult,
  GetMyHouseholdResult,
  CreateSubWalletInput,
  CreateSubWalletResult,
} from './household-api';
export { SubWalletApi } from './sub-wallet-api';
export type {
  PatchStatusInput,
  GetBalanceResult,
  GetRulesResult,
  PublishRulesInput,
  PublishRulesResult,
} from './sub-wallet-api';
export { PairingApi } from './pairing-api';
export type { IssuePairingInput, IssuePairingResult } from './pairing-api';
```

- [ ] **Step 3: Build + run + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client build
pnpm --filter @amana/api-client test
git -C "C:/Users/alex_/amana" add packages/api-client/src/client.ts packages/api-client/src/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): expose .household + .subWallet + .pairing accessors on AmanaApiClient"
```

All previous tests still pass; types now flow.

---

## Phase C — Mobile Zustand stores (Tasks 14-15)

### Task 14 — `household.store`

**Files:**
- Create: `apps/principal/src/state/household.store.ts`

```ts
// apps/principal/src/state/household.store.ts
import { create } from 'zustand';
import type { Household, HouseholdMember, MasterWalletPublic } from '@amana/types';
import { ApiError } from '@amana/api-client';
import { api } from '../lib/api';

export type HouseholdStatus = 'idle' | 'loading' | 'has_household' | 'no_household' | 'error';

export type HouseholdState = {
  status: HouseholdStatus;
  household: Household | null;
  masterWallet: MasterWalletPublic | null;
  members: HouseholdMember[];
  errorCode: string | null;

  bootstrap(): Promise<void>;
  createHousehold(name: string): Promise<void>;
  refreshMembers(): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

export const useHouseholdStore = create<HouseholdState>((set, get) => ({
  status: 'idle',
  household: null,
  masterWallet: null,
  members: [],
  errorCode: null,

  async bootstrap() {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.household.getMyHousehold();
      set({
        status: 'has_household',
        household: r.household,
        masterWallet: r.masterWallet,
      });
      // Best-effort: refresh members in the background.
      void get().refreshMembers();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_household') {
        set({ status: 'no_household', household: null, masterWallet: null, members: [] });
        return;
      }
      set({ status: 'error', errorCode: ERR(e) });
    }
  },

  async createHousehold(name) {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.household.createHousehold({ name });
      set({
        status: 'has_household',
        household: r.household,
        masterWallet: r.masterWallet,
        members: [],
      });
    } catch (e) {
      set({ status: 'error', errorCode: ERR(e) });
      throw e;
    }
  },

  async refreshMembers() {
    try {
      const r = await api.household.listMembers();
      set({ members: r.members });
    } catch (e) {
      // Don't override status on a member-refresh failure.
      set({ errorCode: ERR(e) });
    }
  },
}));
```

Verify + commit:

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client build
pnpm --filter @amana/types build
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/state/household.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): household.store (bootstrap/createHousehold/refreshMembers)"
```

---

### Task 15 — `subwallets.store`

**File:** Create `apps/principal/src/state/subwallets.store.ts`

```ts
// apps/principal/src/state/subwallets.store.ts
import { create } from 'zustand';
import type { ActiveRuleSet, Rule, SubWallet, SubWalletStatus } from '@amana/types';
import { ApiError } from '@amana/api-client';
import { api } from '../lib/api';

export type SubWalletsState = {
  list: SubWallet[];
  byId: Record<string, SubWallet>;
  balanceById: Record<string, string>;
  rulesById: Record<string, ActiveRuleSet | null>;
  errorCode: string | null;
  busy: boolean;

  refreshList(householdId: string): Promise<void>;
  create(householdId: string, agentUserId: string, name: string): Promise<SubWallet>;
  refreshOne(subWalletId: string): Promise<void>;
  refreshBalance(subWalletId: string): Promise<void>;
  refreshRules(subWalletId: string): Promise<void>;
  publishRules(subWalletId: string, rules: Array<Omit<Rule, 'id'>>): Promise<void>;
  setStatus(subWalletId: string, status: SubWalletStatus): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

export const useSubWalletsStore = create<SubWalletsState>((set, get) => ({
  list: [],
  byId: {},
  balanceById: {},
  rulesById: {},
  errorCode: null,
  busy: false,

  async refreshList(householdId) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.listSubWallets(householdId);
      const byId: Record<string, SubWallet> = {};
      for (const s of r.subWallets) byId[s.id] = s;
      set({ list: r.subWallets, byId, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
    }
  },

  async create(householdId, agentUserId, name) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.createSubWallet(householdId, { agentUserId, name });
      const next = [...get().list, r.subWallet];
      set({
        list: next,
        byId: { ...get().byId, [r.subWallet.id]: r.subWallet },
        busy: false,
      });
      return r.subWallet;
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async refreshOne(subWalletId) {
    try {
      const r = await api.subWallet.get(subWalletId);
      set({ byId: { ...get().byId, [subWalletId]: r.subWallet } });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async refreshBalance(subWalletId) {
    try {
      const r = await api.subWallet.getBalance(subWalletId);
      set({ balanceById: { ...get().balanceById, [subWalletId]: r.balanceKobo } });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async refreshRules(subWalletId) {
    try {
      const r = await api.subWallet.getRules(subWalletId);
      set({ rulesById: { ...get().rulesById, [subWalletId]: r.activeRuleSet } });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async publishRules(subWalletId, rules) {
    set({ busy: true, errorCode: null });
    try {
      await api.subWallet.publishRules(subWalletId, { rules });
      await get().refreshRules(subWalletId);
      set({ busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async setStatus(subWalletId, status) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.subWallet.patchStatus(subWalletId, { status });
      set({
        byId: { ...get().byId, [subWalletId]: r.subWallet },
        list: get().list.map((s) => (s.id === subWalletId ? r.subWallet : s)),
        busy: false,
      });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },
}));
```

Verify + commit:

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/state/subwallets.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): subwallets.store (CRUD + balance/rules/status)"
```

---

## Phase D — Mobile screens (Tasks 16-23)

### Task 16 — `HomeDashboardScreen` replaces the placeholder Home

**Files:**
- Replace: `apps/principal/src/screens/HomeScreen.tsx` (delete)
- Create: `apps/principal/src/screens/HomeDashboardScreen.tsx`
- Modify: `apps/principal/src/nav/MainStack.tsx`

The Dashboard shows: master-wallet top-up info, members count + button, sub-wallets count + button, plus a Log-out button. If no household, route to setup.

- [ ] **Step 1: Delete the placeholder Home**

```bash
git -C "C:/Users/alex_/amana" rm apps/principal/src/screens/HomeScreen.tsx
```

- [ ] **Step 2: HomeDashboardScreen**

```tsx
// apps/principal/src/screens/HomeDashboardScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useAuthStore } from '../state/auth.store';
import { useHouseholdStore } from '../state/household.store';

type Props = NativeStackScreenProps<MainStackParamList, 'HomeDashboard'>;

export function HomeDashboardScreen({ navigation }: Props): JSX.Element {
  const status = useHouseholdStore((s) => s.status);
  const household = useHouseholdStore((s) => s.household);
  const masterWallet = useHouseholdStore((s) => s.masterWallet);
  const members = useHouseholdStore((s) => s.members);
  const errorCode = useHouseholdStore((s) => s.errorCode);
  const bootstrap = useHouseholdStore((s) => s.bootstrap);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status === 'no_household') navigation.replace('HouseholdSetup');
  }, [status, navigation]);

  if (status === 'idle' || status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load: {errorCode}</Text>
        <Pressable style={styles.button} onPress={() => void bootstrap()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!household || !masterWallet) {
    // Should redirect via the effect above. Render nothing while it does.
    return <View />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{household.name}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top up your wallet</Text>
        <Text style={styles.muted}>Send via NIP transfer to:</Text>
        <Text style={styles.account}>{masterWallet.anchorVirtualAccount}</Text>
        <Text style={styles.muted}>Bank code: {masterWallet.anchorBankCode}</Text>
      </View>

      <Pressable style={styles.row} onPress={() => navigation.navigate('Members')}>
        <Text style={styles.rowTitle}>Agents</Text>
        <Text style={styles.muted}>{members.length} paired</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('SubWalletsList')}>
        <Text style={styles.rowTitle}>Sub-wallets</Text>
        <Text style={styles.muted}>Manage controlled spend</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('Pairing')}>
        <Text style={styles.rowTitle}>Pair an agent</Text>
        <Text style={styles.muted}>Issue a one-time code</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.danger]}
        onPress={() => {
          void logout();
        }}
      >
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 24, fontWeight: '600' },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f3f3', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '600' },
  account: { fontSize: 22, fontFamily: 'Courier', letterSpacing: 1, fontWeight: '700' },
  muted: { color: '#666' },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  button: {
    marginTop: 24, alignSelf: 'flex-start',
    backgroundColor: '#222', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 999,
  },
  danger: { backgroundColor: '#b00020' },
  buttonText: { color: 'white', fontWeight: '600' },
  err: { color: '#b00020' },
});
```

- [ ] **Step 3: Extend the MainStack**

Replace `apps/principal/src/nav/MainStack.tsx` with the new param list + screens. Each screen will be wired in subsequent tasks; for now, register placeholder components for the not-yet-built screens so typecheck passes.

```tsx
// apps/principal/src/nav/MainStack.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeDashboardScreen } from '../screens/HomeDashboardScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { MembersScreen } from '../screens/MembersScreen';
import { PairingScreen } from '../screens/PairingScreen';
import { CreateSubWalletScreen } from '../screens/CreateSubWalletScreen';
import { SubWalletsListScreen } from '../screens/SubWalletsListScreen';
import { SubWalletDetailScreen } from '../screens/SubWalletDetailScreen';
import { EditRulesScreen } from '../screens/EditRulesScreen';

export type MainStackParamList = {
  HomeDashboard: undefined;
  HouseholdSetup: undefined;
  Pairing: undefined;
  Members: undefined;
  SubWalletsList: undefined;
  CreateSubWallet: undefined;
  SubWalletDetail: { subWalletId: string };
  EditRules: { subWalletId: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="HomeDashboard" component={HomeDashboardScreen} options={{ title: 'Amana' }} />
      <Stack.Screen name="HouseholdSetup" component={HouseholdSetupScreen} options={{ title: 'Set up household' }} />
      <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: 'Pair an agent' }} />
      <Stack.Screen name="Members" component={MembersScreen} options={{ title: 'Agents' }} />
      <Stack.Screen name="SubWalletsList" component={SubWalletsListScreen} options={{ title: 'Sub-wallets' }} />
      <Stack.Screen name="CreateSubWallet" component={CreateSubWalletScreen} options={{ title: 'New sub-wallet' }} />
      <Stack.Screen name="SubWalletDetail" component={SubWalletDetailScreen} options={{ title: 'Sub-wallet' }} />
      <Stack.Screen name="EditRules" component={EditRulesScreen} options={{ title: 'Edit rules' }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 4: Stub all the not-yet-built screens** so the import chain typechecks. Tasks 17-23 each replace one stub with the real screen.

For each of `HouseholdSetupScreen`, `PairingScreen`, `MembersScreen`, `SubWalletsListScreen`, `CreateSubWalletScreen`, `SubWalletDetailScreen`, `EditRulesScreen`, create a file `apps/principal/src/screens/<Name>.tsx` with content:

```tsx
import { Text, View } from 'react-native';

export function <Name>(): JSX.Element {
  return (
    <View>
      <Text>Stub — replaced in a later task</Text>
    </View>
  );
}
```

Replace `<Name>` with the actual export name (e.g. `HouseholdSetupScreen`).

- [ ] **Step 5: Typecheck + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens apps/principal/src/nav/MainStack.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): HomeDashboardScreen + MainStack scaffolding (real screens land in 17-23)"
```

---

### Task 17 — `HouseholdSetupScreen`

**File:** Replace `apps/principal/src/screens/HouseholdSetupScreen.tsx`

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { z } from 'zod';
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';

type Props = NativeStackScreenProps<MainStackParamList, 'HouseholdSetup'>;

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(60, 'Too long'),
});
type FormValues = z.infer<typeof schema>;

export function HouseholdSetupScreen({ navigation }: Props): JSX.Element {
  const createHousehold = useHouseholdStore((s) => s.createHousehold);
  const status = useHouseholdStore((s) => s.status);
  const errorCode = useHouseholdStore((s) => s.errorCode);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createHousehold(values.name);
      navigation.replace('HomeDashboard');
    } catch {
      // errorCode set on store
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Set up your household</Text>
      <Text style={styles.muted}>
        Your household holds your master wallet. You&apos;ll fund it once and issue sub-wallets to your agents.
      </Text>

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>Household name</Text>
            <TextInput
              autoFocus
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="e.g. Adegbola family"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={status === 'loading' || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          (status === 'loading' || formState.isSubmitting) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>{status === 'loading' ? 'Creating…' : 'Create household'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666' },
  label: { fontSize: 12, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: {
    backgroundColor: '#222', paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 999, alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

Typecheck + commit:
```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/HouseholdSetupScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): HouseholdSetupScreen — first-time household creation"
```

---

### Task 18 — `PairingScreen`

**File:** Replace `apps/principal/src/screens/PairingScreen.tsx`

```tsx
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@amana/api-client';
import { api } from '../lib/api';
import { useHouseholdStore } from '../state/household.store';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'issued'; code: string; expiresAt: string }
  | { kind: 'error'; code: string };

export function PairingScreen(): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    if (!household) {
      setState({ kind: 'error', code: 'no_household' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const r = await api.pairing.issue({ householdId: household.id });
      setState({ kind: 'issued', code: r.code, expiresAt: r.expiresAt });
      setCopied(false);
    } catch (e) {
      setState({
        kind: 'error',
        code: e instanceof ApiError ? e.code : 'unknown_error',
      });
    }
  };

  const copy = async () => {
    if (state.kind !== 'issued') return;
    await Clipboard.setStringAsync(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pair an agent</Text>
      <Text style={styles.muted}>
        Issue a one-time code, then send it to your agent (SMS, WhatsApp, in-person).
        They enter it during signup; that links them to your household.
      </Text>

      {state.kind === 'idle' && (
        <Pressable style={styles.button} onPress={() => void issue()}>
          <Text style={styles.buttonText}>Generate code</Text>
        </Pressable>
      )}

      {state.kind === 'loading' && <ActivityIndicator />}

      {state.kind === 'issued' && (
        <View style={styles.card}>
          <Text style={styles.muted}>Share this code with your agent:</Text>
          <Text style={styles.code} selectable>{state.code}</Text>
          <Text style={styles.muted}>Expires {new Date(state.expiresAt).toLocaleString()}</Text>
          <Pressable style={styles.button} onPress={() => void copy()}>
            <Text style={styles.buttonText}>{copied ? 'Copied ✓' : 'Copy'}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => void issue()}>
            <Text style={[styles.buttonText, styles.secondaryText]}>Generate another</Text>
          </Pressable>
        </View>
      )}

      {state.kind === 'error' && (
        <View>
          <Text style={styles.err}>Couldn&apos;t issue code: {state.code}</Text>
          <Pressable style={styles.button} onPress={() => void issue()}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  card: { padding: 16, gap: 12, borderRadius: 12, backgroundColor: '#f3f3f3' },
  code: { fontSize: 28, fontFamily: 'Courier', letterSpacing: 2, fontWeight: '700' },
  button: {
    backgroundColor: '#222', paddingHorizontal: 32, paddingVertical: 12,
    borderRadius: 999, alignSelf: 'flex-start',
  },
  secondary: { backgroundColor: '#eee' },
  buttonText: { color: 'white', fontWeight: '600' },
  secondaryText: { color: '#222' },
});
```

Add `expo-clipboard` dep:

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal exec expo install expo-clipboard
```

Typecheck + commit:

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/PairingScreen.tsx apps/principal/package.json pnpm-lock.yaml
git -C "C:/Users/alex_/amana" commit -m "feat(principal): PairingScreen — issue + copy pairing code"
```

---

### Task 19 — `MembersScreen`

**File:** Replace `apps/principal/src/screens/MembersScreen.tsx`

```tsx
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useHouseholdStore } from '../state/household.store';

export function MembersScreen(): JSX.Element {
  const members = useHouseholdStore((s) => s.members);
  const refresh = useHouseholdStore((s) => s.refreshMembers);
  const status = useHouseholdStore((s) => s.status);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (members.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No agents paired yet.</Text>
        <Text style={styles.muted}>Use &quot;Pair an agent&quot; from the home screen to issue a code.</Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={members}
      keyExtractor={(m) => m.userId}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.phone}>{item.phone}</Text>
          <Text style={styles.muted}>
            {item.role} · KYC tier {item.kycTier} · {item.status}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  list: { padding: 24, gap: 12 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  phone: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
});
```

Typecheck + commit:
```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/MembersScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): MembersScreen — list paired agents"
```

---

### Task 20 — `SubWalletsListScreen`

**File:** Replace `apps/principal/src/screens/SubWalletsListScreen.tsx`

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'SubWalletsList'>;

export function SubWalletsListScreen({ navigation }: Props): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const list = useSubWalletsStore((s) => s.list);
  const busy = useSubWalletsStore((s) => s.busy);
  const refreshList = useSubWalletsStore((s) => s.refreshList);

  useEffect(() => {
    if (household) void refreshList(household.id);
  }, [household, refreshList]);

  if (!household) return <View />;

  return (
    <View style={styles.container}>
      {busy && list.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>No sub-wallets yet.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={list}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('SubWalletDetail', { subWalletId: item.id })}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.muted}>{item.status}</Text>
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => navigation.navigate('CreateSubWallet')}>
        <Text style={styles.fabText}>＋ New sub-wallet</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  list: { padding: 24, gap: 12 },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  name: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
  fab: {
    position: 'absolute', right: 24, bottom: 32,
    backgroundColor: '#222', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 999,
  },
  fabText: { color: 'white', fontWeight: '600' },
});
```

Commit:
```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/SubWalletsListScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): SubWalletsListScreen — list + FAB to create"
```

---

### Task 21 — `CreateSubWalletScreen`

**File:** Replace `apps/principal/src/screens/CreateSubWalletScreen.tsx`

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { z } from 'zod';
import type { MainStackParamList } from '../nav/MainStack';
import { useHouseholdStore } from '../state/household.store';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateSubWallet'>;

const schema = z.object({
  agentUserId: z.string().min(1, 'Pick an agent'),
  name: z.string().trim().min(1, 'Required').max(40, 'Too long'),
});
type FormValues = z.infer<typeof schema>;

export function CreateSubWalletScreen({ navigation }: Props): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const members = useHouseholdStore((s) => s.members);
  const refreshMembers = useHouseholdStore((s) => s.refreshMembers);
  const create = useSubWalletsStore((s) => s.create);
  const busy = useSubWalletsStore((s) => s.busy);
  const errorCode = useSubWalletsStore((s) => s.errorCode);

  useEffect(() => {
    void refreshMembers();
  }, [refreshMembers]);

  const agents = members.filter((m) => m.role === 'agent' && m.status === 'active');

  const { control, handleSubmit, formState, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { agentUserId: '', name: '' },
  });
  const selectedAgentId = watch('agentUserId');

  const onSubmit = handleSubmit(async (values) => {
    if (!household) return;
    try {
      await create(household.id, values.agentUserId, values.name);
      navigation.goBack();
    } catch {
      // errorCode set on store
    }
  });

  if (!household) return <View />;

  if (agents.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No paired agents</Text>
        <Text style={styles.muted}>
          Pair an agent first, then come back to create a sub-wallet for them.
        </Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Pairing')}>
          <Text style={styles.buttonText}>Go to Pairing</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>New sub-wallet</Text>

        <Text style={styles.label}>Pick an agent</Text>
        <Controller
          control={control}
          name="agentUserId"
          render={({ fieldState }) => (
            <View style={styles.agentList}>
              {agents.map((m) => {
                const active = selectedAgentId === m.userId;
                return (
                  <Pressable
                    key={m.userId}
                    onPress={() => setValue('agentUserId', m.userId, { shouldValidate: true })}
                    style={[styles.agentRow, active && styles.agentRowActive]}
                  >
                    <Text style={[styles.agentPhone, active && styles.agentPhoneActive]}>
                      {m.phone}
                    </Text>
                    <Text style={[styles.muted, active && styles.agentMutedActive]}>
                      KYC tier {m.kycTier}
                    </Text>
                  </Pressable>
                );
              })}
              {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
            </View>
          )}
        />

        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <View>
              <Text style={styles.label}>Sub-wallet name</Text>
              <TextInput
                style={styles.input}
                value={field.value}
                onChangeText={field.onChange}
                placeholder="e.g. School fees, Driver, Kitchen"
              />
              {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
            </View>
          )}
        />

        {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

        <Pressable
          accessibilityRole="button"
          disabled={busy || formState.isSubmitting}
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            (busy || formState.isSubmitting) && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>{busy ? 'Creating…' : 'Create sub-wallet'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 22, fontWeight: '600' },
  label: { fontSize: 12, color: '#666' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  agentList: { gap: 8 },
  agentRow: {
    padding: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, gap: 4,
  },
  agentRowActive: { borderColor: '#222', backgroundColor: '#222' },
  agentPhone: { fontSize: 16, fontWeight: '600', color: '#222' },
  agentPhoneActive: { color: 'white' },
  agentMutedActive: { color: '#ccc' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  button: {
    backgroundColor: '#222', paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 999, alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

Commit:
```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/CreateSubWalletScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): CreateSubWalletScreen — pick agent + name → create"
```

---

### Task 22 — `SubWalletDetailScreen`

**File:** Replace `apps/principal/src/screens/SubWalletDetailScreen.tsx`

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'SubWalletDetail'>;

function formatKobo(koboStr: string | undefined): string {
  if (!koboStr) return '—';
  const naira = BigInt(koboStr) / 100n;
  const remainder = BigInt(koboStr) % 100n;
  return `₦${naira}.${String(remainder).padStart(2, '0')}`;
}

export function SubWalletDetailScreen({ navigation, route }: Props): JSX.Element {
  const { subWalletId } = route.params;
  const sw = useSubWalletsStore((s) => s.byId[subWalletId]);
  const balance = useSubWalletsStore((s) => s.balanceById[subWalletId]);
  const rules = useSubWalletsStore((s) => s.rulesById[subWalletId]);
  const busy = useSubWalletsStore((s) => s.busy);
  const refreshOne = useSubWalletsStore((s) => s.refreshOne);
  const refreshBalance = useSubWalletsStore((s) => s.refreshBalance);
  const refreshRules = useSubWalletsStore((s) => s.refreshRules);
  const setStatus = useSubWalletsStore((s) => s.setStatus);

  useEffect(() => {
    void refreshOne(subWalletId);
    void refreshBalance(subWalletId);
    void refreshRules(subWalletId);
  }, [subWalletId, refreshOne, refreshBalance, refreshRules]);

  if (!sw) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{sw.name}</Text>
      <Text style={styles.muted}>Status: {sw.status}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Balance</Text>
        <Text style={styles.balance}>{formatKobo(balance)}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowSpread}>
          <Text style={styles.label}>Active rules</Text>
          <Pressable onPress={() => navigation.navigate('EditRules', { subWalletId })}>
            <Text style={styles.link}>Edit</Text>
          </Pressable>
        </View>
        {rules === null && <Text style={styles.muted}>No rules published yet — agent can spend without limit until you set one.</Text>}
        {rules && rules.rules.length === 0 && <Text style={styles.muted}>(empty rule set)</Text>}
        {rules && rules.rules.map((r) => (
          <View key={r.id} style={styles.ruleRow}>
            <Text style={styles.ruleKind}>{r.kind} (priority {r.priority})</Text>
            <Text style={styles.muted}>{JSON.stringify(r.configJson)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        {sw.status !== 'suspended' && (
          <Pressable
            disabled={busy}
            style={({ pressed }) => [styles.button, styles.warning, pressed && styles.pressed, busy && styles.disabled]}
            onPress={() => void setStatus(subWalletId, 'suspended')}
          >
            <Text style={styles.buttonText}>Suspend</Text>
          </Pressable>
        )}
        {sw.status === 'suspended' && (
          <Pressable
            disabled={busy}
            style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}
            onPress={() => void setStatus(subWalletId, 'active')}
          >
            <Text style={styles.buttonText}>Resume</Text>
          </Pressable>
        )}
        {sw.status !== 'closed' && (
          <Pressable
            disabled={busy}
            style={({ pressed }) => [styles.button, styles.danger, pressed && styles.pressed, busy && styles.disabled]}
            onPress={() => void setStatus(subWalletId, 'closed')}
          >
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666' },
  label: { fontSize: 12, color: '#666' },
  link: { color: '#1c5fff', fontWeight: '600' },
  card: { padding: 16, gap: 8, borderRadius: 12, backgroundColor: '#f3f3f3' },
  balance: { fontSize: 32, fontWeight: '700' },
  rowSpread: { flexDirection: 'row', justifyContent: 'space-between' },
  ruleRow: { gap: 4, paddingVertical: 6 },
  ruleKind: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 16 },
  button: { backgroundColor: '#222', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  warning: { backgroundColor: '#a8590f' },
  danger: { backgroundColor: '#b00020' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

Commit:
```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/SubWalletDetailScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): SubWalletDetailScreen — balance + rules + suspend/resume/close"
```

---

### Task 23 — `EditRulesScreen` (limit-rule MVP)

**File:** Replace `apps/principal/src/screens/EditRulesScreen.tsx`

For MVP, we only support a single daily-limit rule. Categories/windows/allowlists land in a future slice.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { z } from 'zod';
import type { MainStackParamList } from '../nav/MainStack';
import { useSubWalletsStore } from '../state/subwallets.store';

type Props = NativeStackScreenProps<MainStackParamList, 'EditRules'>;

const schema = z.object({
  dailyLimitNaira: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'e.g. 50000 or 50000.00'),
});
type FormValues = z.infer<typeof schema>;

const nairaToKobo = (naira: string): string => {
  const [whole = '0', frac = ''] = naira.split('.');
  const fracPad = (frac + '00').slice(0, 2);
  return BigInt(whole) * 100n + BigInt(fracPad || '0') + '';
};

export function EditRulesScreen({ navigation, route }: Props): JSX.Element {
  const { subWalletId } = route.params;
  const rules = useSubWalletsStore((s) => s.rulesById[subWalletId]);
  const busy = useSubWalletsStore((s) => s.busy);
  const errorCode = useSubWalletsStore((s) => s.errorCode);
  const refreshRules = useSubWalletsStore((s) => s.refreshRules);
  const publishRules = useSubWalletsStore((s) => s.publishRules);

  useEffect(() => {
    void refreshRules(subWalletId);
  }, [subWalletId, refreshRules]);

  const currentDailyLimit = (() => {
    if (!rules) return '';
    const limit = rules.rules.find((r) => r.kind === 'limit');
    if (!limit) return '';
    const config = limit.configJson as { windowKind?: string; maxKobo?: string | number };
    if (config.windowKind !== 'daily' || !config.maxKobo) return '';
    const koboStr = String(config.maxKobo);
    const naira = BigInt(koboStr) / 100n;
    return naira.toString();
  })();

  const { control, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { dailyLimitNaira: '' },
  });

  useEffect(() => {
    reset({ dailyLimitNaira: currentDailyLimit });
  }, [currentDailyLimit, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await publishRules(subWalletId, [
        {
          kind: 'limit',
          priority: 10,
          config: {
            windowKind: 'daily',
            maxKobo: nairaToKobo(values.dailyLimitNaira),
          },
        },
      ]);
      navigation.goBack();
    } catch {
      // errorCode set on store
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Daily limit</Text>
      <Text style={styles.muted}>
        Spend above this in 24 hours triggers a bump request to you. Categories + time windows land in a future update.
      </Text>

      <Controller
        control={control}
        name="dailyLimitNaira"
        render={({ field, fieldState }) => (
          <View>
            <Text style={styles.label}>Amount (₦)</Text>
            <TextInput
              autoFocus
              keyboardType="numeric"
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="50000"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />

      {errorCode && <Text style={styles.err}>Server: {errorCode}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={busy || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Publish rules'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  label: { fontSize: 12, color: '#666' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  button: {
    backgroundColor: '#222', paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 999, alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

Commit:
```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/EditRulesScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): EditRulesScreen — daily-limit MVP"
```

---

## Phase E — README + sweep + tag (Tasks 24-26)

### Task 24 — Update principal README

**File:** Modify `apps/principal/README.md`

Add a "What it does (Sub-plan 6b-2)" section above the existing 6b-1 content (or replace the 6b-1 section with the merged surface):

```markdown
## What it does (Sub-plan 6b-2)

Builds on 6b-1 (auth flow). Adds:

- First-time setup of a household + master wallet (placeholder Anchor virtual account; real Anchor wiring lands in Sub-plan 7).
- Pair an agent: issue a one-time pairing code, copy it, share via SMS/WhatsApp out-of-band.
- Members list: see paired agents.
- Sub-wallet CRUD: create (must pick from paired agents), view balance + active rules, suspend/resume/close.
- Edit rules: publish a daily NGN spend limit (more rule kinds in a later slice).

Navigation:
- `HomeDashboard` → `HouseholdSetup` (if no household yet)
- `HomeDashboard` → `Members`, `SubWalletsList`, `Pairing`
- `SubWalletsList` → `CreateSubWallet`, `SubWalletDetail`
- `SubWalletDetail` → `EditRules`
```

Commit:
```bash
git -C "C:/Users/alex_/amana" add apps/principal/README.md
git -C "C:/Users/alex_/amana" commit -m "docs(principal): document 6b-2 surface (household + sub-wallet management)"
```

---

### Task 25 — Full sweep

**Files:** none.

- [ ] **Step 1: Clean DB rebuild + full sweep**

```bash
cd "C:/Users/alex_/amana"
docker compose down -v
docker compose up -d
# Wait for Postgres ready then:
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
pnpm build
pnpm exec biome check .
pnpm typecheck
pnpm --filter @amana/api-client test
pnpm --filter @amana/backend test
docker compose down
```

Expected:
- Build: 6/6 successful
- Biome: 0 errors (warnings allowed)
- Typecheck: 9/9 clean
- api-client tests: ≥30 passing (17 from 6b-1 + 14 new from 6b-2)
- backend tests: ≥380 passing (365 from 6a + ~15 new from 6b-2)

- [ ] **Step 2: If biome flags style issues, run --write + commit**

```bash
cd "C:/Users/alex_/amana"
pnpm exec biome check --write .
git -C "C:/Users/alex_/amana" add -A
git -C "C:/Users/alex_/amana" commit -m "style: biome auto-format (Sub-plan 6b-2 sweep)"
```

(Skip if no changes.)

---

### Task 26 — Push + tag v0.0.6b2-principal-management

- [ ] **Step 1: Push + tag**

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.6b2-principal-management -m "Sub-plan 6b-2 complete: Principal — household + sub-wallet management UI"
git -C "C:/Users/alex_/amana" push origin v0.0.6b2-principal-management
```

- [ ] **Step 2: Verify CI green** at https://github.com/Alexander77063/amana/actions.

---

## Plan complete

When all 26 tasks land green:

- A principal can install the app, sign up (6b-1), set up a household, see their master-wallet top-up info, pair agents (issue + copy codes), agents who join via the OTP-verify pairing flow show up in Members, principal can create sub-wallets bound to paired agents, set per-sub-wallet daily limits, and suspend/resume/close them — all end-to-end.
- Backend has 7 new HTTP routes (households + sub-wallets) plus a `balanceService` and a placeholder Anchor account generator, all tested.
- `@amana/api-client` now exposes typed `client.household`, `client.subWallet`, `client.pairing` accessors.
- `@amana/principal` has 8 new screens, 2 new Zustand stores, navigation rewired.

## Out-of-scope for this slice (handled later)

- QR code rendering for the pairing screen + native share-sheet integration (6b-3 polish).
- Bumps inbox + notifications inbox + push token registration (Sub-plan 6b-3).
- Real Anchor virtual-account provisioning (Sub-plan 7) — placeholder generator boots cleanly today; the `placeholder-anchor` module will be deleted when real provisioning ships.
- KYC tier-2 upgrade flow (Sub-plan 7) — new principals stay at tier 1 until upgraded.
- Category / time-window / allowlist rule editors — current `EditRulesScreen` covers daily-limit only.
- Optimistic updates on sub-wallet status changes — current implementation is server-confirmed.
- Pull-to-refresh on lists — manual button + auto-refresh-on-mount only.
- Mobile screen-level tests (jest + RN Testing Library) — typecheck-only continues. Logic layer (api-client, stores) covered by vitest.
