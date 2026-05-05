# Sub-plan 6b-3 — Principal Mobile App: inbox + push

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A principal user can pair agents with a scannable QR code or via the native share sheet, see all pending bump requests in a single inbox screen and approve/deny them in one tap, read a chronological notifications feed that deep-links into the bumps inbox, and (after one consented prompt) receive push notifications when an agent requests a bump or when transactions settle/fail.

**Architecture:** Two layers added on top of v0.0.6b2-principal-management. (1) Backend gap-fill — one new HTTP route (`GET /me/bumps`) plus a join-helper on `bumpRequestsRepo`. No DB schema changes; existing `notifications`, `devices`, and `notification-preferences` routes are reused as-is, and `device-tokens.repo.register` already upserts on `expoPushToken`. (2) Mobile — extend `@amana/api-client` with `BumpApi` + `NotificationApi` + `DeviceApi`, add three Zustand stores, modify `PairingScreen` for QR + share, add three new screens (`BumpsInboxScreen`, `NotificationsInboxScreen`, `EnableNotificationsScreen`), and wire `expo-notifications` listeners at the `App.tsx` level for foreground refresh + background-tap deep-linking.

**Tech Stack:** Backend — Hono + Drizzle (existing). Mobile — Expo SDK 51 + React Navigation v7 + Zustand 5 (existing) + new deps `expo-device`, `react-native-qrcode-svg`. `expo-notifications` and `expo-clipboard` are already pulled.

---

## Pre-flight: dist build (do once at the start)

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
```

The mobile app consumes `@amana/types` and `@amana/api-client` as workspace packages. After Phase B/C add new exports, repeat these builds before any subsequent mobile typecheck.

---

## File structure produced by this plan

**Backend (new):**
- `apps/backend/src/routes/me-bumps.ts` — `GET /me/bumps` (mounted at `/`, internal path `/me/bumps`)
- `apps/backend/tests/routes/me-bumps.test.ts`
- `apps/backend/tests/modules/bumps/bump-requests.repo.test.ts`

**Backend (modified):**
- `apps/backend/src/server.ts` — mount `meBumpsRoute`
- `apps/backend/src/modules/bumps/bump-requests.repo.ts` — add `findForPrincipal` join-helper

**Shared types (new in `packages/types/src`):**
- `bump.ts` — `BumpRequest`, `BumpStatus`, `BumpDecision`, `MyBumpsResponse`
- `notification.ts` — `Notification`, `NotificationKind`, `NotificationDeepLink`, `MyNotificationsResponse`
- `device.ts` — `DevicePlatform`, `RegisterDeviceInput`, `RegisterDeviceResult`
- `index.ts` — re-export

**API client (new in `packages/api-client/src`):**
- `bump-api.ts` — `BumpApi.listForMe`, `BumpApi.decide`
- `notification-api.ts` — `NotificationApi.listForMe`, `NotificationApi.markRead`
- `device-api.ts` — `DeviceApi.register`, `DeviceApi.unregister`
- `tests/bump-api.test.ts`, `tests/notification-api.test.ts`, `tests/device-api.test.ts`

**API client (modified):**
- `client.ts` — wire `bump`, `notification`, `device` into `AmanaApiClient`
- `index.ts` — re-export

**Principal mobile (new in `apps/principal/src`):**
- `state/bumps.store.ts`
- `state/notifications.store.ts`
- `state/push.store.ts`
- `lib/push.ts` — Expo notifications setup + listener helpers + deep-link mapper
- `screens/BumpsInboxScreen.tsx`
- `screens/NotificationsInboxScreen.tsx`
- `screens/EnableNotificationsScreen.tsx`

**Principal mobile (modified):**
- `apps/principal/package.json` — add `expo-device`, `react-native-qrcode-svg`
- `apps/principal/app.json` — add `expo-notifications` plugin config
- `apps/principal/App.tsx` — wire push listeners + cold-start tap handler
- `apps/principal/src/nav/MainStack.tsx` — add `BumpsInbox`, `NotificationsInbox`, `EnableNotifications` routes
- `apps/principal/src/screens/PairingScreen.tsx` — add QR rendering + native share
- `apps/principal/src/screens/HomeDashboardScreen.tsx` — add Inbox + Notifications tiles with badges
- `apps/principal/src/state/auth.store.ts` — call `pushStore.unregister()` on logout

---

## Phase A — Backend gap-fill (Tasks 1-3)

### Task 1 — `bumpRequestsRepo.findForPrincipal`

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-requests.repo.ts`
- Create: `apps/backend/tests/modules/bumps/bump-requests.repo.test.ts`

The route needs to fetch bumps where the actor is the household's principal. Walk `bumpRequests → subWallets → masterWallets → households` and filter on `households.principalUserId`. Splits results into `pending` and `history` (decided or expired within the last 30 days).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/modules/bumps/bump-requests.repo.test.ts
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { bumpRequestsRepo } from '../../../src/modules/bumps/bump-requests.repo';
import { bumpWorkflowService } from '../../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

async function seedBumpAt(now: Date) {
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
    anchorAccountId: 'anchor-acct-test',
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
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(50_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  const created = await bumpWorkflowService.create(testDb, {
    transactionId: txn.id,
    subWalletId: sw.sub.id,
    requestedByUserId: agent.id,
    amountKobo: kobo(50_000n),
    vendorResolvedName: 'M',
    now,
  });
  return { principal, agent, bumpId: created.bumpRequest.id };
}

describe('bumpRequestsRepo.findForPrincipal', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns pending bumps for the principal', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.pending.map((b) => b.id)).toContain(bumpId);
    expect(r.history).toHaveLength(0);
  });

  it('moves a decided bump from pending to history', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpId,
      decidedByUserId: principal.id,
      decision: 'deny',
      now,
    });
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history.map((b) => b.id)).toContain(bumpId);
    expect(r.history[0]?.status).toBe('denied');
  });

  it('excludes bumps decided more than 30 days ago from history', async () => {
    const now = new Date();
    const { principal, bumpId } = await seedBumpAt(now);
    await bumpWorkflowService.decide(testDb, {
      bumpRequestId: bumpId,
      decidedByUserId: principal.id,
      decision: 'deny',
      now,
    });
    // The DB sets decidedAt to the wall-clock time of the decide call, which is
    // always "now" — back-date it directly so we can verify the cutoff.
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60_000);
    await testDb.execute(sql`
      UPDATE bump_requests
      SET decided_at = ${fortyDaysAgo}, created_at = ${fortyDaysAgo}
      WHERE id = ${bumpId}
    `);
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principal.id,
      now,
    });
    expect(r.history).toHaveLength(0);
  });

  it('returns empty lists for a principal whose household has no bumps', async () => {
    const lonelyPrincipal = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: lonelyPrincipal.id,
      now: new Date(),
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history).toHaveLength(0);
  });

  it('does not leak bumps from another principal\'s household', async () => {
    const now = new Date();
    await seedBumpAt(now); // principal A
    const principalB = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
    });
    const r = await bumpRequestsRepo.findForPrincipal(testDb, {
      userId: principalB.id,
      now,
    });
    expect(r.pending).toHaveLength(0);
    expect(r.history).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/alex_/amana"
