# Full-Stack Layered Refactor — Design Spec

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** `apps/backend`, `apps/principal`, `apps/agent`, `packages/api-client`  
**Constraint:** No functionality changes. No new dependencies beyond what is already in the project. No database schema changes. No route path changes.

---

## 1. Problem Statement

The amana monorepo has a sound overall architecture — Hono backend, Drizzle ORM, Zustand stores, a shared typed API client — but has accumulated targeted debt in four areas:

1. **Backend:** SQL escapes the repository layer; route handlers do direct DB calls; request bodies are not validated with Zod; `lifecycleService.evaluate()` is not wrapped in a transaction; a repeated query is duplicated across two services; a sweep job does N individual UPDATEs; a fire-and-forget silently swallows errors.
2. **Principal app:** A shared error-serializer utility is copy-pasted into all 7 stores; the auth store is tightly coupled to the push store; `/me` is fetched via the untyped `api.request()` path; sub-wallet state is stored in two parallel structures (`list` + `byId`) that require a custom monotonic counter to prevent drift; the home dashboard screen chains three `useEffect` hooks in an implicit waterfall.
3. **Agent app:** A module-level mutable singleton (`let _sw`) is used for sub-wallet selection state instead of React/Zustand state, meaning it won't trigger re-renders.
4. **API client:** All responses are cast with `as T` and never validated at runtime, so a backend schema drift is invisible until production.

---

## 2. Goals

- Raise code quality, scalability, and maintainability across all layers.
- Every change is provably non-functional: the external API surface, database schema, and UI behaviour are identical before and after.
- Leave the codebase in a state where a new engineer can understand each layer independently.

---

## 3. Non-Goals

- API versioning (`/v1/` prefix) — separate concern, tracked separately.
- End-to-end tRPC/generated contract layer — future work.
- New features or UI changes.
- New npm dependencies (Zod and Zustand are already present).

---

## 4. Architecture After Refactor

```
apps/backend/src/
  routes/           ← HTTP only: parse validated body, call service, return JSON
  modules/
    */
      *.service.ts  ← Business logic only. No raw sql``. Calls repos.
      *.repo.ts     ← All DB access. All sql`` strings. One query per method.
  middleware/       ← jwt-auth, request-id, error-handler (unchanged)
  lib/
    validate.ts     ← NEW: thin Zod parse helper used by all routes

apps/principal/src/
  lib/
    store-utils.ts  ← NEW: shared ERR helper (replaces 7 copies)
    logout.ts       ← NEW: logout coordinator (decouples auth ↔ push store)
  state/
    subwallets.store.ts  ← byId-only normalized state; list is derived

apps/agent/src/
  state/
    agent.store.ts  ← NEW: Zustand store replaces sub-wallet-memory.ts singleton

packages/api-client/src/
  client.ts         ← request<T>() gains optional schema?: ZodType<T>
```

---

## 5. Layer-by-Layer Design

### 5.1 Backend

#### 5.1.1 Request Validation Helper

A thin wrapper around Zod. Lives at `src/lib/validate.ts`.

```ts
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

Caller pattern in every route:
```ts
const body = await parseBody(c, MySchema);
if (body instanceof Response) return body;
// body is now fully typed as MySchema's output
```

Every route that currently does `const body = await c.req.json<Body>()` is updated to use `parseBody()` with an explicit Zod schema. The schema lives at the top of the route file (or promoted to `@amana/validation` if shared with clients).

Affected routes: `auth.ts`, `transactions.ts`, `sub-wallets.ts`, `households.ts`, `webhooks.ts`, `pairing.ts`, `devices.ts`, `media.ts`, `notification-prefs.ts`.

#### 5.1.2 SQL Strictly in Repos

**`spentInWindow()` → `postings.repo.ts`**

Move the raw SQL spending-window query out of `lifecycle.service.ts` into `postingsRepo.sumDebitsInWindow(db, subWalletId, windowSeconds, now)`. The service calls the repo method.

**`resolvePrincipalAndAgent()` → `sub-wallets.repo.ts`**

The "find principal_user_id by sub_wallet_id" query appears identically in:
- `lifecycle.service.ts` (inline anonymous SQL)
- `bump-workflow.service.ts` (inside `resolvePrincipalAndAgent()`)

Extract to `subWalletsRepo.findPrincipalAndAgent(db, subWalletId)`. Both services call this single method.

**`routes/transactions.ts` route-level DB calls**

Three direct DB operations in the route handler are extracted:
- `db.select().from(transactions).where(eq(transactions.id, id))` → `transactionsRepo.findById()` (already exists; just use it)
- `db.update(transactions).set({ attachedMedia })` → `transactionsRepo.attachMedia(db, id, key)`
- Raw `sql\`UPDATE bump_requests SET status='cancelled'...\`` + `db.update(transactions)` → `bumpWorkflowService.cancelByAgent(db, { transactionId, agentUserId })`

#### 5.1.3 Transaction Safety in `lifecycleService.evaluate()`

Wrap the evaluate path in a single `db.transaction()`. Sequence inside the transaction:
1. Assert `txn.status === 'draft'`
2. Set status → `rule_eval`
3. Load ledger data, run anomaly score
4. Write anomaly score to `transactions`
5. Write `anomalyScored` audit event
6. Evaluate rule set → decision
7. Write `txnRuleEval` audit event
8. Set status → `in_flight` (allow) or create bump request (bump_pending)

The best-effort anomaly alert notification dispatch stays outside the transaction (it's intentionally fire-and-forget).

#### 5.1.4 `server.ts` Mount Clarity

All routes currently mounted at `/` are grouped into a single `meRouter`:

```ts
// Before: 7 separate app.route('/', ...)
// After:
const meRouter = new Hono()
  .route('/', meRoute)
  .route('/', logoutRoute)
  .route('/', meHouseholdRoute)
  .route('/', meBumpsRoute)
  .route('/', meSubWalletRoute)
  .route('/', notificationPrefsRoute)
  .route('/', notificationsListRoute);

app.route('/', meRouter);
```

The external route paths are unchanged. The benefit is that `server.ts` becomes a single-glance API map.

#### 5.1.5 Batch `sweepExpired()`

Replace:
```ts
for (const row of expired) {
  await bumpRequestsRepo.setDecision(txDb, row.id, next.value, row.requestedByUserId, now);
}
```

With a new repo method `bumpRequestsRepo.bulkExpire(db, ids, now)` that issues a single `UPDATE bump_requests SET status='expired', decided_at=$now WHERE id = ANY($ids)`.

#### 5.1.6 Fire-and-Forget Error Visibility

```ts
// Before
authSessionsRepo.touchLastUsed(db, session.id, new Date()).catch(() => {});

// After
authSessionsRepo.touchLastUsed(db, session.id, new Date())
  .catch((e: unknown) => logger.warn({ err: (e as Error).message }, 'session touch failed'));
```

---

### 5.2 Principal App

#### 5.2.1 Shared Error Serializer

New file: `src/lib/store-utils.ts`

```ts
import { ApiError } from '@amana/api-client';

export const toErrorCode = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';
```

All 7 stores remove their local `const ERR = ...` and import `toErrorCode` from `'../lib/store-utils'`. The function is renamed from `ERR` to `toErrorCode` for clarity.

#### 5.2.2 Logout Coordinator

New file: `src/lib/logout.ts`

```ts
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

`auth.store.ts`:
- Removes the `usePushStore` import
- `logout()` action calls `runLogout(api, secureTokenStore, () => usePushStore.getState().unregister())`
- The push store reference is passed as a callback, not imported as a module dependency

#### 5.2.3 Typed `/me` Call

```ts
// Before (auth.store.ts bootstrap)
const me = await api.request<User>('/me');

// After
const me = await api.me.get();
```

#### 5.2.4 Normalized Sub-Wallet State

`subwallets.store.ts` replaces the dual `list` + `byId` structure:

```ts
// State shape (before)
list: SubWallet[];
byId: Record<string, SubWallet>;
_snoozeSeq: Record<string, number>;

// State shape (after)
byId: Record<string, SubWallet>;       // single source of truth
_snoozeSeq: Record<string, number>;    // kept for optimistic-update ordering
```

A derived selector replaces all `list` reads:

```ts
// Callers that needed `list` use:
const list = useSubWalletsStore((s) => Object.values(s.byId));
```

All mutations in `refreshList`, `create`, `setStatus`, `snooze`, `unsnooze` update only `byId`. The double-update pattern (updating both `list` and `byId`) is removed throughout.

#### 5.2.5 `HomeDashboardScreen` Initialization

Replace the three-`useEffect` waterfall with a single consolidated effect:

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

One effect, one dependency array, one place to reason about the initialization sequence.

---

### 5.3 Agent App

#### 5.3.1 Zustand Store Replaces Singleton

New file: `src/state/agent.store.ts`

```ts
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

`sub-wallet-memory.ts` is deleted. All callers are updated to use `useAgentStore`.

---

### 5.4 API Client

#### 5.4.1 Optional Response Validation

`request<T>()` gains an optional `schema` parameter:

```ts
async request<T>(
  path: string,
  init: RequestInit2 = {},
  schema?: ZodType<T>,
): Promise<T> { ... }
```

After `await res.json()`, if `schema` is provided: `return schema.parse(parsed)`. If not, behavior is identical to today. This is fully backwards-compatible — no existing call site breaks.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `apps/backend/src/lib/validate.ts` | **NEW** — Zod parseBody helper |
| `apps/backend/src/routes/auth.ts` | Add Zod schemas; use parseBody |
| `apps/backend/src/routes/transactions.ts` | Add Zod schemas; remove direct DB calls; use repos/services |
| `apps/backend/src/routes/sub-wallets.ts` | Add Zod schemas |
| `apps/backend/src/routes/households.ts` | Add Zod schemas |
| `apps/backend/src/routes/webhooks.ts` | Add Zod schemas |
| `apps/backend/src/routes/pairing.ts` | Add Zod schemas |
| `apps/backend/src/routes/devices.ts` | Add Zod schemas |
| `apps/backend/src/routes/notification-prefs.ts` | Add Zod schemas |
| `apps/backend/src/routes/media.ts` | Add Zod schemas |
| `apps/backend/src/server.ts` | Group `/` routes into meRouter |
| `apps/backend/src/middleware/jwt-auth.ts` | Log touchLastUsed failures |
| `apps/backend/src/modules/transactions/lifecycle.service.ts` | Wrap evaluate() in db.transaction(); call postingsRepo.sumDebitsInWindow(); call subWalletsRepo.findPrincipalAndAgent() |
| `apps/backend/src/modules/bumps/bump-workflow.service.ts` | Remove resolvePrincipalAndAgent(); call subWalletsRepo.findPrincipalAndAgent(); add cancelByAgent(); bulkExpire() in sweepExpired() |
| `apps/backend/src/modules/wallet/postings.repo.ts` | Add sumDebitsInWindow() |
| `apps/backend/src/modules/wallet/sub-wallets.repo.ts` | Add findPrincipalAndAgent() |
| `apps/backend/src/modules/wallet/transactions.repo.ts` | Add attachMedia() |
| `apps/backend/src/modules/bumps/bump-requests.repo.ts` | Add bulkExpire() |
| `apps/principal/src/lib/store-utils.ts` | **NEW** — toErrorCode helper |
| `apps/principal/src/lib/logout.ts` | **NEW** — runLogout coordinator |
| `apps/principal/src/state/auth.store.ts` | Use toErrorCode; use api.me.get(); call runLogout |
| `apps/principal/src/state/bumps.store.ts` | Use toErrorCode |
| `apps/principal/src/state/preferences.store.ts` | Use toErrorCode |
| `apps/principal/src/state/notifications.store.ts` | Use toErrorCode |
| `apps/principal/src/state/household.store.ts` | Use toErrorCode |
| `apps/principal/src/state/push.store.ts` | Use toErrorCode |
| `apps/principal/src/state/subwallets.store.ts` | Normalize to byId-only; use toErrorCode |
| `apps/principal/src/screens/HomeDashboardScreen.tsx` | Merge 3 useEffects into 1 |
| `apps/agent/src/state/agent.store.ts` | **NEW** — Zustand store |
| `apps/agent/src/lib/sub-wallet-memory.ts` | **DELETED** |
| `apps/agent/src/screens/*.tsx` | Update callers to useAgentStore |
| `packages/api-client/src/client.ts` | Add optional schema param to request<T>() |

---

## 7. Testing Strategy

- All existing tests must continue to pass without modification (or with minimal schema-assertion updates for routes that now return structured Zod validation errors instead of ad-hoc strings).
- New repo methods (`sumDebitsInWindow`, `findPrincipalAndAgent`, `attachMedia`, `bulkExpire`, `cancelByAgent`) each get a unit test.
- The `parseBody` helper gets a unit test: valid body passes, invalid body returns 400 with `validation_error`.
- The `toErrorCode` utility gets a unit test.
- The `runLogout` coordinator gets a unit test with mocked API/store.

---

## 8. Rollout Order

Changes are independent within each layer but layers should be completed in order to avoid broken imports during the refactor:

1. **Backend** (repos → services → routes → server.ts)
2. **Principal app** (lib utilities → stores → screens)
3. **Agent app** (new store → delete singleton → update callers)
4. **API client** (additive only — last, lowest risk)