docker compose up -d postgres
pnpm --filter @amana/backend test tests/modules/bumps/bump-requests.repo.test.ts
```

Expected: FAIL with "bumpRequestsRepo.findForPrincipal is not a function".

- [ ] **Step 3: Implement `findForPrincipal`**

Edit `apps/backend/src/modules/bumps/bump-requests.repo.ts`. Add the imports and the new method. Replace the existing `import` line at the top:

```ts
import { and, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { bumpRequests, households, masterWallets, subWallets } from '../../db/schema';
import type { Kobo } from '../../lib/kobo';
```

Add this method to the `bumpRequestsRepo` object (after `listExpired`):

```ts
  /**
   * Returns the bumps the given principal can act on.
   * `pending`: status === 'pending' AND expiresAt > now
   * `history`: status in (approved_once|raise_limit|denied|expired)
   *            AND (decidedAt OR createdAt for expired-without-decision) within the last 30 days
   * Bumps are scoped to households where the user is the principal.
   */
  async findForPrincipal(
    db: DbOrTx,
    input: { userId: string; now: Date },
  ): Promise<{ pending: BumpRequestRow[]; history: BumpRequestRow[] }> {
    const cutoff = new Date(input.now.getTime() - 30 * 24 * 60 * 60_000);
    const rows = await db
      .select({ b: bumpRequests })
      .from(bumpRequests)
      .innerJoin(subWallets, eq(subWallets.id, bumpRequests.subWalletId))
      .innerJoin(masterWallets, eq(masterWallets.id, subWallets.masterWalletId))
      .innerJoin(households, eq(households.id, masterWallets.householdId))
      .where(eq(households.principalUserId, input.userId))
      .orderBy(desc(bumpRequests.createdAt));

    const pending: BumpRequestRow[] = [];
    const history: BumpRequestRow[] = [];
    for (const { b } of rows) {
      if (b.status === 'pending' && b.expiresAt > input.now) {
        pending.push(b);
        continue;
      }
      // history bucket: decided in last 30d, or expired (no decidedAt) created in last 30d
      const ts = b.decidedAt ?? b.createdAt;
      if (ts >= cutoff) history.push(b);
    }
    return { pending, history };
  },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @amana/backend test tests/modules/bumps/bump-requests.repo.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/bump-requests.repo.ts apps/backend/tests/modules/bumps/bump-requests.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): findForPrincipal — scoped pending+history with 30d cutoff"
```

---

### Task 2 — `GET /me/bumps` HTTP route

**Files:**
- Create: `apps/backend/src/routes/me-bumps.ts`
- Create: `apps/backend/tests/routes/me-bumps.test.ts`

Mirrors the `notificationsListRoute` pattern: separate file, mounted at `/`, internal Hono path `/me/bumps`. Principal-only (returns `403 only_principal_can_view` otherwise). Supports `status=pending|history|all` query (default `all`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/routes/me-bumps.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { kobo } from '../../src/lib/kobo';
import { bumpWorkflowService } from '../../src/modules/bumps/bump-workflow.service';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedPendingBump() {
  const now = new Date();
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
    anchorAccountId: 'anchor-acct-test',
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
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(50_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  const created = await bumpWorkflowService.create(testDb, {
    transactionId: txn.id,
    subWalletId: sw.sub.id,
    requestedByUserId: agent.id,
    amountKobo: kobo(50_000n),
    vendorResolvedName: 'M',
    now,
  });
  return { principal, agent, bumpId: created.bumpRequest.id };
}

describe('GET /me/bumps', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns pending + empty history for a principal with one open bump', async () => {
    const { principal, bumpId } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: { id: string; status: string }[];
      history: unknown[];
    };
    expect(body.pending.map((b) => b.id)).toContain(bumpId);
    expect(body.history).toHaveLength(0);
  });

  it('returns 403 when actor is an agent', async () => {
    const { agent } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps', {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(403);
  });

  it('?status=pending returns only pending', async () => {
    const { principal } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps?status=pending', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: unknown[]; history: unknown[] };
    expect(body.pending.length).toBeGreaterThan(0);
    expect(body.history).toHaveLength(0);
  });

  it('?status=history returns only history (empty when nothing decided)', async () => {
    const { principal } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps?status=history', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: unknown[]; history: unknown[] };
    expect(body.pending).toHaveLength(0);
    expect(body.history).toHaveLength(0);
  });

  it('returns 400 for unknown status value', async () => {
    const { principal } = await seedPendingBump();
    const app = createServer();
    const res = await app.request('/me/bumps?status=banana', {
      headers: await bearerHeaders(principal),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @amana/backend test tests/routes/me-bumps.test.ts
```

Expected: FAIL — route 404 (not mounted yet).

- [ ] **Step 3: Implement the route**

The DB rows include `bigint` (amountKobo) and `Date` fields — both are unsafe for `JSON.stringify`. Map to a wire-safe shape (matches the `BumpRequest` shared type from Task 4).

```ts
// apps/backend/src/routes/me-bumps.ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import {
  type BumpRequestRow,
  bumpRequestsRepo,
} from '../modules/bumps/bump-requests.repo';

type StatusFilter = 'pending' | 'history' | 'all';

type SerializedBumpRequest = {
  id: string;
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: string;
  vendorResolvedName: string;
  agentNote: string | null;
  status: BumpRequestRow['status'];
  expiresAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
};

function toWire(b: BumpRequestRow): SerializedBumpRequest {
  return {
    id: b.id,
    transactionId: b.transactionId,
    subWalletId: b.subWalletId,
    requestedByUserId: b.requestedByUserId,
    amountKobo: b.amountKobo.toString(),
    vendorResolvedName: b.vendorResolvedName,
    agentNote: b.agentNote,
    status: b.status,
    expiresAt: b.expiresAt.toISOString(),
    decidedByUserId: b.decidedByUserId,
    decidedAt: b.decidedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

function parseStatus(raw: string | undefined): StatusFilter | null {
  if (raw === undefined || raw === 'all') return 'all';
  if (raw === 'pending' || raw === 'history') return raw;
  return null;
}

export const meBumpsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/bumps', async (c) => {
    const a = c.get('actor') as Actor;
    if (a.role !== 'principal') {
      return c.json({ error: 'only_principal_can_view' }, 403);
    }
    const status = parseStatus(c.req.query('status'));
    if (status === null) {
      return c.json({ error: 'bad_status' }, 400);
    }
    const now = new Date();
    const r = await bumpRequestsRepo.findForPrincipal(db, { userId: a.userId, now });
    return c.json(
      {
        pending: status === 'history' ? [] : r.pending.map(toWire),
        history: status === 'pending' ? [] : r.history.map(toWire),
      },
      200,
    );
  });
```

- [ ] **Step 4: Run test to verify it still fails (route not mounted)**

```bash
pnpm --filter @amana/backend test tests/routes/me-bumps.test.ts
```

Expected: still FAIL — route 404.

- [ ] **Step 5: Mount the route**

Edit `apps/backend/src/server.ts`. After the existing `meHouseholdRoute` import, add:

```ts
import { meBumpsRoute } from './routes/me-bumps';
```

In the route registration block (after `app.route('/', meHouseholdRoute);`, before `app.route('/', meRoute);`):

```ts
  app.route('/', meBumpsRoute);
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @amana/backend test tests/routes/me-bumps.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/me-bumps.ts apps/backend/src/server.ts apps/backend/tests/routes/me-bumps.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): GET /me/bumps — principal-scoped pending+history with status filter"
```

---

### Task 3 — Backend regression check

- [ ] **Step 1: Run full backend test suite**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/backend test
```

Expected: all prior tests still pass; net add of ~10 new tests (5 repo + 5 route) on top of the 6b-2 baseline.

- [ ] **Step 2: If anything regressed, fix before continuing.** Do NOT proceed to Phase B until this is green.

---

## Phase B — Shared types (Task 4)

### Task 4 — Add `bump`, `notification`, `device` types

**Files:**
- Create: `packages/types/src/bump.ts`
- Create: `packages/types/src/notification.ts`
- Create: `packages/types/src/device.ts`
- Modify: `packages/types/src/index.ts`

The `Notification` type's `payload` is `unknown` because the wire shape varies per kind; the deep-link helper on the mobile side maps `payload` + `kind` to a discriminated `NotificationDeepLink`.

- [ ] **Step 1: Write `bump.ts`**

```ts
// packages/types/src/bump.ts
export type BumpStatus =
  | 'pending'
  | 'approved_once'
  | 'raise_limit'
  | 'denied'
  | 'expired';

export type BumpDecision = 'approve_once' | 'approve_raise_limit' | 'deny';

export type BumpRequest = {
  id: string;
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: string; // BigInt-safe over the wire
  vendorResolvedName: string;
  agentNote: string | null;
  status: BumpStatus;
  expiresAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type MyBumpsResponse = {
  pending: BumpRequest[];
  history: BumpRequest[];
};

export type BumpDecideResult = {
  status: BumpStatus;
  oneShotToken: string | null;
};
```

- [ ] **Step 2: Write `notification.ts`**

```ts
// packages/types/src/notification.ts
export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received';

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';

export type Notification = {
  id: string;
  recipientUserId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  dedupeKey: string;
  payloadJson: unknown;
  createdAt: string;
  updatedAt: string;
};

/**
 * Resolved client-side from `notification.payloadJson` + `notification.kind`.
 * `kind: 'none'` means the inbox tap should mark-read only — no navigation.
 */
export type NotificationDeepLink =
  | { kind: 'bump'; bumpRequestId: string }
  | { kind: 'transaction'; transactionId: string }
  | { kind: 'none' };

export type MyNotificationsResponse = {
  notifications: Notification[];
};
```

- [ ] **Step 3: Write `device.ts`**

```ts
// packages/types/src/device.ts
export type DevicePlatform = 'ios' | 'android';

export type RegisterDeviceInput = {
  expoPushToken: string;
  platform: DevicePlatform;
  deviceLabel?: string | null;
};

export type RegisterDeviceResult = {
  id: string;
};
```

- [ ] **Step 4: Re-export from `index.ts`**

Replace the contents of `packages/types/src/index.ts`:

```ts
export * from './auth';
export * from './bump';
export * from './device';
export * from './household';
export * from './notification';
```

- [ ] **Step 5: Build and commit**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
git -C "C:/Users/alex_/amana" add packages/types/src/bump.ts packages/types/src/notification.ts packages/types/src/device.ts packages/types/src/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(types): add Bump, Notification, Device shared types"
```

Expected: build succeeds, no errors.

---

## Phase C — API client (Tasks 5-8)

### Task 5 — `BumpApi`

**Files:**
- Create: `packages/api-client/src/bump-api.ts`
- Create: `packages/api-client/tests/bump-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api-client/tests/bump-api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { BumpApi } from '../src/bump-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('BumpApi.listForMe', () => {
  it('GETs /me/bumps with no query when status not provided', async () => {
    const client = fakeClient(async () => ({ pending: [], history: [] }));
    const api = new BumpApi(client);
    await api.listForMe();
    expect(client.request).toHaveBeenCalledWith('/me/bumps');
  });

  it('GETs /me/bumps?status=pending when status=pending provided', async () => {
    const client = fakeClient(async () => ({ pending: [], history: [] }));
    const api = new BumpApi(client);
    await api.listForMe({ status: 'pending' });
    expect(client.request).toHaveBeenCalledWith('/me/bumps?status=pending');
  });

  it('returns the parsed pending/history shape', async () => {
    const client = fakeClient(async () => ({
      pending: [
        {
          id: 'b1',
          transactionId: 't1',
          subWalletId: 'sw1',
          requestedByUserId: 'u-agent',
          amountKobo: '50000',
          vendorResolvedName: 'MTN',
          agentNote: null,
          status: 'pending',
          expiresAt: '2026-05-06T01:00:00Z',
          decidedByUserId: null,
          decidedAt: null,
          createdAt: '2026-05-06T00:00:00Z',
        },
      ],
      history: [],
    }));
    const api = new BumpApi(client);
    const r = await api.listForMe();
    expect(r.pending[0]?.id).toBe('b1');
    expect(r.history).toHaveLength(0);
  });
});

describe('BumpApi.decide', () => {
  it('POSTs /bumps/:id/decision with decision body', async () => {
    const client = fakeClient(async () => ({ status: 'approved_once', oneShotToken: 'tok-abc' }));
    const api = new BumpApi(client);
    const r = await api.decide('b1', 'approve_once');
    expect(r.status).toBe('approved_once');
    expect(r.oneShotToken).toBe('tok-abc');
    expect(client.request).toHaveBeenCalledWith('/bumps/b1/decision', {
      method: 'POST',
      jsonBody: { decision: 'approve_once' },
    });
  });

  it('passes deny decision through', async () => {
    const client = fakeClient(async () => ({ status: 'denied', oneShotToken: null }));
    const api = new BumpApi(client);
    const r = await api.decide('b1', 'deny');
    expect(r.status).toBe('denied');
    expect(client.request).toHaveBeenCalledWith('/bumps/b1/decision', {
      method: 'POST',
      jsonBody: { decision: 'deny' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test bump-api
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `bump-api.ts`**

```ts
// packages/api-client/src/bump-api.ts
import type { BumpDecideResult, BumpDecision, MyBumpsResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type ListForMeInput = { status?: 'pending' | 'history' | 'all' };

export class BumpApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(input?: ListForMeInput): Promise<MyBumpsResponse> {
    const path = input?.status ? `/me/bumps?status=${input.status}` : '/me/bumps';
    return this.client.request<MyBumpsResponse>(path);
  }

  decide(bumpRequestId: string, decision: BumpDecision): Promise<BumpDecideResult> {
    return this.client.request<BumpDecideResult>(`/bumps/${bumpRequestId}/decision`, {
      method: 'POST',
      jsonBody: { decision },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @amana/api-client test bump-api
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/bump-api.ts packages/api-client/tests/bump-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): BumpApi — listForMe + decide"
```

---

### Task 6 — `NotificationApi`

**Files:**
- Create: `packages/api-client/src/notification-api.ts`
- Create: `packages/api-client/tests/notification-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api-client/tests/notification-api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { NotificationApi } from '../src/notification-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('NotificationApi.listForMe', () => {
  it('GETs /me/notifications', async () => {
    const client = fakeClient(async () => ({ notifications: [] }));
    const api = new NotificationApi(client);
    await api.listForMe();
    expect(client.request).toHaveBeenCalledWith('/me/notifications');
  });

  it('returns the parsed list', async () => {
    const client = fakeClient(async () => ({
      notifications: [
        {
          id: 'n1',
          recipientUserId: 'u1',
          kind: 'bump_requested',
          channel: 'in_app',
          status: 'sent',
          dedupeKey: 'bump:b1',
          payloadJson: { bumpRequestId: 'b1' },
          createdAt: '2026-05-06T00:00:00Z',
          updatedAt: '2026-05-06T00:00:00Z',
        },
      ],
    }));
    const api = new NotificationApi(client);
    const r = await api.listForMe();
    expect(r.notifications[0]?.id).toBe('n1');
    expect(r.notifications[0]?.kind).toBe('bump_requested');
  });
});

describe('NotificationApi.markRead', () => {
  it('POSTs /me/notifications/:id/read', async () => {
    const client = fakeClient(async () => ({ marked: true }));
    const api = new NotificationApi(client);
    const r = await api.markRead('n1');
    expect(r.marked).toBe(true);
    expect(client.request).toHaveBeenCalledWith('/me/notifications/n1/read', {
      method: 'POST',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @amana/api-client test notification-api
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `notification-api.ts`**

```ts
// packages/api-client/src/notification-api.ts
import type { MyNotificationsResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type MarkReadResult = { marked: true };

export class NotificationApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(): Promise<MyNotificationsResponse> {
    return this.client.request<MyNotificationsResponse>('/me/notifications');
  }

  markRead(id: string): Promise<MarkReadResult> {
    return this.client.request<MarkReadResult>(`/me/notifications/${id}/read`, {
      method: 'POST',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @amana/api-client test notification-api
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/notification-api.ts packages/api-client/tests/notification-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): NotificationApi — listForMe + markRead"
```

---

### Task 7 — `DeviceApi`

**Files:**
- Create: `packages/api-client/src/device-api.ts`
- Create: `packages/api-client/tests/device-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api-client/tests/device-api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DeviceApi } from '../src/device-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('DeviceApi.register', () => {
  it('POSTs /devices with token + platform', async () => {
    const client = fakeClient(async () => ({ id: 'd1' }));
    const api = new DeviceApi(client);
    const r = await api.register({
      expoPushToken: 'ExponentPushToken[abc]',
      platform: 'ios',
    });
    expect(r.id).toBe('d1');
    expect(client.request).toHaveBeenCalledWith('/devices', {
      method: 'POST',
      jsonBody: { expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' },
    });
  });

  it('forwards optional deviceLabel', async () => {
    const client = fakeClient(async () => ({ id: 'd1' }));
    const api = new DeviceApi(client);
    await api.register({
      expoPushToken: 'ExponentPushToken[abc]',
      platform: 'android',
      deviceLabel: 'Pixel 8',
    });
    expect(client.request).toHaveBeenCalledWith('/devices', {
      method: 'POST',
      jsonBody: {
        expoPushToken: 'ExponentPushToken[abc]',
        platform: 'android',
        deviceLabel: 'Pixel 8',
      },
    });
  });
});

describe('DeviceApi.unregister', () => {
  it('DELETEs /devices/:id', async () => {
    const client = fakeClient(async () => ({ deleted: true }));
    const api = new DeviceApi(client);
    const r = await api.unregister('d1');
    expect(r.deleted).toBe(true);
    expect(client.request).toHaveBeenCalledWith('/devices/d1', {
      method: 'DELETE',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @amana/api-client test device-api
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `device-api.ts`**

```ts
// packages/api-client/src/device-api.ts
import type { RegisterDeviceInput, RegisterDeviceResult } from '@amana/types';
import type { AuthedClient } from './household-api';

export type UnregisterDeviceResult = { deleted: true };

export class DeviceApi {
  constructor(private readonly client: AuthedClient) {}

  register(input: RegisterDeviceInput): Promise<RegisterDeviceResult> {
    return this.client.request<RegisterDeviceResult>('/devices', {
      method: 'POST',
      jsonBody: input,
    });
  }

  unregister(deviceId: string): Promise<UnregisterDeviceResult> {
    return this.client.request<UnregisterDeviceResult>(`/devices/${deviceId}`, {
      method: 'DELETE',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @amana/api-client test device-api
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/device-api.ts packages/api-client/tests/device-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): DeviceApi — register + unregister"
```

---

### Task 8 — Wire `bump`, `notification`, `device` into the client

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Update `client.ts`**

Add the new imports next to the existing ones:

```ts
import { BumpApi } from './bump-api';
import { DeviceApi } from './device-api';
import { NotificationApi } from './notification-api';
```

Add three new fields to the `AmanaApiClient` class (next to the existing `household`, `subWallet`, `pairing`):

```ts
  public readonly bump: BumpApi;
  public readonly notification: NotificationApi;
  public readonly device: DeviceApi;
```

In the constructor, after `this.pairing = new PairingApi(this);`, add:

```ts
    this.bump = new BumpApi(this);
    this.notification = new NotificationApi(this);
    this.device = new DeviceApi(this);
```

- [ ] **Step 2: Update `index.ts`**

Append after the existing exports:

```ts
export { BumpApi } from './bump-api';
export type { ListForMeInput } from './bump-api';
export { NotificationApi } from './notification-api';
export type { MarkReadResult } from './notification-api';
export { DeviceApi } from './device-api';
export type { UnregisterDeviceResult } from './device-api';
```

- [ ] **Step 3: Build the package**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client build
```

Expected: build succeeds.

- [ ] **Step 4: Run the full api-client test suite**

```bash
pnpm --filter @amana/api-client test
```

Expected: all prior + 11 new tests pass (5 bump + 3 notification + 3 device).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/client.ts packages/api-client/src/index.ts packages/api-client/dist
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): wire bump/notification/device APIs into AmanaApiClient"
```

---

## Phase D — Mobile deps + config (Tasks 9-10)

### Task 9 — Add native deps

**Files:**
- Modify: `apps/principal/package.json`

- [ ] **Step 1: Add the two missing deps**

Edit the `dependencies` block in `apps/principal/package.json` — insert the two new entries alphabetically:

```json
    "expo-device": "~6.0.2",
    "react-native-qrcode-svg": "^6.3.2",
    "react-native-svg": "15.2.0",
```

`react-native-svg` is a peer dep of `react-native-qrcode-svg`; pinning it explicitly avoids hoisting surprises. Final block (sorted):

```json
  "dependencies": {
    "@amana/api-client": "workspace:*",
    "@amana/types": "workspace:*",
    "@hookform/resolvers": "^5.2.2",
    "@react-navigation/native": "^7.2.2",
    "@react-navigation/native-stack": "^7.14.12",
    "expo": "~51.0.39",
    "expo-clipboard": "~6.0.3",
    "expo-device": "~6.0.2",
    "expo-notifications": "~0.28.19",
    "expo-secure-store": "~13.0.2",
    "expo-status-bar": "~1.12.1",
    "react": "18.2.0",
    "react-hook-form": "^7.75.0",
    "react-native": "0.74.5",
    "react-native-qrcode-svg": "^6.3.2",
    "react-native-safe-area-context": "^5.7.0",
    "react-native-screens": "^4.24.0",
    "react-native-svg": "15.2.0",
    "zod": "3.23.8",
    "zustand": "^5.0.13"
  },
```

- [ ] **Step 2: Install**

```bash
cd "C:/Users/alex_/amana"
pnpm install
```

Expected: `expo-device`, `react-native-qrcode-svg`, `react-native-svg` resolve and the lockfile updates.

- [ ] **Step 3: Commit (without the lockfile yet — bundle in step 5)**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/package.json pnpm-lock.yaml
git -C "C:/Users/alex_/amana" commit -m "feat(principal): add expo-device, react-native-qrcode-svg, react-native-svg deps"
```

---

### Task 10 — Configure `expo-notifications` plugin

**Files:**
- Modify: `apps/principal/app.json`

- [ ] **Step 1: Add the plugin block**

Replace the file contents:

```json
{
  "expo": {
    "name": "Amana Principal",
    "slug": "amana-principal",
    "version": "0.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": {
      "bundleIdentifier": "com.amana.principal",
      "supportsTablet": false
    },
    "android": {
      "package": "com.amana.principal"
    },
    "platforms": ["ios", "android"],
    "plugins": [
      "expo-secure-store",
      [
        "expo-notifications",
        {
          "color": "#222222"
        }
      ]
    ]
  }
}
```

`color` controls the small-icon tint on Android. Custom notification icon is left to a polish slice — Expo's default monochrome icon ships out of the box.

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/app.json
git -C "C:/Users/alex_/amana" commit -m "feat(principal): configure expo-notifications plugin in app.json"
```

---

## Phase E — Mobile state (Tasks 11-13)

### Task 11 — `bumps.store.ts`

**Files:**
- Create: `apps/principal/src/state/bumps.store.ts`

Mirrors the pattern in `household.store.ts`: `ApiError` → `errorCode`, optimistic decide that reverts on failure.

- [ ] **Step 1: Implement**

```ts
// apps/principal/src/state/bumps.store.ts
import { ApiError } from '@amana/api-client';
import type { BumpDecision, BumpRequest } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';

export type BumpsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BumpsState = {
  status: BumpsStatus;
  pending: BumpRequest[];
  history: BumpRequest[];
  errorCode: string | null;
  decidingId: string | null;

  refresh(): Promise<void>;
  decide(bumpId: string, decision: BumpDecision): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

export const useBumpsStore = create<BumpsState>((set, get) => ({
  status: 'idle',
  pending: [],
  history: [],
  errorCode: null,
  decidingId: null,

  async refresh() {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.bump.listForMe();
      set({ status: 'ready', pending: r.pending, history: r.history });
    } catch (e) {
      set({ status: 'error', errorCode: ERR(e) });
    }
  },

  async decide(bumpId, decision) {
    const before = get();
    const target = before.pending.find((b) => b.id === bumpId);
    if (!target) {
      set({ errorCode: 'bump_not_found' });
      return;
    }
    // Optimistic move: remove from pending, prepend a synthetic decided row.
    const predictedStatus =
      decision === 'approve_once'
        ? 'approved_once'
        : decision === 'approve_raise_limit'
          ? 'raise_limit'
          : 'denied';
    const optimistic: BumpRequest = {
      ...target,
      status: predictedStatus,
      decidedAt: new Date().toISOString(),
    };
    set({
      decidingId: bumpId,
      pending: before.pending.filter((b) => b.id !== bumpId),
      history: [optimistic, ...before.history],
      errorCode: null,
    });
    try {
      const r = await api.bump.decide(bumpId, decision);
      // Reconcile to the server's reported status.
      set((s) => ({
        decidingId: null,
        history: s.history.map((b) => (b.id === bumpId ? { ...b, status: r.status } : b)),
      }));
    } catch (e) {
      // Revert.
      set({
        decidingId: null,
        pending: before.pending,
        history: before.history,
        errorCode: ERR(e),
      });
    }
  },
}));
```

- [ ] **Step 2: Typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/bumps.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): bumps.store — pending+history with optimistic decide"
```

---

### Task 12 — `notifications.store.ts`

**Files:**
- Create: `apps/principal/src/state/notifications.store.ts`

- [ ] **Step 1: Implement**

```ts
// apps/principal/src/state/notifications.store.ts
import { ApiError } from '@amana/api-client';
import type { Notification } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';

export type NotificationsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type NotificationsState = {
  status: NotificationsStatus;
  items: Notification[];
  unreadCount: number;
  errorCode: string | null;

  refresh(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

const computeUnread = (items: Notification[]): number =>
  items.filter((n) => n.status !== 'read' && n.status !== 'skipped').length;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  status: 'idle',
  items: [],
  unreadCount: 0,
  errorCode: null,

  async refresh() {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.notification.listForMe();
      // The /me/notifications endpoint returns rows across all channels (in_app, push, sms).
      // For the inbox, show only the in_app row per dedupeKey to avoid duplicates.
      const seen = new Set<string>();
      const items = r.notifications.filter((n) => {
        if (n.channel !== 'in_app') return false;
        if (seen.has(n.dedupeKey)) return false;
        seen.add(n.dedupeKey);
        return true;
      });
      set({ status: 'ready', items, unreadCount: computeUnread(items) });
    } catch (e) {
      set({ status: 'error', errorCode: ERR(e) });
    }
  },

  async markRead(id) {
    const before = get().items;
    const next = before.map((n) => (n.id === id ? { ...n, status: 'read' as const } : n));
    set({ items: next, unreadCount: computeUnread(next) });
    try {
      await api.notification.markRead(id);
    } catch (e) {
      // Revert on error.
      set({ items: before, unreadCount: computeUnread(before), errorCode: ERR(e) });
    }
  },

  async markAllRead() {
    const unread = get().items.filter((n) => n.status !== 'read' && n.status !== 'skipped');
    for (const n of unread) {
      await get().markRead(n.id);
    }
  },
}));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/notifications.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): notifications.store — in_app feed with mark-read"
```

---

### Task 13 — `push.store.ts`

**Files:**
- Create: `apps/principal/src/state/push.store.ts`

- [ ] **Step 1: Implement**

```ts
// apps/principal/src/state/push.store.ts
import { ApiError } from '@amana/api-client';
import type { DevicePlatform } from '@amana/types';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { api } from '../lib/api';
import { getExpoPushTokenOrNull } from '../lib/push';

const DEVICE_ID_KEY = '@amana/principal/deviceId';

export type PushPermissionStatus = 'undetermined' | 'granted' | 'denied';

export type PushState = {
  permissionStatus: PushPermissionStatus;
  expoPushToken: string | null;
  deviceId: string | null;
  errorCode: string | null;

  /** Read OS permission status without prompting; load persisted deviceId. */
  bootstrap(): Promise<void>;
  /** Prompt the user, fetch token, register device with backend. Returns final permission. */
  requestPermissionAndRegister(): Promise<PushPermissionStatus>;
  /** Best-effort delete on backend + clear local. Called on logout. */
  unregister(): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

function osStatusToOurs(s: Notifications.PermissionStatus): PushPermissionStatus {
  if (s === 'granted') return 'granted';
  if (s === 'denied') return 'denied';
  return 'undetermined';
}

function platformOrNull(): DevicePlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

export const usePushStore = create<PushState>((set, get) => ({
  permissionStatus: 'undetermined',
  expoPushToken: null,
  deviceId: null,
  errorCode: null,

  async bootstrap() {
    try {
      const perm = await Notifications.getPermissionsAsync();
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      set({ permissionStatus: osStatusToOurs(perm.status), deviceId: stored });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async requestPermissionAndRegister() {
    const platform = platformOrNull();
    if (!platform) {
      set({ permissionStatus: 'denied', errorCode: 'unsupported_platform' });
      return 'denied';
    }
    try {
      const perm = await Notifications.requestPermissionsAsync();
      const status = osStatusToOurs(perm.status);
      set({ permissionStatus: status });
      if (status !== 'granted') return status;

      const token = await getExpoPushTokenOrNull();
      if (!token) {
        // Simulator or no projectId — permission granted but we can't get a token.
        set({ expoPushToken: null });
        return status;
      }
      const r = await api.device.register({ expoPushToken: token, platform });
      await AsyncStorage.setItem(DEVICE_ID_KEY, r.id);
      set({ expoPushToken: token, deviceId: r.id });
      return status;
    } catch (e) {
      set({ errorCode: ERR(e) });
      return get().permissionStatus;
    }
  },

  async unregister() {
    const id = get().deviceId;
    if (id) {
      try {
        await api.device.unregister(id);
      } catch {
        // Best-effort — even if delete fails, clear locally.
      }
    }
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
    set({ deviceId: null, expoPushToken: null });
  },
}));
```

- [ ] **Step 2: Add `@react-native-async-storage/async-storage` dep**

The store uses AsyncStorage which isn't yet in the principal app's deps. Add to `apps/principal/package.json` `dependencies` block (alphabetically):

```json
    "@react-native-async-storage/async-storage": "1.23.1",
```

Then install:

```bash
cd "C:/Users/alex_/amana"
pnpm install
```

- [ ] **Step 3: Typecheck**

The typecheck will fail until Task 14 creates `lib/push.ts`. Defer typecheck verification to Task 14's step.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/push.store.ts apps/principal/package.json pnpm-lock.yaml
git -C "C:/Users/alex_/amana" commit -m "feat(principal): push.store — permission + token registration; add async-storage dep"
```

---

## Phase F — Mobile lib (Task 14)

### Task 14 — `lib/push.ts`

**Files:**
- Create: `apps/principal/src/lib/push.ts`

- [ ] **Step 1: Implement**

```ts
// apps/principal/src/lib/push.ts
import type { NotificationDeepLink, NotificationKind } from '@amana/types';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Foreground display behavior — show banner, no sound, no badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Returns an Expo push token, or null if:
 * - running on a simulator (Device.isDevice === false)
 * - no projectId is configured (e.g., bare local dev without EAS)
 * - the token request itself errors (network / OS)
 */
export async function getExpoPushTokenOrNull(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined;
  try {
    const t = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return t.data;
  } catch {
    return null;
  }
}

export function setupForegroundListener(
  handler: (n: Notifications.Notification) => void,
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(handler);
}

export function setupResponseListener(
  handler: (r: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

/** True for any push payload whose `data.kind` indicates a bump-related event. */
export function isBumpKind(kind: unknown): kind is 'bump_requested' | 'bump_decided' {
  return kind === 'bump_requested' || kind === 'bump_decided';
}

/**
 * Map a notification's `kind` + `payloadJson` into a deep-link target the inbox
 * tap handler can navigate on. `kind: 'none'` means tap → mark-read only.
 *
 * v1 only deep-links bump notifications. Transaction notifications return
 * `'none'` because the payload doesn't carry `subWalletId`; that requires a
 * backend template patch which is deferred (see spec out-of-scope).
 */
export function deepLinkFor(
  kind: NotificationKind,
  payloadJson: unknown,
): NotificationDeepLink {
  const p = (payloadJson ?? {}) as Record<string, unknown>;
  if ((kind === 'bump_requested' || kind === 'bump_decided') && typeof p.bumpRequestId === 'string') {
    return { kind: 'bump', bumpRequestId: p.bumpRequestId };
  }
  return { kind: 'none' };
}
```

- [ ] **Step 2: Typecheck (now that both push.store and push.ts exist)**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/lib/push.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): push lib — token helper, listeners, deep-link mapper"
```

---

## Phase G — Mobile screens (Tasks 15-19)

### Task 15 — Modify `PairingScreen` (QR + share)

**Files:**
- Modify: `apps/principal/src/screens/PairingScreen.tsx`

- [ ] **Step 1: Update the file**

Replace the existing imports block (lines 1-6) with:

```tsx
import { ApiError } from '@amana/api-client';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '../lib/api';
import { useHouseholdStore } from '../state/household.store';
```

Add a share helper next to `copy` (after line 42 `};`):

```tsx
  const share = async () => {
    if (state.kind !== 'issued') return;
    try {
      await Share.share({
        message: `Pair as my Amana agent: ${state.code}`,
      });
    } catch {
      // User cancelled or sheet failed — no-op.
    }
  };
```

In the `state.kind === 'issued'` JSX block (lines 60-74), replace the inner `<View style={styles.card}>` content with:

```tsx
        <View style={styles.card}>
          <Text style={styles.muted}>Have your agent scan this code:</Text>
          <View style={styles.qrWrap}>
            <QRCode value={state.code} size={220} />
          </View>
          <Text style={styles.muted}>Or share it directly:</Text>
          <Text style={styles.code} selectable>
            {state.code}
          </Text>
          <Text style={styles.muted}>Expires {new Date(state.expiresAt).toLocaleString()}</Text>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void share()}>
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.secondary]} onPress={() => void copy()}>
              <Text style={[styles.buttonText, styles.secondaryText]}>{copied ? 'Copied ✓' : 'Copy'}</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => void issue()}>
            <Text style={[styles.buttonText, styles.secondaryText]}>Generate another</Text>
          </Pressable>
        </View>
```

In the `styles` block, add two new entries (anywhere in the `StyleSheet.create({ ... })` call):

```tsx
  qrWrap: { alignItems: 'center', paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 8 },
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/PairingScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): PairingScreen — QR rendering + native share sheet"
```

---

### Task 16 — `BumpsInboxScreen.tsx`

**Files:**
- Create: `apps/principal/src/screens/BumpsInboxScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/principal/src/screens/BumpsInboxScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { BumpRequest, BumpStatus } from '@amana/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useBumpsStore } from '../state/bumps.store';
import { usePushStore } from '../state/push.store';

type Props = NativeStackScreenProps<MainStackParamList, 'BumpsInbox'>;

const PROMPT_SHOWN_KEY = '@amana/principal/enable-notifications-shown';

function statusLabel(status: BumpStatus): string {
  switch (status) {
    case 'approved_once':
      return 'Approved';
    case 'raise_limit':
      return 'Approved (raised)';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired';
    case 'pending':
      return 'Pending';
  }
}

function formatNaira(amountKoboStr: string): string {
  const kobo = BigInt(amountKoboStr);
  const naira = kobo / 100n;
  const remainder = kobo % 100n;
  return `₦${naira.toLocaleString()}.${remainder.toString().padStart(2, '0')}`;
}

function expiresInLabel(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'in <1 min';
  if (mins < 60) return `in ${mins} min`;
  return `in ${Math.floor(mins / 60)} h`;
}

export function BumpsInboxScreen({ navigation }: Props): JSX.Element {
  const status = useBumpsStore((s) => s.status);
  const pending = useBumpsStore((s) => s.pending);
  const history = useBumpsStore((s) => s.history);
  const errorCode = useBumpsStore((s) => s.errorCode);
  const decidingId = useBumpsStore((s) => s.decidingId);
  const refresh = useBumpsStore((s) => s.refresh);
  const decide = useBumpsStore((s) => s.decide);
  const permissionStatus = usePushStore((s) => s.permissionStatus);

  // Refresh on focus.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // First-open: show enable-notifications explainer once if permission undetermined.
  useEffect(() => {
    void (async () => {
      if (permissionStatus !== 'undetermined') return;
      const shown = await AsyncStorage.getItem(PROMPT_SHOWN_KEY);
      if (shown) return;
      await AsyncStorage.setItem(PROMPT_SHOWN_KEY, '1');
      navigation.navigate('EnableNotifications');
    })();
  }, [permissionStatus, navigation]);

  const now = useMemo(() => new Date(), []);

  const renderPending = ({ item }: { item: BumpRequest }) => (
    <View style={styles.card}>
      <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
      <Text style={styles.vendor}>{item.vendorResolvedName}</Text>
      <Text style={styles.muted}>Expires {expiresInLabel(item.expiresAt, now)}</Text>
      <View style={styles.actions}>
        <Pressable
          style={[styles.button, decidingId === item.id && styles.disabled]}
          disabled={decidingId !== null}
          onPress={() => void decide(item.id, 'approve_once')}
        >
          <Text style={styles.buttonText}>Approve</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.deny, decidingId === item.id && styles.disabled]}
          disabled={decidingId !== null}
          onPress={() => void decide(item.id, 'deny')}
        >
          <Text style={styles.buttonText}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderHistory = ({ item }: { item: BumpRequest }) => (
    <View style={[styles.card, styles.dim]}>
      <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
      <Text style={styles.vendor}>{item.vendorResolvedName}</Text>
      <Text style={styles.pill}>{statusLabel(item.status)}</Text>
    </View>
  );

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
        <Pressable style={styles.button} onPress={() => void refresh()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (pending.length === 0 && history.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No requests need your decision.</Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={[
        ...pending.map((b) => ({ kind: 'pending' as const, b })),
        ...history.map((b) => ({ kind: 'history' as const, b })),
      ]}
      keyExtractor={(row) => row.b.id}
      ListHeaderComponent={
        pending.length > 0 ? <Text style={styles.section}>Pending</Text> : null
      }
      renderItem={({ item, index }) => {
        const showHistoryHeader =
          item.kind === 'history' &&
          (index === 0 || (index > 0 && pending.length === index));
        return (
          <>
            {showHistoryHeader && <Text style={styles.section}>Recent</Text>}
            {item.kind === 'pending' ? renderPending({ item: item.b }) : renderHistory({ item: item.b })}
          </>
        );
      }}
      refreshControl={
        <RefreshControl refreshing={status === 'loading'} onRefresh={() => void refresh()} />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  section: { fontSize: 12, fontWeight: '600', color: '#666', textTransform: 'uppercase', marginTop: 8 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f3f3', gap: 6 },
  dim: { opacity: 0.6 },
  amount: { fontSize: 22, fontWeight: '700' },
  vendor: { fontSize: 14, color: '#444' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  pill: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
    color: '#222',
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  deny: { backgroundColor: '#b00020' },
  disabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 2: Typecheck (will fail until MainStack.tsx is updated in Task 20)**

Skip typecheck; deferred to Task 20.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/BumpsInboxScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): BumpsInboxScreen — pending + 30d history with optimistic decide"
```

---

### Task 17 — `NotificationsInboxScreen.tsx`

**Files:**
- Create: `apps/principal/src/screens/NotificationsInboxScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/principal/src/screens/NotificationsInboxScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { Notification, NotificationKind } from '@amana/types';
import { useCallback, useLayoutEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deepLinkFor } from '../lib/push';
import type { MainStackParamList } from '../nav/MainStack';
import { useNotificationsStore } from '../state/notifications.store';

type Props = NativeStackScreenProps<MainStackParamList, 'NotificationsInbox'>;

function titleFor(kind: NotificationKind): string {
  switch (kind) {
    case 'bump_requested':
      return 'Bump request';
    case 'bump_decided':
      return 'Bump decided';
    case 'txn_settled':
      return 'Payment sent';
    case 'txn_failed':
      return 'Payment failed';
    case 'anomaly_alert':
      return 'Unusual activity';
    case 'refund_received':
      return 'Refund received';
  }
}

function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsInboxScreen({ navigation }: Props): JSX.Element {
  const status = useNotificationsStore((s) => s.status);
  const items = useNotificationsStore((s) => s.items);
  const errorCode = useNotificationsStore((s) => s.errorCode);
  const refresh = useNotificationsStore((s) => s.refresh);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        unreadCount > 0 ? (
          <Pressable onPress={() => void markAllRead()}>
            <Text style={styles.headerAction}>Mark all read</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, unreadCount, markAllRead]);

  const onTap = (n: Notification) => {
    void markRead(n.id);
    const link = deepLinkFor(n.kind, n.payloadJson);
    if (link.kind === 'bump') {
      navigation.navigate('BumpsInbox');
    }
    // 'transaction' and 'none' deep-links are no-ops in v1 (mark-read only).
  };

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
        <Pressable style={styles.button} onPress={() => void refresh()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Nothing here yet.</Text>
      </View>
    );
  }

  const now = new Date();

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={items}
      keyExtractor={(n) => n.id}
      renderItem={({ item }) => {
        const unread = item.status !== 'read';
        const payload = (item.payloadJson ?? {}) as Record<string, unknown>;
        const body =
          typeof payload.vendorResolvedName === 'string'
            ? payload.vendorResolvedName
            : '';
        return (
          <Pressable style={styles.row} onPress={() => onTap(item)}>
            {unread && <View style={styles.dot} />}
            <View style={styles.rowText}>
              <Text style={[styles.title, unread && styles.bold]}>{titleFor(item.kind)}</Text>
              {body ? <Text style={styles.body}>{body}</Text> : null}
              <Text style={styles.muted}>{relativeTime(item.createdAt, now)}</Text>
            </View>
          </Pressable>
        );
      }}
      refreshControl={
        <RefreshControl refreshing={status === 'loading'} onRefresh={() => void refresh()} />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 12,
    alignItems: 'flex-start',
  },
  rowText: { flex: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1769ff', marginTop: 6 },
  title: { fontSize: 14, color: '#222' },
  bold: { fontWeight: '700' },
  body: { fontSize: 14, color: '#444' },
  muted: { color: '#666', fontSize: 12 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600' },
  headerAction: { color: '#1769ff', fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Typecheck (will fail until MainStack.tsx is updated in Task 20)**

Skip typecheck; deferred to Task 20.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/NotificationsInboxScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): NotificationsInboxScreen — feed with deep-link to bumps"
```

---

### Task 18 — `EnableNotificationsScreen.tsx`

**Files:**
- Create: `apps/principal/src/screens/EnableNotificationsScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/principal/src/screens/EnableNotificationsScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { usePushStore } from '../state/push.store';

type Props = NativeStackScreenProps<MainStackParamList, 'EnableNotifications'>;

export function EnableNotificationsScreen({ navigation }: Props): JSX.Element {
  const requestPermissionAndRegister = usePushStore((s) => s.requestPermissionAndRegister);

  const onEnable = async () => {
    await requestPermissionAndRegister();
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>🔔</Text>
      </View>
      <Text style={styles.title}>Get notified when an agent needs approval</Text>
      <View style={styles.bullets}>
        <Text style={styles.bullet}>• Approve spend in one tap</Text>
        <Text style={styles.bullet}>• Hear about settled transactions</Text>
        <Text style={styles.bullet}>• Get anomaly alerts</Text>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={() => void onEnable()}>
          <Text style={styles.primaryText}>Enable notifications</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24, justifyContent: 'center', alignItems: 'center' },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#f3f3f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  bullets: { gap: 8 },
  bullet: { fontSize: 16, color: '#444' },
  actions: { gap: 8, alignSelf: 'stretch' },
  primary: {
    backgroundColor: '#222',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  primaryText: { color: 'white', fontWeight: '600', fontSize: 16 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: '#666', fontSize: 14 },
});
```

- [ ] **Step 2: Typecheck (will fail until MainStack.tsx is updated in Task 20)**

Skip typecheck; deferred to Task 20.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/EnableNotificationsScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): EnableNotificationsScreen — permission pre-prompt explainer"
```

---

### Task 19 — Update `HomeDashboardScreen` with badges

**Files:**
- Modify: `apps/principal/src/screens/HomeDashboardScreen.tsx`

- [ ] **Step 1: Update the file**

Replace the imports block (lines 1-6):

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useAuthStore } from '../state/auth.store';
import { useBumpsStore } from '../state/bumps.store';
import { useHouseholdStore } from '../state/household.store';
import { useNotificationsStore } from '../state/notifications.store';
```

Replace the body of `HomeDashboardScreen` (the function — keep the type def and styles untouched). The function should be:

```tsx
export function HomeDashboardScreen({ navigation }: Props): JSX.Element {
  const status = useHouseholdStore((s) => s.status);
  const household = useHouseholdStore((s) => s.household);
  const masterWallet = useHouseholdStore((s) => s.masterWallet);
  const members = useHouseholdStore((s) => s.members);
  const errorCode = useHouseholdStore((s) => s.errorCode);
  const bootstrap = useHouseholdStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const pendingCount = useBumpsStore((s) => s.pending.length);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const logout = useAuthStore((s) => s.logout);

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

      <Pressable style={styles.row} onPress={() => navigation.navigate('BumpsInbox')}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>Pending requests</Text>
          {pendingCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.muted}>Approve or deny agent bumps</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => navigation.navigate('NotificationsInbox')}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.muted}>Recent activity</Text>
      </Pressable>

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
```

In the `styles` block, append three new entries inside the `StyleSheet.create({ ... })` call:

```tsx
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1769ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
```

- [ ] **Step 2: Typecheck (will fail until Task 20 wires the new routes)**

Skip typecheck; deferred to Task 20.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/HomeDashboardScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): HomeDashboard — Pending requests + Notifications tiles with badges"
```

---

## Phase H — Wiring (Tasks 20-22)

### Task 20 — Update `MainStack` with new routes

**Files:**
- Modify: `apps/principal/src/nav/MainStack.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// apps/principal/src/nav/MainStack.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BumpsInboxScreen } from '../screens/BumpsInboxScreen';
import { CreateSubWalletScreen } from '../screens/CreateSubWalletScreen';
import { EditRulesScreen } from '../screens/EditRulesScreen';
import { EnableNotificationsScreen } from '../screens/EnableNotificationsScreen';
import { HomeDashboardScreen } from '../screens/HomeDashboardScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { MembersScreen } from '../screens/MembersScreen';
import { NotificationsInboxScreen } from '../screens/NotificationsInboxScreen';
import { PairingScreen } from '../screens/PairingScreen';
import { SubWalletDetailScreen } from '../screens/SubWalletDetailScreen';
import { SubWalletsListScreen } from '../screens/SubWalletsListScreen';

export type MainStackParamList = {
  HomeDashboard: undefined;
  HouseholdSetup: undefined;
  Pairing: undefined;
  Members: undefined;
  SubWalletsList: undefined;
  CreateSubWallet: undefined;
  SubWalletDetail: { subWalletId: string };
  EditRules: { subWalletId: string };
  BumpsInbox: undefined;
  NotificationsInbox: undefined;
  EnableNotifications: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="HomeDashboard"
        component={HomeDashboardScreen}
        options={{ title: 'Amana' }}
      />
      <Stack.Screen
        name="HouseholdSetup"
        component={HouseholdSetupScreen}
        options={{ title: 'Set up household' }}
      />
      <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: 'Pair an agent' }} />
      <Stack.Screen name="Members" component={MembersScreen} options={{ title: 'Agents' }} />
      <Stack.Screen
        name="SubWalletsList"
        component={SubWalletsListScreen}
        options={{ title: 'Sub-wallets' }}
      />
      <Stack.Screen
        name="CreateSubWallet"
        component={CreateSubWalletScreen}
        options={{ title: 'New sub-wallet' }}
      />
      <Stack.Screen
        name="SubWalletDetail"
        component={SubWalletDetailScreen}
        options={{ title: 'Sub-wallet' }}
      />
      <Stack.Screen
        name="EditRules"
        component={EditRulesScreen}
        options={{ title: 'Edit rules' }}
      />
      <Stack.Screen
        name="BumpsInbox"
        component={BumpsInboxScreen}
        options={{ title: 'Pending requests' }}
      />
      <Stack.Screen
        name="NotificationsInbox"
        component={NotificationsInboxScreen}
        options={{ title: 'Notifications' }}
      />
      <Stack.Screen
        name="EnableNotifications"
        component={EnableNotificationsScreen}
        options={{ title: 'Notifications', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 2: Typecheck the whole principal app**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: PASS. (This is the first full typecheck since Task 14 — it covers all screens added in Tasks 16-19.) If it fails, fix the offending screen file rather than skipping verification.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/nav/MainStack.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): wire BumpsInbox, NotificationsInbox, EnableNotifications routes"
```

---

### Task 21 — Wire push listeners + cold-start tap in `App.tsx`

**Files:**
- Modify: `apps/principal/App.tsx`
- Modify: `apps/principal/src/nav/RootNavigator.tsx`

`RootNavigator` already calls `useAuthStore.bootstrap()` on mount, so App.tsx must NOT bootstrap auth again — it just observes auth status to decide when to wire push listeners.

- [ ] **Step 1: Replace `RootNavigator.tsx`**

Replace the file:

```tsx
// apps/principal/src/nav/RootNavigator.tsx
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { useEffect } from 'react';
import { SplashScreen } from '../screens/SplashScreen';
import { useAuthStore } from '../state/auth.store';
import { AuthStack } from './AuthStack';
import { MainStack, type MainStackParamList } from './MainStack';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

export function RootNavigator(): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer ref={navigationRef}>
      {status === 'logged_in' ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
```

- [ ] **Step 2: Replace `App.tsx`**

```tsx
// apps/principal/App.tsx
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  deepLinkFor,
  isBumpKind,
  setupForegroundListener,
  setupResponseListener,
} from './src/lib/push';
import { RootNavigator, navigationRef } from './src/nav/RootNavigator';
import { useAuthStore } from './src/state/auth.store';
import { useBumpsStore } from './src/state/bumps.store';
import { useNotificationsStore } from './src/state/notifications.store';
import { usePushStore } from './src/state/push.store';

function navigateForResponse(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  if (!data) return;
  const kind = data.kind;
  if (typeof kind !== 'string') return;
  // Reuse the inbox deep-link mapper.
  const link = deepLinkFor(kind as Parameters<typeof deepLinkFor>[0], data);
  if (link.kind === 'bump' && navigationRef.isReady()) {
    navigationRef.navigate('BumpsInbox');
  }
}

export default function App(): JSX.Element {
  const authStatus = useAuthStore((s) => s.status);
  const bootstrapPush = usePushStore((s) => s.bootstrap);
  const refreshBumps = useBumpsStore((s) => s.refresh);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const fgSubRef = useRef<Notifications.Subscription | null>(null);
  const responseSubRef = useRef<Notifications.Subscription | null>(null);

  // RootNavigator handles auth bootstrap. We only react to logged-in to wire push.
  useEffect(() => {
    if (authStatus !== 'logged_in') return;
    void bootstrapPush();

    // Foreground push: refresh the relevant store.
    fgSubRef.current = setupForegroundListener((n) => {
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });

    // Background tap: navigate to deep-link target.
    responseSubRef.current = setupResponseListener(navigateForResponse);

    // Cold-start tap: process the response that launched the app, if any.
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) navigateForResponse(r);
    });

    return () => {
      fgSubRef.current?.remove();
      responseSubRef.current?.remove();
      fgSubRef.current = null;
      responseSubRef.current = null;
    };
  }, [authStatus, bootstrapPush, refreshBumps, refreshNotifications]);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/App.tsx apps/principal/src/nav/RootNavigator.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): wire push listeners + cold-start deep-link in App.tsx"
```

---

### Task 22 — Hook `pushStore.unregister` into logout

**Files:**
- Modify: `apps/principal/src/state/auth.store.ts`

- [ ] **Step 1: Update the `logout` action**

Add the import at the top of the file (next to the existing `secureTokenStore` import):

```ts
import { usePushStore } from './push.store';
```

Replace the body of the `logout` function (lines 85-100). Insert the unregister call before clearing local tokens — best-effort, don't block logout on failure:

```ts
  async logout() {
    set({ busy: true });
    try {
      try {
        await usePushStore.getState().unregister();
      } catch {
        // Best-effort — even if device unregister fails, continue with logout.
      }
      try {
        const stored = await secureTokenStore.read();
        if (stored) await api.auth.logout(stored.tokens.accessToken);
      } catch {
        // Best-effort — even if revoke fails, we clear locally.
      }
      await secureTokenStore.clear();
      set({ status: 'logged_out', user: null, pendingPhone: null, busy: false, errorCode: null });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/auth.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): unregister push device on logout (best-effort)"
```

---

## Phase I — Verification + ship (Tasks 23-25)

### Task 23 — Pre-flight all green

- [ ] **Step 1: Run the full sweep**

```bash
cd "C:/Users/alex_/amana"
docker compose up -d postgres
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
pnpm -r build
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
- api-client tests: ≥41 passing (30 from 6b-2 + 11 new from 6b-3)
- backend tests: ≥390 passing (380 from 6b-2 + 10 new from 6b-3)

If anything fails, fix and re-run before continuing.

---

### Task 24 — Biome auto-format sweep

- [ ] **Step 1: Run auto-format and commit if changes**

```bash
cd "C:/Users/alex_/amana"
pnpm exec biome check --write .
git -C "C:/Users/alex_/amana" status
```

If any files were changed:

```bash
git -C "C:/Users/alex_/amana" add -A
git -C "C:/Users/alex_/amana" commit -m "style: biome auto-format (Sub-plan 6b-3 sweep)"
```

(Skip if `git status` is clean.)

---

### Task 25 — Push + tag v0.0.6b3-principal-inbox

- [ ] **Step 1: Push + tag**

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.6b3-principal-inbox -m "Sub-plan 6b-3 complete: Principal — inbox + push (QR, bumps inbox, notifications inbox, push registration)"
git -C "C:/Users/alex_/amana" push origin v0.0.6b3-principal-inbox
```

- [ ] **Step 2: Verify CI green** at https://github.com/Alexander77063/amana/actions on the v0.0.6b3-principal-inbox tag.

---

## Plan complete

When all 25 tasks land green:

- A principal can pair an agent by sharing a scannable QR code or via the native share sheet
- A principal sees pending bump requests in a single inbox screen and approves/denies them in one tap, with a 30-day decided history below
- A principal sees their notification feed and can deep-link from a bump notification into the bumps inbox
- A principal who has granted notification permission receives push for `bump_requested`, `bump_decided`, `txn_settled`, `txn_failed`, `refund_received`, and `anomaly_alert`, with foreground refresh and background-tap deep-linking working on bump notifications
- Backend exposes `GET /me/bumps` (principal-scoped, 30-day history cutoff, status filter)
- All existing tests still pass; ~10 new backend tests + ~11 new api-client tests added

## Out-of-scope for this slice (handled later)

- Notification preferences screen → Sub-plan 6b-4 (channel toggles per template; backend prefs routes already exist and are unused)
- Transaction-detail screen → 6b-4 or later (notifications-inbox tap on `kind: 'transaction'` is mark-read-only in v1 because backend templates don't carry `subWalletId`)
- "Scroll to specific bump" deep-link refinement → polish slice
- "Approve & raise limit" UI → reintroduce when backend rule-write side lands (currently records state but doesn't write rules)
- Real Anchor virtual-account provisioning → Sub-plan 7
- Agent app push registration / inbox → Sub-plan 6c
- RN Testing Library screen tests → its own slice
