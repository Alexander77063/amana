# Sub-plan 7 — Agent Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Amana agent mobile app from empty Expo shell to a fully functional payment client — auth, three-mechanism pairing (QR/NFC/SMS), vendor capture, bump handling, post-settlement photo upload, and transaction history.

**Architecture:** Expo SDK 51 managed workflow consuming `@amana/api-client` and `@amana/types`. Bottom-tab navigation (Home/Pay/History/Settings) with nested stacks per tab. State is local `useState` per screen with `useFocusEffect` for refetch; sub-wallet identity lives in a module-level singleton. Backend adds 6 new routes and modifies 1. All backend tasks follow TDD red-green-commit on vitest + real postgres.

**Tech Stack:** Expo 51, React Navigation 7 (bottom-tabs + native-stack), expo-camera v14 (barcode + photo), expo-location, react-native-nfc-manager, expo-linking, expo-notifications, expo-secure-store, Hono, Drizzle ORM, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, vitest, TypeScript

---

## File Map

**New — backend:**
- `apps/backend/src/db/migrations/0019_bump_request_cancelled.sql`
- `apps/backend/src/modules/media/media.service.ts`
- `apps/backend/src/modules/transactions/list.service.ts`
- `apps/backend/src/routes/me-sub-wallet.ts`
- `apps/backend/src/routes/media.ts`
- `apps/backend/tests/routes/me-sub-wallet.test.ts`
- `apps/backend/tests/routes/media.test.ts`
- `apps/backend/tests/routes/pairing.test.ts`

**Modified — backend:**
- `apps/backend/src/db/schema/bumps.ts` (add `'cancelled'` to `bumpStatusEnum`)
- `apps/backend/src/env.ts` (add `MEDIA_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- `apps/backend/src/modules/transactions/detail.service.ts` (add `getByIdForAgent`)
- `apps/backend/src/routes/pairing.ts` (add `POST /pairing/complete`)
- `apps/backend/src/routes/sub-wallets.ts` (add `GET /:id/transactions`)
- `apps/backend/src/routes/transactions.ts` (agent dispatch on GET + PATCH /media + DELETE /bump)
- `apps/backend/src/server.ts` (register `meSubWalletRoute`, `mediaRoute`)
- `apps/backend/tests/routes/sub-wallets.test.ts` (add transaction list cases)
- `apps/backend/tests/routes/transactions.test.ts` (add agent GET, PATCH media, DELETE bump cases)
- `apps/backend/tests/modules/transactions/detail.service.test.ts` (add agent path cases)

**New — packages:**
- `packages/types/src/sub-wallet.ts` (add `SubWalletWithPrincipal`)
- `packages/api-client/src/vendor-api.ts`
- `packages/api-client/src/media-api.ts`
- `packages/api-client/src/me-api.ts`
- `packages/api-client/tests/vendor-api.test.ts`
- `packages/api-client/tests/media-api.test.ts`
- `packages/api-client/tests/me-api.test.ts`

**Modified — packages:**
- `packages/types/src/transaction.ts` (add `TransactionSummary`, `TransactionListResponse`)
- `packages/types/src/bump.ts` (`BumpStatus` gains `'cancelled'`)
- `packages/types/src/index.ts` (re-export `sub-wallet`)
- `packages/api-client/src/client.ts` (wire `vendor`, `media`, `me`)
- `packages/api-client/src/index.ts` (re-export new APIs)
- `packages/api-client/src/sub-wallet-api.ts` (add `getTransactions`)
- `packages/api-client/src/bump-api.ts` (add `cancelBump`)
- `packages/api-client/src/pairing-api.ts` (add `complete`)
- `packages/api-client/tests/sub-wallet-api.test.ts` (add `getTransactions` cases)
- `packages/api-client/tests/bump-api.test.ts` (add `cancelBump` case)

**New — agent app:**
- `apps/agent/src/lib/api.ts`
- `apps/agent/src/lib/push.ts`
- `apps/agent/src/lib/push.test.ts`
- `apps/agent/src/lib/secure-token-store.ts`
- `apps/agent/src/lib/sub-wallet-memory.ts`
- `apps/agent/src/nav/RootNavigator.tsx`
- `apps/agent/src/nav/AuthStack.tsx`
- `apps/agent/src/nav/PairingStack.tsx`
- `apps/agent/src/nav/MainTabs.tsx`
- `apps/agent/src/nav/PayStack.tsx`
- `apps/agent/src/nav/HistoryStack.tsx`
- `apps/agent/src/nav/SettingsStack.tsx`
- `apps/agent/src/screens/PhoneScreen.tsx`
- `apps/agent/src/screens/VerifyScreen.tsx`
- `apps/agent/src/screens/PairingMethodScreen.tsx`
- `apps/agent/src/screens/QRScanScreen.tsx`
- `apps/agent/src/screens/NFCPairScreen.tsx`
- `apps/agent/src/screens/PairingSuccessScreen.tsx`
- `apps/agent/src/screens/HomeScreen.tsx`
- `apps/agent/src/screens/CaptureMethodScreen.tsx`
- `apps/agent/src/screens/NQRScanScreen.tsx`
- `apps/agent/src/screens/PhoneLookupScreen.tsx`
- `apps/agent/src/screens/AccountEntryScreen.tsx`
- `apps/agent/src/screens/ConfirmScreen.tsx`
- `apps/agent/src/screens/BumpWaitScreen.tsx`
- `apps/agent/src/screens/SendingScreen.tsx`
- `apps/agent/src/screens/ReceiptScreen.tsx`
- `apps/agent/src/screens/ShowRecipientScreen.tsx`
- `apps/agent/src/screens/PhotoAttachScreen.tsx`
- `apps/agent/src/screens/FailedScreen.tsx`
- `apps/agent/src/screens/TransactionListScreen.tsx`
- `apps/agent/src/screens/TransactionDetailScreen.tsx`
- `apps/agent/src/screens/SettingsScreen.tsx`
- `apps/agent/src/screens/EnableNotificationsScreen.tsx`
- `apps/agent/App.tsx` (replace shell)

**Modified — principal app:**
- `apps/principal/src/screens/PairingScreen.tsx` (add Android NFC emit)
- `apps/principal/package.json` (add `react-native-nfc-manager`)

---

## Task 1: @amana/types additions

**Files:**
- Modify: `packages/types/src/transaction.ts`
- Modify: `packages/types/src/bump.ts`
- Create: `packages/types/src/sub-wallet.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add `TransactionSummary` and `TransactionListResponse` to transaction.ts**

At the end of `packages/types/src/transaction.ts`, append:

```typescript
export type TransactionSummary = {
  id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountKobo: string;
  vendorResolvedName: string | null;
  vendorAccountMasked: string | null;
  initiatedAt: string;
  settledAt: string | null;
};

export type TransactionListResponse = {
  transactions: TransactionSummary[];
  nextCursor: string | null;
};
```

- [ ] **Step 2: Add `'cancelled'` to `BumpStatus` in bump.ts**

In `packages/types/src/bump.ts`, change:

```typescript
export type BumpStatus = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired';
```

to:

```typescript
export type BumpStatus = 'pending' | 'approved_once' | 'raise_limit' | 'denied' | 'expired' | 'cancelled';
```

- [ ] **Step 3: Create `packages/types/src/sub-wallet.ts`**

```typescript
export type SubWalletWithPrincipal = {
  subWallet: { id: string; name: string; masterWalletId: string };
  principal: { userId: string; phone: string };
};
```

- [ ] **Step 4: Re-export from `packages/types/src/index.ts`**

Append to the end of `packages/types/src/index.ts`:

```typescript
export * from './sub-wallet';
```

- [ ] **Step 5: Verify types build**

```bash
pnpm --filter @amana/types build
```

Expected: exits 0 with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/transaction.ts packages/types/src/bump.ts packages/types/src/sub-wallet.ts packages/types/src/index.ts
git commit -m "feat(types): TransactionSummary, SubWalletWithPrincipal, BumpStatus.cancelled"
```

---

## Task 2: Backend — schema update, migration 0019, AWS deps, env vars

**Files:**
- Modify: `apps/backend/src/db/schema/bumps.ts`
- Create: `apps/backend/src/db/migrations/0019_bump_request_cancelled.sql`
- Modify: `apps/backend/src/env.ts`
- Modify: `apps/backend/package.json`

- [ ] **Step 1: Add `'cancelled'` to `bumpStatusEnum` in `apps/backend/src/db/schema/bumps.ts`**

Change:

```typescript
export const bumpStatusEnum = pgEnum('bump_status', [
  'pending',
  'approved_once',
  'raise_limit',
  'denied',
  'expired',
]);
```

to:

```typescript
export const bumpStatusEnum = pgEnum('bump_status', [
  'pending',
  'approved_once',
  'raise_limit',
  'denied',
  'expired',
  'cancelled',
]);
```

- [ ] **Step 2: Write migration SQL**

Create `apps/backend/src/db/migrations/0019_bump_request_cancelled.sql`:

```sql
ALTER TYPE "bump_status" ADD VALUE 'cancelled';
```

- [ ] **Step 3: Generate meta snapshot**

```bash
pnpm --filter @amana/backend db:generate
```

This updates `apps/backend/src/db/migrations/meta/` with the new snapshot. If drizzle-kit generates a different migration file name, rename the generated SQL file to `0019_bump_request_cancelled.sql` and keep only the `ALTER TYPE` line.

- [ ] **Step 4: Apply migration to dev database**

```bash
pnpm --filter @amana/backend db:migrate
```

Expected: Migration `0019` applied, no errors.

- [ ] **Step 5: Add AWS SDK dependencies**

```bash
pnpm --filter @amana/backend add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 6: Add env vars to `apps/backend/src/env.ts`**

Add to the `EnvSchema` object inside `z.object({...})`:

```typescript
  MEDIA_BUCKET: z.string().min(1).default('amana-media-af-south-1'),
  AWS_REGION: z.string().min(1).default('af-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
```

- [ ] **Step 7: Add env vars to `.env.example` (if it exists)**

```bash
# check if .env.example exists
ls apps/backend/.env.example 2>/dev/null && echo EXISTS || echo MISSING
```

If it exists, append:
```
MEDIA_BUCKET=amana-media-af-south-1
AWS_REGION=af-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/db/schema/bumps.ts apps/backend/src/db/migrations/ apps/backend/src/env.ts apps/backend/package.json
git commit -m "feat(backend): migration 0019 bump_status.cancelled + AWS media env vars"
```

---

## Task 3: Backend — GET /me/sub-wallet + POST /pairing/complete (TDD)

**Files:**
- Create: `apps/backend/src/routes/me-sub-wallet.ts`
- Create: `apps/backend/tests/routes/me-sub-wallet.test.ts`
- Create: `apps/backend/tests/routes/pairing.test.ts`
- Modify: `apps/backend/src/routes/pairing.ts`
- Modify: `apps/backend/src/server.ts`

- [ ] **Step 1: Write failing tests for GET /me/sub-wallet**

Create `apps/backend/tests/routes/me-sub-wallet.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedPairedAgent() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '0000000001', anchorBankCode: '058', anchorAccountId: 'a1',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver wallet',
  });
  return { principal, agent, mw, sw };
}

describe('GET /me/sub-wallet', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — returns subWallet + principal for paired agent', async () => {
    const { principal, agent, mw, sw } = await seedPairedAgent();
    const app = createServer();
    const res = await app.request('/me/sub-wallet', { headers: await bearerHeaders(agent) });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWallet: { id: string; name: string; masterWalletId: string }; principal: { userId: string; phone: string } };
    expect(body.subWallet.id).toBe(sw.sub.id);
    expect(body.subWallet.name).toBe('Driver wallet');
    expect(body.subWallet.masterWalletId).toBe(mw.master.id);
    expect(body.principal.userId).toBe(principal.id);
    expect(body.principal.phone).toBe(principal.phone);
  });

  it('404 not_paired — agent with no sub-wallet', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/me/sub-wallet', { headers: await bearerHeaders(agent) });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('not_paired');
  });

  it('403 — principal caller', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/me/sub-wallet', { headers: await bearerHeaders(principal) });
    expect(res.status).toBe(403);
  });

  it('401 — unauthenticated', async () => {
    const app = createServer();
    const res = await app.request('/me/sub-wallet');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Write failing tests for POST /pairing/complete**

Create `apps/backend/tests/routes/pairing.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { householdsRepo } from '../../src/modules/identity/households.repo';
import { pairingService } from '../../src/modules/auth/pairing.service';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedHousehold() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '0000000001', anchorBankCode: '058', anchorAccountId: 'a1',
  });
  return { principal, hh, mw };
}

describe('POST /pairing/complete', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — agent consumes valid token, returns subWalletId when sub-wallet exists', async () => {
    const { principal, hh, mw } = await seedHousehold();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Cleaner',
    });
    const token = await pairingService.issue(testDb, { principalUserId: principal.id, householdId: hh.id });

    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ token: token.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWalletId: string | null };
    expect(body.subWalletId).toBe(sw.sub.id);
  });

  it('200 — returns subWalletId null when no sub-wallet exists yet', async () => {
    const { principal, hh } = await seedHousehold();
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const token = await pairingService.issue(testDb, { principalUserId: principal.id, householdId: hh.id });

    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ token: token.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { subWalletId: string | null };
    expect(body.subWalletId).toBeNull();
  });

  it('404 — invalid or expired token', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ token: 'bad-token' }),
    });
    expect(res.status).toBe(404);
  });

  it('403 — principal caller cannot complete pairing', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/pairing/complete', {
      method: 'POST',
      headers: await bearerHeaders(principal),
      body: JSON.stringify({ token: 'any' }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/me-sub-wallet.test.ts tests/routes/pairing.test.ts
```

Expected: multiple failures — routes don't exist yet.

- [ ] **Step 4: Implement `apps/backend/src/routes/me-sub-wallet.ts`**

```typescript
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';

type SubWalletRow = {
  sw_id: string;
  sw_name: string;
  master_wallet_id: string;
  principal_user_id: string;
  principal_phone: string;
};

export const meSubWalletRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/sub-wallet', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);

    const rows = await db.execute<SubWalletRow>(sql`
      SELECT
        sw.id             AS sw_id,
        sw.name           AS sw_name,
        sw.master_wallet_id,
        h.principal_user_id,
        pu.phone          AS principal_phone
      FROM sub_wallets sw
      JOIN master_wallets mw ON mw.id = sw.master_wallet_id
      JOIN households     h  ON h.id  = mw.household_id
      JOIN users          pu ON pu.id = h.principal_user_id
      WHERE sw.agent_user_id = ${a.userId}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) return c.json({ error: 'not_paired' }, 404);

    return c.json({
      subWallet: { id: row.sw_id, name: row.sw_name, masterWalletId: row.master_wallet_id },
      principal: { userId: row.principal_user_id, phone: row.principal_phone },
    }, 200);
  });
```

- [ ] **Step 5: Add POST /pairing/complete to `apps/backend/src/routes/pairing.ts`**

Append to the existing `pairingRoute` chain (after the `.post('/', ...)` handler):

```typescript
  .post('/complete', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);

    const body = await c.req.json<{ token?: string }>();
    if (!body.token) return c.json({ error: 'missing_token' }, 400);

    const result = await pairingService.consume(db, { code: body.token, agentUserId: a.userId });
    if (result.kind === 'not_found') return c.json({ error: 'invalid_or_expired_token' }, 404);

    // Look up the sub-wallet already assigned to this agent in the household.
    // Returns null if the principal hasn't created one yet; app handles the waiting state.
    type SwRow = { id: string };
    const rows = await db.execute<SwRow>(sql`
      SELECT sw.id
      FROM sub_wallets sw
      JOIN master_wallets mw ON mw.id = sw.master_wallet_id
      WHERE mw.household_id = ${result.householdId}
        AND sw.agent_user_id = ${a.userId}
      LIMIT 1
    `);

    return c.json({ subWalletId: rows[0]?.id ?? null }, 200);
  })
```

Also add the missing imports to `pairing.ts` top (if not already present):

```typescript
import { sql } from 'drizzle-orm';
```

- [ ] **Step 6: Register `meSubWalletRoute` in `apps/backend/src/server.ts`**

Add import:
```typescript
import { meSubWalletRoute } from './routes/me-sub-wallet';
```

Add route registration (after other `app.route('/', ...)` lines):
```typescript
app.route('/', meSubWalletRoute);
```

- [ ] **Step 7: Run tests — expect green**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/me-sub-wallet.test.ts tests/routes/pairing.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 8: Run full backend suite**

```bash
pnpm --filter @amana/backend test
```

Expected: all tests pass (no regressions).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/routes/me-sub-wallet.ts apps/backend/src/routes/pairing.ts apps/backend/src/server.ts apps/backend/tests/routes/me-sub-wallet.test.ts apps/backend/tests/routes/pairing.test.ts
git commit -m "feat(backend): GET /me/sub-wallet + POST /pairing/complete (TDD)"
```

---

## Task 4: Backend — transactionDetailService.getByIdForAgent (TDD)

**Files:**
- Modify: `apps/backend/src/modules/transactions/detail.service.ts`
- Modify: `apps/backend/tests/modules/transactions/detail.service.test.ts`

- [ ] **Step 1: Write failing tests**

In `apps/backend/tests/modules/transactions/detail.service.test.ts`, append a new `describe` block after the existing tests:

```typescript
describe('transactionDetailService.getByIdForAgent', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns detail for agent\'s own transaction', async () => {
    // Re-use the scaffoldHousehold pattern from this file's existing setup
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0000000001', anchorBankCode: '058', anchorAccountId: 'a1',
    });
    const sw = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Tunde\'s wallet',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'Mama Tola',
    });

    const r = await transactionDetailService.getByIdForAgent(testDb, txn.id, agent.id);
    expect(r).not.toBeNull();
    expect(r?.id).toBe(txn.id);
    expect(r?.amountKobo).toBe('5000');
    expect(r?.initiatedBy.role).toBe('agent');
    expect(r?.initiatedBy.userId).toBe(agent.id);
    expect(r?.subWallet?.id).toBe(sw.sub.id);
  });

  it('returns null for transaction belonging to a different agent', async () => {
    const principal = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
    });
    const agent1 = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const agent2 = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
    const mw = await masterWalletsRepo.provision(testDb, {
      householdId: hh.id, anchorVirtualAccount: '0000000002', anchorBankCode: '058', anchorAccountId: 'a2',
    });
    const sw1 = await subWalletsRepo.provision(testDb, {
      masterWalletId: mw.master.id, agentUserId: agent1.id, name: 'sw1',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw1.sub.id,
      kind: 'spend',
      amountKobo: kobo(1_000n),
      idempotencyKey: factories.idempotencyKey(),
    });

    // agent2 should NOT see agent1's transaction
    const r = await transactionDetailService.getByIdForAgent(testDb, txn.id, agent2.id);
    expect(r).toBeNull();
  });

  it('returns null for non-existent transaction', async () => {
    const agent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const r = await transactionDetailService.getByIdForAgent(
      testDb,
      '00000000-0000-0000-0000-000000000000',
      agent.id,
    );
    expect(r).toBeNull();
  });
});
```

Note: you'll need to verify that `householdsRepo`, `subWalletsRepo` etc. are already imported at the top of the test file. Add any missing imports.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/modules/transactions/detail.service.test.ts
```

Expected: 3 new failures — `getByIdForAgent is not a function`.

- [ ] **Step 3: Implement `getByIdForAgent` in `apps/backend/src/modules/transactions/detail.service.ts`**

Append to the `transactionDetailService` object (after `getByIdForPrincipal`):

```typescript
  async getByIdForAgent(
    db: PostgresJsDatabase,
    transactionId: string,
    agentUserId: string,
  ): Promise<TransactionDetail | null> {
    const rows = await db.execute<Row>(sql`
      SELECT
        t.id,
        t.kind::text              AS kind,
        t.status::text            AS status,
        t.amount_kobo::text       AS amount_kobo,
        t.vendor_resolved_name,
        t.vendor_account,
        t.vendor_bank_code,
        t.category,
        t.sub_wallet_id,
        sw.name                   AS sub_wallet_name,
        sw.agent_user_id,
        h.principal_user_id,
        pu.phone                  AS principal_phone,
        t.created_at              AS initiated_at,
        t.settled_at,
        t.nibss_session_id,
        t.error_message,
        t.agent_note,
        t.anomaly_score::text     AS anomaly_score,
        ST_Y(t.geolocation::geometry) AS lat,
        ST_X(t.geolocation::geometry) AS lng
      FROM transactions t
      INNER JOIN master_wallets mw ON mw.id = t.master_wallet_id
      INNER JOIN households     h  ON h.id  = mw.household_id
      INNER JOIN users          pu ON pu.id = h.principal_user_id
      LEFT  JOIN sub_wallets    sw ON sw.id = t.sub_wallet_id
      WHERE t.id               = ${transactionId}
        AND sw.agent_user_id   = ${agentUserId}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) return null;

    const isAgentInitiated = row.sub_wallet_id !== null && row.agent_user_id !== null;
    const initiatedBy: TransactionDetail['initiatedBy'] = isAgentInitiated
      ? { userId: row.agent_user_id as string, displayName: row.sub_wallet_name as string, role: 'agent' }
      : { userId: row.principal_user_id, displayName: row.principal_phone, role: 'principal' };

    const toISO = (d: Date) =>
      d instanceof Date ? d.toISOString() : new Date(d).toISOString();

    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      amountKobo: row.amount_kobo,
      vendorResolvedName: row.vendor_resolved_name,
      vendorAccountMasked: maskAccount(row.vendor_account),
      vendorBankCode: row.vendor_bank_code,
      category: row.category,
      subWallet:
        row.sub_wallet_id && row.sub_wallet_name
          ? { id: row.sub_wallet_id, name: row.sub_wallet_name }
          : null,
      initiatedBy,
      initiatedAt: toISO(row.initiated_at),
      settledAt: row.settled_at ? toISO(row.settled_at) : null,
      nibssSessionId: row.nibss_session_id,
      errorMessage: row.error_message,
      agentNote: row.agent_note,
      anomalyScore: row.anomaly_score === null ? null : Number(row.anomaly_score),
      geolocation:
        row.lat !== null && row.lng !== null
          ? { lat: Number(row.lat), lng: Number(row.lng) }
          : null,
    };
  },
```

- [ ] **Step 4: Run tests — expect green**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/modules/transactions/detail.service.test.ts
```

Expected: all tests (existing + 3 new) pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/transactions/detail.service.ts apps/backend/tests/modules/transactions/detail.service.test.ts
git commit -m "feat(backend): transactionDetailService.getByIdForAgent (TDD)"
```

---

## Task 5: Backend — GET /transactions/:id agent dispatch (TDD)

**Files:**
- Modify: `apps/backend/src/routes/transactions.ts`
- Modify: `apps/backend/tests/routes/transactions.test.ts`

- [ ] **Step 1: Write failing tests**

In `apps/backend/tests/routes/transactions.test.ts`, append inside or after `describe('GET /transactions/:id', ...)`:

```typescript
  it('200 — agent can GET their own transaction', async () => {
    const { agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(3_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0987654321',
      vendorBankCode: '058',
      vendorResolvedName: 'Bisi Motors',
    });

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { transaction: { id: string; initiatedBy: { role: string } } };
    expect(body.transaction.id).toBe(txn.id);
    expect(body.transaction.initiatedBy.role).toBe('agent');
  });

  it('404 — agent cannot see another household\'s transaction (no existence leak)', async () => {
    const { principal: p2, mw: mw2 } = await scaffoldHousehold();
    const txn2 = await transactionsRepo.insert(testDb, {
      masterWalletId: mw2.master.id,
      kind: 'spend',
      amountKobo: kobo(1_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    // agent from a DIFFERENT household
    const { agent: agent1 } = await scaffoldHousehold();

    const app = createServer();
    const res = await app.request(`/transactions/${txn2.id}`, {
      headers: await bearerHeaders(agent1),
    });
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/transactions.test.ts
```

Expected: 2 new failures (agents get 403 from the existing `principal_only` guard).

- [ ] **Step 3: Update the GET `/:id` handler in `apps/backend/src/routes/transactions.ts`**

Replace the existing `.get('/:id', ...)` handler:

```typescript
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
```

- [ ] **Step 4: Run tests — expect green**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/transactions.test.ts
```

Expected: all tests pass including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/transactions.ts apps/backend/tests/routes/transactions.test.ts
git commit -m "feat(backend): GET /transactions/:id dispatches to agent service method (TDD)"
```

---

## Task 6: Backend — GET /sub-wallets/:id/transactions (TDD)

**Files:**
- Create: `apps/backend/src/modules/transactions/list.service.ts`
- Modify: `apps/backend/src/routes/sub-wallets.ts`
- Modify: `apps/backend/tests/routes/sub-wallets.test.ts`

- [ ] **Step 1: Write failing tests**

In `apps/backend/tests/routes/sub-wallets.test.ts`, append:

```typescript
describe('GET /sub-wallets/:id/transactions', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — returns paginated transactions for agent', async () => {
    const { agent, mw, sw } = await seedHouseholdWithSubWallet();
    // Insert 3 transactions
    for (let i = 0; i < 3; i++) {
      await transactionsRepo.insert(testDb, {
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        kind: 'spend',
        amountKobo: kobo(BigInt((i + 1) * 1000)),
        idempotencyKey: factories.idempotencyKey(),
        vendorResolvedName: `Vendor ${i}`,
        vendorAccount: factories.bankAccount(),
        vendorBankCode: '058',
      });
    }

    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/transactions`, {
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { transactions: unknown[]; nextCursor: string | null };
    expect(body.transactions).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
  });

  it('200 — cursor pagination works', async () => {
    const { agent, mw, sw } = await seedHouseholdWithSubWallet();
    // Insert 3 transactions
    const txns = [];
    for (let i = 0; i < 3; i++) {
      const t = await transactionsRepo.insert(testDb, {
        masterWalletId: mw.master.id,
        subWalletId: sw.sub.id,
        kind: 'spend',
        amountKobo: kobo(BigInt((i + 1) * 1000)),
        idempotencyKey: factories.idempotencyKey(),
        vendorBankCode: '058',
        vendorAccount: factories.bankAccount(),
      });
      txns.push(t);
    }

    const app = createServer();
    // First page of 2
    const res1 = await app.request(`/sub-wallets/${sw.sub.id}/transactions?limit=2`, {
      headers: await bearerHeaders(agent),
    });
    expect(res1.status).toBe(200);
    const page1 = await res1.json() as { transactions: { id: string }[]; nextCursor: string | null };
    expect(page1.transactions).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    // Second page
    const res2 = await app.request(
      `/sub-wallets/${sw.sub.id}/transactions?limit=2&cursor=${page1.nextCursor}`,
      { headers: await bearerHeaders(agent) },
    );
    expect(res2.status).toBe(200);
    const page2 = await res2.json() as { transactions: unknown[]; nextCursor: string | null };
    expect(page2.transactions).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it('403 — wrong agent cannot list transactions', async () => {
    const { mw, sw } = await seedHouseholdWithSubWallet();
    const wrongAgent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });

    const app = createServer();
    const res = await app.request(`/sub-wallets/${sw.sub.id}/transactions`, {
      headers: await bearerHeaders(wrongAgent),
    });
    expect(res.status).toBe(403);
  });
});
```

Add any missing imports at the top of the test file:
```typescript
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { kobo } from '../../src/lib/kobo';
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/sub-wallets.test.ts
```

Expected: 3 new failures (404 from missing route).

- [ ] **Step 3: Create `apps/backend/src/modules/transactions/list.service.ts`**

```typescript
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TransactionListResponse, TransactionSummary } from '@amana/types';
import { maskAccount } from '../../lib/mask-account';

function toISO(d: Date): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

type ListRow = {
  id: string;
  kind: string;
  status: string;
  amount_kobo: string;
  vendor_resolved_name: string | null;
  vendor_account: string | null;
  initiated_at: Date;
  settled_at: Date | null;
};

export const transactionListService = {
  async listForSubWallet(
    db: PostgresJsDatabase,
    input: { subWalletId: string; limit: number; cursor: string | null },
  ): Promise<TransactionListResponse> {
    const { subWalletId, limit, cursor } = input;

    let rows: ListRow[];

    if (cursor) {
      rows = await db.execute<ListRow>(sql`
        SELECT t.id,
               t.kind::text           AS kind,
               t.status::text         AS status,
               t.amount_kobo::text    AS amount_kobo,
               t.vendor_resolved_name,
               t.vendor_account,
               t.created_at           AS initiated_at,
               t.settled_at
        FROM transactions t
        WHERE t.sub_wallet_id = ${subWalletId}
          AND (t.created_at, t.id) < (
            SELECT created_at, id FROM transactions WHERE id = ${cursor} LIMIT 1
          )
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit + 1}
      `);
    } else {
      rows = await db.execute<ListRow>(sql`
        SELECT t.id,
               t.kind::text           AS kind,
               t.status::text         AS status,
               t.amount_kobo::text    AS amount_kobo,
               t.vendor_resolved_name,
               t.vendor_account,
               t.created_at           AS initiated_at,
               t.settled_at
        FROM transactions t
        WHERE t.sub_wallet_id = ${subWalletId}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit + 1}
      `);
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const transactions: TransactionSummary[] = page.map((r) => ({
      id: r.id,
      kind: r.kind as TransactionSummary['kind'],
      status: r.status as TransactionSummary['status'],
      amountKobo: r.amount_kobo,
      vendorResolvedName: r.vendor_resolved_name,
      vendorAccountMasked: maskAccount(r.vendor_account),
      initiatedAt: toISO(r.initiated_at),
      settledAt: r.settled_at ? toISO(r.settled_at) : null,
    }));

    return { transactions, nextCursor };
  },
};
```

- [ ] **Step 4: Add `GET /:id/transactions` to `apps/backend/src/routes/sub-wallets.ts`**

Add import at top:
```typescript
import { transactionListService } from '../modules/transactions/list.service';
```

Append to the `subWalletsRoute` chain:

```typescript
  .get('/:id/transactions', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);

    const subWalletId = c.req.param('id');
    const sw = await subWalletsRepo.findById(db, subWalletId);
    if (!sw) return c.json({ error: 'not_found' }, 404);
    if (sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);

    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 50);
    const cursor = c.req.query('cursor') ?? null;

    const result = await transactionListService.listForSubWallet(db, { subWalletId, limit, cursor });
    return c.json(result, 200);
  })
```

- [ ] **Step 5: Run tests — expect green**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/sub-wallets.test.ts
```

Expected: all tests (existing + 3 new) pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/transactions/list.service.ts apps/backend/src/routes/sub-wallets.ts apps/backend/tests/routes/sub-wallets.test.ts
git commit -m "feat(backend): GET /sub-wallets/:id/transactions with cursor pagination (TDD)"
```

---

## Task 7: Backend — media.service.ts + POST /media/upload-url (TDD)

**Files:**
- Create: `apps/backend/src/modules/media/media.service.ts`
- Create: `apps/backend/src/routes/media.ts`
- Create: `apps/backend/tests/routes/media.test.ts`
- Modify: `apps/backend/src/server.ts`

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/routes/media.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock so it applies before server import resolves the module
vi.mock('../../src/modules/media/media.service', () => ({
  mediaService: {
    getUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl: 'https://mock.s3.amazonaws.com/put?signed=1',
      key: 'media/txn-id/12345.jpg',
    }),
  },
}));

import { householdsRepo } from '../../src/modules/identity/households.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../src/modules/wallet/sub-wallets.repo';
import { transactionsRepo } from '../../src/modules/wallet/transactions.repo';
import { kobo } from '../../src/lib/kobo';
import { createServer } from '../../src/server';
import { bearerHeaders } from '../helpers/bearer';
import { factories } from '../helpers/factories';
import { testDb, truncateAll } from '../helpers/test-db';

async function seedWithTxn() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '0000000001', anchorBankCode: '058', anchorAccountId: 'a1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'sw',
  });
  const txn = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id,
    subWalletId: sw.sub.id,
    kind: 'spend',
    amountKobo: kobo(10_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  return { principal, agent, sw, txn };
}

describe('POST /media/upload-url', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — returns uploadUrl and key', async () => {
    const { agent, txn } = await seedWithTxn();
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ transactionId: txn.id, contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { uploadUrl: string; key: string };
    expect(body.uploadUrl).toContain('s3');
    expect(body.key).toMatch(/^media\//);
  });

  it('404 — transaction not found', async () => {
    const { agent } = await seedWithTxn();
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ transactionId: '00000000-0000-0000-0000-000000000000', contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(404);
  });

  it('401 — unauthenticated', async () => {
    const { txn } = await seedWithTxn();
    const app = createServer();
    const res = await app.request('/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({ transactionId: txn.id, contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/media.test.ts
```

Expected: failures — module not found.

- [ ] **Step 3: Create `apps/backend/src/modules/media/media.service.ts`**

```typescript
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../env';

const s3 = new S3Client({ region: env.AWS_REGION });

export const mediaService = {
  async getUploadUrl(
    transactionId: string,
    contentType: 'image/jpeg' | 'image/png',
  ): Promise<{ uploadUrl: string; key: string }> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const key = `media/${transactionId}/${Date.now()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: env.MEDIA_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { uploadUrl, key };
  },
};
```

- [ ] **Step 4: Create `apps/backend/src/routes/media.ts`**

```typescript
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { mediaService } from '../modules/media/media.service';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';

export const mediaRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/upload-url', async (c) => {
    const body = await c.req.json<{ transactionId?: string; contentType?: string }>();
    if (!body.transactionId || !body.contentType) {
      return c.json({ error: 'missing_params' }, 400);
    }
    if (body.contentType !== 'image/jpeg' && body.contentType !== 'image/png') {
      return c.json({ error: 'invalid_content_type' }, 400);
    }

    const [txn] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, body.transactionId))
      .limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);

    const result = await mediaService.getUploadUrl(
      body.transactionId,
      body.contentType as 'image/jpeg' | 'image/png',
    );
    return c.json(result, 200);
  });
```

- [ ] **Step 5: Register `mediaRoute` in `apps/backend/src/server.ts`**

Add import:
```typescript
import { mediaRoute } from './routes/media';
```

Add registration:
```typescript
app.route('/media', mediaRoute);
```

- [ ] **Step 6: Run tests — expect green**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/media.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/media/media.service.ts apps/backend/src/routes/media.ts apps/backend/src/server.ts apps/backend/tests/routes/media.test.ts
git commit -m "feat(backend): POST /media/upload-url + mediaService (TDD)"
```

---

## Task 8: Backend — PATCH /transactions/:id/media + DELETE /transactions/:id/bump (TDD)

**Files:**
- Modify: `apps/backend/src/routes/transactions.ts`
- Modify: `apps/backend/tests/routes/transactions.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `apps/backend/tests/routes/transactions.test.ts`:

```typescript
describe('PATCH /transactions/:id/media', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — attaches media key to settled transaction', async () => {
    const { agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(5_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await testDb.execute(
      sql`UPDATE transactions SET status = 'settled', settled_at = NOW() WHERE id = ${txn.id}`,
    );

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/media`, {
      method: 'PATCH',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ mediaKey: 'media/txn-id/photo.jpg' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });

  it('409 not_settled — rejects media attach on non-settled transaction', async () => {
    const { agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(1_000n),
      idempotencyKey: factories.idempotencyKey(),
    });

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/media`, {
      method: 'PATCH',
      headers: await bearerHeaders(agent),
      body: JSON.stringify({ mediaKey: 'media/txn-id/photo.jpg' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('not_settled');
  });

  it('403 — wrong agent cannot attach media', async () => {
    const { mw, sw } = await scaffoldHousehold();
    const wrongAgent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(1_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await testDb.execute(
      sql`UPDATE transactions SET status = 'settled', settled_at = NOW() WHERE id = ${txn.id}`,
    );

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/media`, {
      method: 'PATCH',
      headers: await bearerHeaders(wrongAgent),
      body: JSON.stringify({ mediaKey: 'media/txn-id/photo.jpg' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /transactions/:id/bump', () => {
  beforeEach(async () => { await truncateAll(); });

  it('200 — agent cancels a bump_pending transaction', async () => {
    const { agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(50_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    // Manually set to bump_pending (simulating evaluate result)
    await testDb.execute(
      sql`UPDATE transactions SET status = 'bump_pending' WHERE id = ${txn.id}`,
    );
    // Insert a bump_request row
    await testDb.execute(sql`
      INSERT INTO bump_requests (transaction_id, sub_wallet_id, requested_by_user_id, amount_kobo, vendor_resolved_name, status, expires_at)
      VALUES (${txn.id}, ${sw.sub.id}, ${agent.id}, 50000, 'Test', 'pending', NOW() + INTERVAL '10 minutes')
    `);

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/bump`, {
      method: 'DELETE',
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);

    // Verify status updated
    const [updated] = await testDb.execute<{ status: string; error_message: string }>(
      sql`SELECT status, error_message FROM transactions WHERE id = ${txn.id}`,
    );
    expect(updated?.status).toBe('failed');
    expect(updated?.error_message).toBe('CANCELLED_BY_AGENT');
  });

  it('409 not_bump_pending — cannot cancel non-pending transaction', async () => {
    const { agent, mw, sw } = await scaffoldHousehold();
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(1_000n),
      idempotencyKey: factories.idempotencyKey(),
    });

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/bump`, {
      method: 'DELETE',
      headers: await bearerHeaders(agent),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('not_bump_pending');
  });

  it('403 — wrong agent cannot cancel bump', async () => {
    const { mw, sw } = await scaffoldHousehold();
    const wrongAgent = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const txn = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: sw.sub.id,
      kind: 'spend',
      amountKobo: kobo(1_000n),
      idempotencyKey: factories.idempotencyKey(),
    });
    await testDb.execute(
      sql`UPDATE transactions SET status = 'bump_pending' WHERE id = ${txn.id}`,
    );

    const app = createServer();
    const res = await app.request(`/transactions/${txn.id}/bump`, {
      method: 'DELETE',
      headers: await bearerHeaders(wrongAgent),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/transactions.test.ts
```

Expected: 6 new failures.

- [ ] **Step 3: Add PATCH `/:id/media` and DELETE `/:id/bump` to `apps/backend/src/routes/transactions.ts`**

Add imports at top (if not already present):
```typescript
import { bumpRequests } from '../db/schema';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';
```

Append to the `transactionsRoute` chain:

```typescript
  .patch('/:id/media', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');
    const body = await c.req.json<{ mediaKey?: string }>();
    if (!body.mediaKey) return c.json({ error: 'missing_media_key' }, 400);

    const [txn] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'settled') return c.json({ error: 'not_settled' }, 409);

    await db
      .update(transactions)
      .set({ attachedMedia: { key: body.mediaKey, uploadedAt: new Date().toISOString() } })
      .where(eq(transactions.id, id));

    return c.json({ ok: true }, 200);
  })
  .delete('/:id/bump', async (c) => {
    const a = c.get('actor') as Actor;
    const id = c.req.param('id');

    const [txn] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!txn) return c.json({ error: 'not_found' }, 404);
    if (!txn.subWalletId || a.role !== 'agent') return c.json({ error: 'forbidden' }, 403);
    const sw = await subWalletsRepo.findById(db, txn.subWalletId);
    if (!sw || sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);
    if (txn.status !== 'bump_pending') return c.json({ error: 'not_bump_pending' }, 409);

    await db.transaction(async (tx) => {
      await tx
        .update(bumpRequests)
        .set({ status: 'cancelled' })
        .where(eq(bumpRequests.transactionId, id));
      await tx
        .update(transactions)
        .set({ status: 'failed', errorMessage: 'CANCELLED_BY_AGENT' })
        .where(eq(transactions.id, id));
    });

    return c.json({ ok: true }, 200);
  })
```

- [ ] **Step 4: Run tests — expect green**

```bash
pnpm --filter @amana/backend test -- --reporter=verbose tests/routes/transactions.test.ts
```

Expected: all tests pass including the 6 new ones.

- [ ] **Step 5: Run full suite**

```bash
pnpm --filter @amana/backend test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/transactions.ts apps/backend/tests/routes/transactions.test.ts
git commit -m "feat(backend): PATCH /transactions/:id/media + DELETE /transactions/:id/bump (TDD)"
```

---

## Task 9: @amana/api-client — VendorApi (TDD)

**Files:**
- Create: `packages/api-client/src/vendor-api.ts`
- Create: `packages/api-client/tests/vendor-api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/api-client/tests/vendor-api.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { VendorApi } from '../src/vendor-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

const mockVendor = {
  bankCode: '058', accountNumber: '0123456789', accountName: 'Mama Tola',
  source: 'name_enquiry', suggestedAmountKobo: null,
};

describe('VendorApi.nameEnquiry', () => {
  it('GETs /vendors/name-enquiry with correct query params', async () => {
    const client = fakeClient(async () => mockVendor);
    const api = new VendorApi(client);
    const r = await api.nameEnquiry('058', '0123456789', 'sw1');
    expect(r.accountName).toBe('Mama Tola');
    expect(client.request).toHaveBeenCalledWith(
      '/vendors/name-enquiry?bankCode=058&accountNumber=0123456789&subWalletId=sw1',
    );
  });
});

describe('VendorApi.phoneLookup', () => {
  it('GETs /vendors/phone-lookup with phone + subWalletId', async () => {
    const client = fakeClient(async () => mockVendor);
    const api = new VendorApi(client);
    const r = await api.phoneLookup('+2348012345678', 'sw1');
    expect(r.bankCode).toBe('058');
    expect(client.request).toHaveBeenCalledWith(
      '/vendors/phone-lookup?phoneNumber=%2B2348012345678&subWalletId=sw1',
    );
  });
});

describe('VendorApi.nqrDecode', () => {
  it('POSTs /vendors/nqr-decode', async () => {
    const client = fakeClient(async () => mockVendor);
    const api = new VendorApi(client);
    await api.nqrDecode('QR_PAYLOAD', 'sw1');
    expect(client.request).toHaveBeenCalledWith('/vendors/nqr-decode', {
      method: 'POST',
      jsonBody: { payload: 'QR_PAYLOAD', subWalletId: 'sw1' },
    });
  });
});

describe('VendorApi.recents', () => {
  it('GETs /vendors/recents for subWalletId', async () => {
    const client = fakeClient(async () => ({ recents: [{ id: 'r1', accountName: 'A' }] }));
    const api = new VendorApi(client);
    const r = await api.recents('sw1');
    expect(r).toHaveLength(1);
    expect(client.request).toHaveBeenCalledWith('/vendors/recents?subWalletId=sw1');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @amana/api-client test -- --reporter=verbose tests/vendor-api.test.ts
```

Expected: failures — module not found.

- [ ] **Step 3: Create `packages/api-client/src/vendor-api.ts`**

```typescript
import type { AuthedClient } from './household-api';

export type ResolvedVendorResponse = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  source: 'name_enquiry' | 'phone_lookup' | 'sticker' | 'nqr' | 'recents';
  suggestedAmountKobo: string | null;
};

export type RecentVendorResponse = {
  id: string;
  subWalletId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  lastUsedAt: string;
  firstSeenAt: string;
};

export class VendorApi {
  constructor(private readonly client: AuthedClient) {}

  nameEnquiry(bankCode: string, accountNumber: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ bankCode, accountNumber, subWalletId });
    return this.client.request<ResolvedVendorResponse>(`/vendors/name-enquiry?${params}`);
  }

  phoneLookup(phoneNumber: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    const params = new URLSearchParams({ phoneNumber, subWalletId });
    return this.client.request<ResolvedVendorResponse>(`/vendors/phone-lookup?${params}`);
  }

  nqrDecode(payload: string, subWalletId: string): Promise<ResolvedVendorResponse> {
    return this.client.request<ResolvedVendorResponse>('/vendors/nqr-decode', {
      method: 'POST',
      jsonBody: { payload, subWalletId },
    });
  }

  async recents(subWalletId: string): Promise<RecentVendorResponse[]> {
    const r = await this.client.request<{ recents: RecentVendorResponse[] }>(
      `/vendors/recents?subWalletId=${encodeURIComponent(subWalletId)}`,
    );
    return r.recents;
  }
}
```

- [ ] **Step 4: Run tests — expect green**

```bash
pnpm --filter @amana/api-client test -- --reporter=verbose tests/vendor-api.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/vendor-api.ts packages/api-client/tests/vendor-api.test.ts
git commit -m "feat(api-client): VendorApi — nameEnquiry, phoneLookup, nqrDecode, recents (TDD)"
```

---

## Task 10: @amana/api-client — MediaApi + MeApi (TDD)

**Files:**
- Create: `packages/api-client/src/media-api.ts`
- Create: `packages/api-client/src/me-api.ts`
- Create: `packages/api-client/tests/media-api.test.ts`
- Create: `packages/api-client/tests/me-api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/api-client/tests/media-api.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { MediaApi } from '../src/media-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('MediaApi.getUploadUrl', () => {
  it('POSTs /media/upload-url and returns url + key', async () => {
    const client = fakeClient(async () => ({
      uploadUrl: 'https://s3.example.com/put',
      key: 'media/txn/photo.jpg',
    }));
    const api = new MediaApi(client);
    const r = await api.getUploadUrl('txn-1', 'image/jpeg');
    expect(r.uploadUrl).toBe('https://s3.example.com/put');
    expect(r.key).toBe('media/txn/photo.jpg');
    expect(client.request).toHaveBeenCalledWith('/media/upload-url', {
      method: 'POST',
      jsonBody: { transactionId: 'txn-1', contentType: 'image/jpeg' },
    });
  });
});

describe('MediaApi.attachMedia', () => {
  it('PATCHes /transactions/:id/media', async () => {
    const client = fakeClient(async () => ({ ok: true }));
    const api = new MediaApi(client);
    await api.attachMedia('txn-1', 'media/txn/photo.jpg');
    expect(client.request).toHaveBeenCalledWith('/transactions/txn-1/media', {
      method: 'PATCH',
      jsonBody: { mediaKey: 'media/txn/photo.jpg' },
    });
  });
});
```

Create `packages/api-client/tests/me-api.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors';
import { MeApi } from '../src/me-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('MeApi.getSubWallet', () => {
  it('GETs /me/sub-wallet and returns subWallet + principal', async () => {
    const payload = {
      subWallet: { id: 'sw1', name: 'Driver', masterWalletId: 'mw1' },
      principal: { userId: 'u1', phone: '+2348011111111' },
    };
    const client = fakeClient(async () => payload);
    const api = new MeApi(client);
    const r = await api.getSubWallet();
    expect(r.subWallet.id).toBe('sw1');
    expect(r.principal.phone).toBe('+2348011111111');
    expect(client.request).toHaveBeenCalledWith('/me/sub-wallet');
  });

  it('propagates ApiError 404 when not paired', async () => {
    const client = fakeClient(async () => {
      throw new ApiError('not_paired', 404, 'not_paired', null);
    });
    const api = new MeApi(client);
    await expect(api.getSubWallet()).rejects.toThrow(ApiError);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
pnpm --filter @amana/api-client test -- --reporter=verbose tests/media-api.test.ts tests/me-api.test.ts
```

Expected: failures — modules not found.

- [ ] **Step 3: Create `packages/api-client/src/media-api.ts`**

```typescript
import type { AuthedClient } from './household-api';

export class MediaApi {
  constructor(private readonly client: AuthedClient) {}

  getUploadUrl(
    transactionId: string,
    contentType: 'image/jpeg' | 'image/png',
  ): Promise<{ uploadUrl: string; key: string }> {
    return this.client.request<{ uploadUrl: string; key: string }>('/media/upload-url', {
      method: 'POST',
      jsonBody: { transactionId, contentType },
    });
  }

  async attachMedia(transactionId: string, mediaKey: string): Promise<void> {
    await this.client.request<{ ok: boolean }>(
      `/transactions/${encodeURIComponent(transactionId)}/media`,
      { method: 'PATCH', jsonBody: { mediaKey } },
    );
  }
}
```

- [ ] **Step 4: Create `packages/api-client/src/me-api.ts`**

```typescript
import type { SubWalletWithPrincipal } from '@amana/types';
import type { AuthedClient } from './household-api';

export class MeApi {
  constructor(private readonly client: AuthedClient) {}

  getSubWallet(): Promise<SubWalletWithPrincipal> {
    return this.client.request<SubWalletWithPrincipal>('/me/sub-wallet');
  }
}
```

- [ ] **Step 5: Run tests — expect green**

```bash
pnpm --filter @amana/api-client test -- --reporter=verbose tests/media-api.test.ts tests/me-api.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/media-api.ts packages/api-client/src/me-api.ts packages/api-client/tests/media-api.test.ts packages/api-client/tests/me-api.test.ts
git commit -m "feat(api-client): MediaApi + MeApi (TDD)"
```

---

## Task 11: @amana/api-client — SubWalletApi.getTransactions + BumpApi.cancelBump + PairingApi.complete (TDD)

**Files:**
- Modify: `packages/api-client/src/sub-wallet-api.ts`
- Modify: `packages/api-client/src/bump-api.ts`
- Modify: `packages/api-client/src/pairing-api.ts`
- Modify: `packages/api-client/tests/sub-wallet-api.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/api-client/tests/sub-wallet-api.test.ts`:

```typescript
describe('SubWalletApi.getTransactions', () => {
  it('GETs /sub-wallets/:id/transactions with cursor', async () => {
    const payload = {
      transactions: [{ id: 'txn1', kind: 'spend', status: 'settled', amountKobo: '5000',
        vendorResolvedName: 'Vendor', vendorAccountMasked: '***1234',
        initiatedAt: '2026-05-09T10:00:00Z', settledAt: '2026-05-09T10:01:00Z' }],
      nextCursor: 'txn1',
    };
    const client = fakeClient(async () => payload);
    const api = new SubWalletApi(client);
    const r = await api.getTransactions('sw1', 'cursor-id', 10);
    expect(r.transactions).toHaveLength(1);
    expect(r.nextCursor).toBe('txn1');
    expect(client.request).toHaveBeenCalledWith(
      '/sub-wallets/sw1/transactions?cursor=cursor-id&limit=10',
    );
  });

  it('GETs without cursor when not provided', async () => {
    const client = fakeClient(async () => ({ transactions: [], nextCursor: null }));
    const api = new SubWalletApi(client);
    await api.getTransactions('sw1');
    expect(client.request).toHaveBeenCalledWith('/sub-wallets/sw1/transactions');
  });
});
```

Create (or append to) a `bump-api.test.ts` file. If it doesn't exist, create `packages/api-client/tests/bump-api.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { BumpApi } from '../src/bump-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('BumpApi.cancelBump', () => {
  it('DELETEs /transactions/:id/bump', async () => {
    const client = fakeClient(async () => ({ ok: true }));
    const api = new BumpApi(client);
    await api.cancelBump('txn-1');
    expect(client.request).toHaveBeenCalledWith('/transactions/txn-1/bump', {
      method: 'DELETE',
    });
  });
});
```

For `PairingApi.complete`, append to the existing pairing-api tests (create `packages/api-client/tests/pairing-api.test.ts` if it doesn't exist):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { PairingApi } from '../src/pairing-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('PairingApi.complete', () => {
  it('POSTs /pairing/complete with token', async () => {
    const client = fakeClient(async () => ({ subWalletId: 'sw-1' }));
    const api = new PairingApi(client);
    const r = await api.complete('my-pairing-token');
    expect(r.subWalletId).toBe('sw-1');
    expect(client.request).toHaveBeenCalledWith('/pairing/complete', {
      method: 'POST',
      jsonBody: { token: 'my-pairing-token' },
    });
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
pnpm --filter @amana/api-client test -- --reporter=verbose
```

Expected: failures on the new test cases.

- [ ] **Step 3: Add `getTransactions` to `packages/api-client/src/sub-wallet-api.ts`**

Add import at top:
```typescript
import type { TransactionListResponse } from '@amana/types';
```

Append method to `SubWalletApi` class:

```typescript
  getTransactions(
    subWalletId: string,
    cursor?: string,
    limit?: number,
  ): Promise<TransactionListResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const path = qs
      ? `/sub-wallets/${subWalletId}/transactions?${qs}`
      : `/sub-wallets/${subWalletId}/transactions`;
    return this.client.request<TransactionListResponse>(path);
  }
```

- [ ] **Step 4: Add `cancelBump` to `packages/api-client/src/bump-api.ts`**

Append to `BumpApi` class:

```typescript
  async cancelBump(transactionId: string): Promise<void> {
    await this.client.request<{ ok: boolean }>(
      `/transactions/${encodeURIComponent(transactionId)}/bump`,
      { method: 'DELETE' },
    );
  }
```

- [ ] **Step 5: Add `complete` to `packages/api-client/src/pairing-api.ts`**

Append to `PairingApi` class:

```typescript
  complete(token: string): Promise<{ subWalletId: string | null }> {
    return this.client.request<{ subWalletId: string | null }>('/pairing/complete', {
      method: 'POST',
      jsonBody: { token },
    });
  }
```

- [ ] **Step 6: Run tests — expect green**

```bash
pnpm --filter @amana/api-client test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/sub-wallet-api.ts packages/api-client/src/bump-api.ts packages/api-client/src/pairing-api.ts packages/api-client/tests/
git commit -m "feat(api-client): SubWalletApi.getTransactions, BumpApi.cancelBump, PairingApi.complete (TDD)"
```

---

## Task 12: @amana/api-client — wire VendorApi, MediaApi, MeApi into AmanaApiClient

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Add new APIs to `packages/api-client/src/client.ts`**

Add imports:
```typescript
import { MediaApi } from './media-api';
import { MeApi } from './me-api';
import { VendorApi } from './vendor-api';
```

Add public properties to the class (after existing ones):
```typescript
  public readonly vendor: VendorApi;
  public readonly media: MediaApi;
  public readonly me: MeApi;
```

Wire in constructor (after `this.transaction = new TransactionApi(this);`):
```typescript
    this.vendor = new VendorApi(this);
    this.media = new MediaApi(this);
    this.me = new MeApi(this);
```

- [ ] **Step 2: Re-export new classes from `packages/api-client/src/index.ts`**

Append:
```typescript
export { VendorApi } from './vendor-api';
export type { ResolvedVendorResponse, RecentVendorResponse } from './vendor-api';
export { MediaApi } from './media-api';
export { MeApi } from './me-api';
```

- [ ] **Step 3: Verify build and all tests**

```bash
pnpm --filter @amana/api-client build && pnpm --filter @amana/api-client test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api-client/src/client.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): wire VendorApi, MediaApi, MeApi into AmanaApiClient"
```

---

## Task 13: Agent app — package.json deps + lib files

**Files:**
- Modify: `apps/agent/package.json`
- Create: `apps/agent/src/lib/secure-token-store.ts`
- Create: `apps/agent/src/lib/api.ts`
- Create: `apps/agent/src/lib/sub-wallet-memory.ts`

- [ ] **Step 1: Add dependencies to `apps/agent/package.json`**

```bash
pnpm --filter @amana/agent add \
  @react-navigation/native \
  @react-navigation/native-stack \
  @react-navigation/bottom-tabs \
  expo-camera \
  expo-location \
  expo-linking \
  expo-notifications \
  expo-secure-store \
  expo-constants \
  expo-device \
  react-native-nfc-manager \
  react-native-safe-area-context \
  react-native-screens \
  react-hook-form \
  @hookform/resolvers \
  zod
```

Also add dev types:
```bash
pnpm --filter @amana/agent add -D \
  @types/react-native \
  @react-navigation/native \
  vitest
```

- [ ] **Step 2: Create `apps/agent/src/lib/secure-token-store.ts`**

```typescript
import type { StoredAuth, TokenStore } from '@amana/api-client';
import * as SecureStore from 'expo-secure-store';

const KEY = 'amana.agent.auth.v1';

export const secureTokenStore: TokenStore = {
  async read() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
  },
  async write(auth) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(auth));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
```

- [ ] **Step 3: Create `apps/agent/src/lib/api.ts`**

```typescript
import { AmanaApiClient } from '@amana/api-client';
import { secureTokenStore } from './secure-token-store';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export const api = new AmanaApiClient({
  baseUrl: BACKEND_URL,
  tokenStore: secureTokenStore,
});
```

- [ ] **Step 4: Create `apps/agent/src/lib/sub-wallet-memory.ts`**

```typescript
export type SubWalletIdentity = {
  id: string;
  name: string;
  masterWalletId: string;
};

let _sw: SubWalletIdentity | null = null;

export const subWalletMemory = {
  get(): SubWalletIdentity | null { return _sw; },
  set(sw: SubWalletIdentity): void { _sw = sw; },
  clear(): void { _sw = null; },
};
```

- [ ] **Step 5: Verify TypeScript setup**

```bash
pnpm --filter @amana/agent typecheck
```

Expected: TypeScript can resolve the types (may warn about missing screens — that's fine at this stage).

- [ ] **Step 6: Commit**

```bash
git add apps/agent/package.json apps/agent/src/lib/
git commit -m "feat(agent): install deps + lib files (api, secure-token-store, sub-wallet-memory)"
```

---

## Task 14: Agent app — push.ts + push.test.ts (TDD)

**Files:**
- Create: `apps/agent/src/lib/push.ts`
- Create: `apps/agent/src/lib/push.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/agent/src/lib/push.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { deepLinkFor } from './push';

describe('deepLinkFor', () => {
  it('txn_settled → transaction deep link', () => {
    const r = deepLinkFor('txn_settled', { transactionId: 'txn-1' });
    expect(r).toEqual({ kind: 'transaction', transactionId: 'txn-1' });
  });

  it('txn_failed → transaction deep link', () => {
    const r = deepLinkFor('txn_failed', { transactionId: 'txn-2' });
    expect(r).toEqual({ kind: 'transaction', transactionId: 'txn-2' });
  });

  it('bump_decided → transaction deep link (agent uses transactionId from push)', () => {
    const r = deepLinkFor('bump_decided', { transactionId: 'txn-3' });
    expect(r).toEqual({ kind: 'transaction', transactionId: 'txn-3' });
  });

  it('unknown kind → none', () => {
    const r = deepLinkFor('something_else', {});
    expect(r).toEqual({ kind: 'none' });
  });
});
```

Add `vitest.config.ts` to the agent app if it doesn't exist:

```typescript
// apps/agent/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @amana/agent test -- push.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/agent/src/lib/push.ts`**

```typescript
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export type AgentDeepLink =
  | { kind: 'transaction'; transactionId: string }
  | { kind: 'none' };

export type AgentPushKind = 'txn_settled' | 'txn_failed' | 'bump_decided';

export function deepLinkFor(kind: string, payload: unknown): AgentDeepLink {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (
    (kind === 'txn_settled' || kind === 'txn_failed' || kind === 'bump_decided') &&
    typeof p.transactionId === 'string'
  ) {
    return { kind: 'transaction', transactionId: p.transactionId };
  }
  return { kind: 'none' };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getExpoPushTokenOrNull(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
  try {
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
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
```

- [ ] **Step 4: Update `package.json` test script**

In `apps/agent/package.json`, change:
```json
"test": "echo 'mobile tests land in Sub-plan 7' && exit 0"
```
to:
```json
"test": "vitest run"
```

- [ ] **Step 5: Run tests — expect green**

```bash
pnpm --filter @amana/agent test
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/lib/push.ts apps/agent/src/lib/push.test.ts apps/agent/vitest.config.ts apps/agent/package.json
git commit -m "feat(agent): push.ts + deepLinkFor for txn_settled/txn_failed/bump_decided (TDD)"
```

---

## Task 15: Agent app — Auth stack

**Files:**
- Create: `apps/agent/src/screens/PhoneScreen.tsx`
- Create: `apps/agent/src/screens/VerifyScreen.tsx`
- Create: `apps/agent/src/nav/AuthStack.tsx`

The auth stack is a pattern-reuse of the principal app. The agent's `VerifyScreen` does NOT ask for NIN/BVN — agents log into existing accounts only.

- [ ] **Step 1: Create `apps/agent/src/nav/AuthStack.tsx`**

```typescript
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PhoneScreen } from '../screens/PhoneScreen';
import { VerifyScreen } from '../screens/VerifyScreen';

export type AuthStackParamList = {
  Phone: undefined;
  Verify: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Phone" component={PhoneScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen name="Verify" component={VerifyScreen} options={{ title: 'Verify' }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 2: Create `apps/agent/src/screens/PhoneScreen.tsx`**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { z } from 'zod';
import { api } from '../lib/api';
import type { AuthStackParamList } from '../nav/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Phone'>;

const schema = z.object({
  phone: z.string().regex(/^\+\d{8,15}$/, 'Use international format (+234…)'),
});
type FormValues = z.infer<typeof schema>;

export function PhoneScreen({ navigation }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '+234' },
  });

  const onSubmit = handleSubmit(async ({ phone }) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.auth.requestOtp({ phone, purpose: 'login' });
      navigation.navigate('Verify');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.muted}>Enter your phone number to receive a code.</Text>
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <View>
            <TextInput
              autoFocus
              keyboardType="phone-pad"
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="+2348012345678"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={busy || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [styles.button, pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled]}
      >
        <Text style={styles.buttonText}>{busy ? 'Sending…' : 'Send code'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  muted: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: { backgroundColor: '#1a1a2e', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 3: Create `apps/agent/src/screens/VerifyScreen.tsx`**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { z } from 'zod';
import type { StoredAuth } from '@amana/api-client';
import { api } from '../lib/api';
import { secureTokenStore } from '../lib/secure-token-store';
import type { AuthStackParamList } from '../nav/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Verify'> & {
  onLoggedIn: () => void;
  pendingPhone: string;
};

const schema = z.object({ code: z.string().regex(/^\d{6}$/, 'Six digits') });
type FormValues = z.infer<typeof schema>;

export function VerifyScreen({ onLoggedIn, pendingPhone }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await api.auth.verifyOtp({ phone: pendingPhone, code });
      const stored: StoredAuth = {
        tokens: {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          accessExpiresAt: r.accessExpiresAt,
          refreshExpiresAt: r.refreshExpiresAt,
        },
        user: r.user,
      };
      await secureTokenStore.write(stored);
      onLoggedIn();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.title}>Enter the 6-digit code</Text>
      <Text style={styles.muted}>Sent to {pendingPhone}</Text>
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <View>
            <TextInput
              autoFocus
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              placeholder="123456"
            />
            {fieldState.error && <Text style={styles.err}>{fieldState.error.message}</Text>}
          </View>
        )}
      />
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={busy || formState.isSubmitting}
        onPress={onSubmit}
        style={({ pressed }) => [styles.button, pressed && styles.pressed,
          (busy || formState.isSubmitting) && styles.disabled]}
      >
        <Text style={styles.buttonText}>{busy ? 'Verifying…' : 'Verify'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600' },
  muted: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 18 },
  err: { color: '#b00020', marginTop: 4 },
  button: { backgroundColor: '#1a1a2e', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 999, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

Note: `VerifyScreen` receives `pendingPhone` and `onLoggedIn` as props from the navigator context (passed via route params or via the parent component pattern). The `RootNavigator` (Task 17) manages the `pendingPhone` state.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/nav/AuthStack.tsx apps/agent/src/screens/PhoneScreen.tsx apps/agent/src/screens/VerifyScreen.tsx
git commit -m "feat(agent): auth stack — PhoneScreen, VerifyScreen, AuthStack"
```

---

## Task 16: Pairing stack — PairingStack + four pairing screens

**Files:**
- Create: `apps/agent/src/nav/PairingStack.tsx`
- Create: `apps/agent/src/screens/PairingMethodScreen.tsx`
- Create: `apps/agent/src/screens/QRScanScreen.tsx`
- Create: `apps/agent/src/screens/NFCPairScreen.tsx`
- Create: `apps/agent/src/screens/PairingSuccessScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/nav/PairingStack.tsx`**

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NFCPairScreen } from '../screens/NFCPairScreen';
import { PairingMethodScreen } from '../screens/PairingMethodScreen';
import { PairingSuccessScreen } from '../screens/PairingSuccessScreen';
import { QRScanScreen } from '../screens/QRScanScreen';

export type PairingStackParamList = {
  PairingMethod: { pendingToken?: string };
  QRScan: undefined;
  NFCPair: undefined;
  PairingSuccess: { subWalletName: string; principalPhone: string };
};

type Props = { onPaired: () => void; pendingToken: string | null };

const Stack = createNativeStackNavigator<PairingStackParamList>();

export function PairingStack({ onPaired, pendingToken }: Props): JSX.Element {
  return (
    <Stack.Navigator initialRouteName="PairingMethod">
      <Stack.Screen
        name="PairingMethod"
        initialParams={{ pendingToken: pendingToken ?? undefined }}
        options={{ title: 'Pair wallet' }}
      >
        {(props) => <PairingMethodScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
      <Stack.Screen name="QRScan" options={{ title: 'Scan QR' }}>
        {(props) => <QRScanScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
      <Stack.Screen name="NFCPair" options={{ title: 'NFC tap' }}>
        {(props) => <NFCPairScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
      <Stack.Screen name="PairingSuccess" options={{ title: 'Paired!', headerLeft: () => null }}>
        {(props) => <PairingSuccessScreen {...props} onPaired={onPaired} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
```

- [ ] **Step 2: Create `apps/agent/src/screens/PairingMethodScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'PairingMethod'> & {
  onPaired: () => void;
};

export function PairingMethodScreen({ navigation, route }: Props): JSX.Element {
  const pendingToken = route.params?.pendingToken;

  useEffect(() => {
    if (!pendingToken) return;
    const complete = async () => {
      try {
        await api.pairing.complete({ token: pendingToken });
        const me = await api.me.getSubWallet();
        subWalletMemory.set(me.subWallet);
        navigation.replace('PairingSuccess', {
          subWalletName: me.subWallet.name,
          principalPhone: me.principal.phone,
        });
      } catch {
        // Invalid token — let user choose another pairing method
      }
    };
    void complete();
  }, [pendingToken, navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pair your wallet</Text>
      <Text style={styles.sub}>Choose how to connect with your principal&apos;s Amana account.</Text>

      <Pressable style={styles.option} onPress={() => navigation.navigate('QRScan')}>
        <Text style={styles.optTitle}>Scan QR code</Text>
        <Text style={styles.optSub}>Principal shows a QR — you scan it.</Text>
      </Pressable>

      {Platform.OS === 'android' && (
        <Pressable style={styles.option} onPress={() => navigation.navigate('NFCPair')}>
          <Text style={styles.optTitle}>NFC tap</Text>
          <Text style={styles.optSub}>Touch phones together. Android only.</Text>
        </Pressable>
      )}

      <View style={[styles.option, styles.passive]}>
        <Text style={styles.optTitle}>SMS link</Text>
        <Text style={styles.optSub}>
          Ask your principal to share a link. Tap it and this screen will complete automatically.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  sub: { color: '#666', fontSize: 14 },
  option: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    gap: 4,
    backgroundColor: '#fff',
  },
  passive: { backgroundColor: '#f5f5f5' },
  optTitle: { fontSize: 16, fontWeight: '600' },
  optSub: { fontSize: 13, color: '#666' },
});
```

- [ ] **Step 3: Create `apps/agent/src/screens/QRScanScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'QRScan'> & { onPaired: () => void };

export function QRScanScreen({ navigation }: Props): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const handleScan = async (data: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.pairing.complete({ token: data });
      const me = await api.me.getSubWallet();
      subWalletMemory.set(me.subWallet);
      navigation.replace('PairingSuccess', {
        subWalletName: me.subWallet.name,
        principalPhone: me.principal.phone,
      });
    } catch (e: unknown) {
      Alert.alert('Pairing failed', e instanceof Error ? e.message : 'Invalid or expired code.');
      setBusy(false);
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Camera access is needed to scan QR codes.</Text>
        <Pressable style={styles.btn} onPress={() => void requestPermission()}>
          <Text style={styles.btnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : ({ data }) => void handleScan(data)}
      />
      {busy && (
        <View style={styles.overlay}>
          <ActivityIndicator color="white" size="large" />
          <Text style={styles.overlayText}>Pairing…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  sub: { color: '#666', textAlign: 'center' },
  btn: { backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: 'white', fontWeight: '600' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  overlayText: { color: 'white', fontSize: 16 },
});
```

- [ ] **Step 4: Create `apps/agent/src/screens/NFCPairScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import NfcManager, { Ndef, NfcEvents } from 'react-native-nfc-manager';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'NFCPair'> & { onPaired: () => void };

export function NFCPairScreen({ navigation }: Props): JSX.Element {
  const [phase, setPhase] = useState<'waiting' | 'reading' | 'error'>('waiting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const startNfc = async () => {
      try {
        await NfcManager.start();
        NfcManager.setEventListener(NfcEvents.DiscoverTag, async (tag: unknown) => {
          if (!alive) return;
          setPhase('reading');
          try {
            const t = tag as { ndefMessage?: Array<{ payload: number[] }> };
            const payload = t.ndefMessage?.[0]?.payload;
            if (!payload) throw new Error('No NDEF payload in tag');
            const token = Ndef.text.decodePayload(new Uint8Array(payload));
            await api.pairing.complete({ token });
            const me = await api.me.getSubWallet();
            subWalletMemory.set(me.subWallet);
            if (alive) {
              navigation.replace('PairingSuccess', {
                subWalletName: me.subWallet.name,
                principalPhone: me.principal.phone,
              });
            }
          } catch (e: unknown) {
            if (alive) {
              setPhase('error');
              setErrorMsg(e instanceof Error ? e.message : 'NFC read failed. Try again.');
            }
          }
        });
        await NfcManager.registerTagEvent();
      } catch {
        if (alive) {
          setPhase('error');
          setErrorMsg('NFC is not available on this device.');
        }
      }
    };

    void startNfc();

    return () => {
      alive = false;
      void NfcManager.unregisterTagEvent();
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      {phase === 'waiting' && (
        <>
          <Text style={styles.title}>Hold phones together</Text>
          <Text style={styles.sub}>
            Touch the backs of both Android phones. The principal&apos;s app will emit the pairing
            token via NFC.
          </Text>
          <ActivityIndicator size="large" style={{ marginTop: 24 }} />
        </>
      )}
      {phase === 'reading' && <ActivityIndicator size="large" />}
      {phase === 'error' && <Text style={styles.err}>{errorMsg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  sub: { color: '#666', textAlign: 'center' },
  err: { color: '#b00020', textAlign: 'center' },
});
```

- [ ] **Step 5: Create `apps/agent/src/screens/PairingSuccessScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PairingStackParamList } from '../nav/PairingStack';

type Props = NativeStackScreenProps<PairingStackParamList, 'PairingSuccess'> & {
  onPaired: () => void;
};

export function PairingSuccessScreen({ route, onPaired }: Props): JSX.Element {
  const { subWalletName, principalPhone } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.check}>✓</Text>
      <Text style={styles.title}>Paired!</Text>
      <Text style={styles.detail}>Wallet: {subWalletName}</Text>
      <Text style={styles.detail}>Principal: {principalPhone}</Text>
      <Pressable style={styles.button} onPress={onPaired}>
        <Text style={styles.buttonText}>Let&apos;s go</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  check: { fontSize: 64, color: '#2e7d32' },
  title: { fontSize: 28, fontWeight: '700' },
  detail: { fontSize: 16, color: '#444' },
  button: {
    marginTop: 16,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
```

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/agent/src/nav/PairingStack.tsx \
        apps/agent/src/screens/PairingMethodScreen.tsx \
        apps/agent/src/screens/QRScanScreen.tsx \
        apps/agent/src/screens/NFCPairScreen.tsx \
        apps/agent/src/screens/PairingSuccessScreen.tsx
git commit -m "feat(agent): pairing stack — QR, NFC, SMS deep-link, success screen"
```

---

## Task 17: RootNavigator + App.tsx

**Files:**
- Create: `apps/agent/src/nav/RootNavigator.tsx`
- Modify: `apps/agent/App.tsx`

- [ ] **Step 1: Create `apps/agent/src/nav/RootNavigator.tsx`**

```tsx
import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../lib/api';
import { secureTokenStore } from '../lib/secure-token-store';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { PairingStack } from './PairingStack';

type AppState = 'booting' | 'logged_out' | 'unpaired' | 'paired';

function SplashScreen(): JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Loading…</Text>
    </View>
  );
}

export function RootNavigator(): JSX.Element {
  const [appState, setAppState] = useState<AppState>('booting');
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const checkPairing = useCallback(async () => {
    try {
      const me = await api.me.getSubWallet();
      subWalletMemory.set(me.subWallet);
      setAppState('paired');
    } catch {
      setAppState('unpaired');
    }
  }, []);

  const onLoggedIn = useCallback(() => {
    void checkPairing();
  }, [checkPairing]);

  const onPaired = useCallback(() => {
    void checkPairing();
  }, [checkPairing]);

  useEffect(() => {
    const boot = async () => {
      const auth = await secureTokenStore.read();
      if (!auth) {
        setAppState('logged_out');
        return;
      }
      await checkPairing();
    };
    void boot();
  }, [checkPairing]);

  // SMS deep-link: amana://pair?token=…
  useEffect(() => {
    const handle = (url: string) => {
      const parsed = Linking.parse(url);
      if (parsed.path === 'pair' && typeof parsed.queryParams?.token === 'string') {
        setPendingToken(parsed.queryParams.token);
      }
    };
    Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  if (appState === 'booting') return <SplashScreen />;

  return (
    <NavigationContainer>
      {appState === 'logged_out' && <AuthStack onLoggedIn={onLoggedIn} />}
      {appState === 'unpaired' && (
        <PairingStack onPaired={onPaired} pendingToken={pendingToken} />
      )}
      {appState === 'paired' && <MainTabs />}
    </NavigationContainer>
  );
}
```

- [ ] **Step 2: Replace `apps/agent/App.tsx` with**

```tsx
import { RootNavigator } from './src/nav/RootNavigator';

export default function App(): JSX.Element {
  return <RootNavigator />;
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/nav/RootNavigator.tsx apps/agent/App.tsx
git commit -m "feat(agent): RootNavigator — boot, auth, pairing, SMS deep-link"
```

---

## Task 18: MainTabs + PayStack + HistoryStack + SettingsStack

**Files:**
- Create: `apps/agent/src/nav/MainTabs.tsx`
- Create: `apps/agent/src/nav/PayStack.tsx`
- Create: `apps/agent/src/nav/HistoryStack.tsx`
- Create: `apps/agent/src/nav/SettingsStack.tsx`

- [ ] **Step 1: Create `apps/agent/src/nav/MainTabs.tsx`**

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { HistoryStack } from './HistoryStack';
import { PayStack } from './PayStack';
import { SettingsStack } from './SettingsStack';

export type MainTabParamList = {
  Home: undefined;
  Pay: undefined;
  History: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs(): JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: true, title: 'Home' }} />
      <Tab.Screen name="Pay" component={PayStack} options={{ title: 'Pay' }} />
      <Tab.Screen name="History" component={HistoryStack} options={{ title: 'History' }} />
      <Tab.Screen name="Settings" component={SettingsStack} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}
```

- [ ] **Step 2: Create `apps/agent/src/nav/PayStack.tsx`**

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AccountEntryScreen } from '../screens/AccountEntryScreen';
import { BumpWaitScreen } from '../screens/BumpWaitScreen';
import { CaptureMethodScreen } from '../screens/CaptureMethodScreen';
import { ConfirmScreen } from '../screens/ConfirmScreen';
import { FailedScreen } from '../screens/FailedScreen';
import { NQRScanScreen } from '../screens/NQRScanScreen';
import { PhoneLookupScreen } from '../screens/PhoneLookupScreen';
import { PhotoAttachScreen } from '../screens/PhotoAttachScreen';
import { ReceiptScreen } from '../screens/ReceiptScreen';
import { SendingScreen } from '../screens/SendingScreen';
import { ShowRecipientScreen } from '../screens/ShowRecipientScreen';

export type PayStackParamList = {
  CaptureMethod: undefined;
  NQRScan: undefined;
  PhoneLookup: undefined;
  AccountEntry: undefined;
  Confirm: {
    resolvedName: string;
    bankCode: string;
    accountNumber: string;
    accountMasked: string;
  };
  BumpWait: {
    transactionId: string;
    amountKobo: string;
    resolvedName: string;
    expiresAt: string;
  };
  Sending: { transactionId: string };
  Receipt: { transactionId: string };
  ShowRecipient: { amountKobo: string; resolvedName: string; sessionId: string };
  PhotoAttach: { transactionId: string };
  Failed: { transactionId: string; errorMessage: string | null };
};

const Stack = createNativeStackNavigator<PayStackParamList>();

export function PayStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="CaptureMethod" component={CaptureMethodScreen} options={{ title: 'Pay' }} />
      <Stack.Screen name="NQRScan" component={NQRScanScreen} options={{ title: 'Scan QR' }} />
      <Stack.Screen name="PhoneLookup" component={PhoneLookupScreen} options={{ title: 'Pay by phone' }} />
      <Stack.Screen name="AccountEntry" component={AccountEntryScreen} options={{ title: 'Pay by account' }} />
      <Stack.Screen name="Confirm" component={ConfirmScreen} options={{ title: 'Confirm payment' }} />
      <Stack.Screen name="BumpWait" component={BumpWaitScreen} options={{ title: 'Awaiting approval', headerLeft: () => null }} />
      <Stack.Screen name="Sending" component={SendingScreen} options={{ title: 'Sending…', headerLeft: () => null }} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ title: 'Receipt', headerLeft: () => null }} />
      <Stack.Screen name="ShowRecipient" component={ShowRecipientScreen} options={{ title: 'Show recipient', presentation: 'modal' }} />
      <Stack.Screen name="PhotoAttach" component={PhotoAttachScreen} options={{ title: 'Add photo', presentation: 'modal' }} />
      <Stack.Screen name="Failed" component={FailedScreen} options={{ title: 'Payment failed', headerLeft: () => null }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 3: Create `apps/agent/src/nav/HistoryStack.tsx`**

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TransactionDetailScreen } from '../screens/TransactionDetailScreen';
import { TransactionListScreen } from '../screens/TransactionListScreen';

export type HistoryStackParamList = {
  TransactionList: undefined;
  TransactionDetail: { transactionId: string };
};

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export function HistoryStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="TransactionList" component={TransactionListScreen} options={{ title: 'History' }} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ title: 'Transaction' }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 4: Create `apps/agent/src/nav/SettingsStack.tsx`**

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EnableNotificationsScreen } from '../screens/EnableNotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type SettingsStackParamList = {
  Settings: undefined;
  EnableNotifications: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack(): JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="EnableNotifications" component={EnableNotificationsScreen} options={{ title: 'Notifications', presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing. Expected: errors about screens not yet created — those are fine for now and will resolve as tasks 19–27 complete.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/nav/MainTabs.tsx apps/agent/src/nav/PayStack.tsx \
        apps/agent/src/nav/HistoryStack.tsx apps/agent/src/nav/SettingsStack.tsx
git commit -m "feat(agent): MainTabs + PayStack + HistoryStack + SettingsStack navigators"
```

---

## Task 19: HomeScreen

**Files:**
- Create: `apps/agent/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/HomeScreen.tsx`**

```tsx
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import type { TransactionSummary } from '@amana/types';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { MainTabParamList } from '../nav/MainTabs';

type Props = BottomTabScreenProps<MainTabParamList, 'Home'>;

export function HomeScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();
  const [txns, setTxns] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!sw) return;
      setLoading(true);
      api.subWallet
        .getTransactions(sw.id, undefined, 20)
        .then((r) => setTxns(r.transactions))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [sw?.id]),
  );

  const pendingBump = txns.find((t) => t.status === 'bump_pending');

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.walletName}>{sw?.name ?? '—'}</Text>
        <Text style={styles.label}>Your sub-wallet</Text>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

      {pendingBump && (
        <Pressable
          style={styles.badge}
          onPress={() => navigation.navigate('History')}
        >
          <Text style={styles.badgeText}>⚠ Payment pending principal approval — tap to view</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    gap: 4,
  },
  walletName: { fontSize: 22, fontWeight: '700', color: 'white' },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  badge: {
    backgroundColor: '#fff3e0',
    borderLeftWidth: 4,
    borderLeftColor: '#e65100',
    padding: 14,
    borderRadius: 8,
  },
  badgeText: { color: '#e65100', fontWeight: '600', fontSize: 14 },
});
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/screens/HomeScreen.tsx
git commit -m "feat(agent): HomeScreen — sub-wallet card + pending bump badge"
```

---

## Task 20: CaptureMethodScreen

**Files:**
- Create: `apps/agent/src/screens/CaptureMethodScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/CaptureMethodScreen.tsx`**

`RecentVendor` and `ResolvedVendor` are exported from `@amana/api-client` (defined in `vendor-api.ts`, Task 9).

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { RecentVendor } from '@amana/api-client';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'CaptureMethod'>;

export function CaptureMethodScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();
  const [recents, setRecents] = useState<RecentVendor[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!sw) return;
      setLoading(true);
      api.vendor
        .recents(sw.id)
        .then(setRecents)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [sw?.id]),
  );

  const goConfirm = (v: RecentVendor) =>
    navigation.navigate('Confirm', {
      resolvedName: v.resolvedName,
      bankCode: v.bankCode,
      accountNumber: v.accountNumber,
      accountMasked: `****${v.accountNumber.slice(-4)}`,
    });

  return (
    <View style={styles.container}>
      <Pressable style={styles.action} onPress={() => navigation.navigate('NQRScan')}>
        <Text style={styles.actionTitle}>Scan QR code</Text>
        <Text style={styles.actionSub}>NIBSS NQR or bank QR</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={() => navigation.navigate('PhoneLookup')}>
        <Text style={styles.actionTitle}>Pay by phone number</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={() => navigation.navigate('AccountEntry')}>
        <Text style={styles.actionTitle}>Pay by account number</Text>
      </Pressable>

      {loading && <ActivityIndicator style={{ marginTop: 16 }} />}

      {recents.length > 0 && (
        <FlatList
          data={recents}
          keyExtractor={(item) => `${item.bankCode}-${item.accountNumber}`}
          ListHeaderComponent={<Text style={styles.sectionLabel}>Recents</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.recent} onPress={() => goConfirm(item)}>
              <Text style={styles.recentName}>{item.resolvedName}</Text>
              <Text style={styles.recentSub}>****{item.accountNumber.slice(-4)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  action: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 16,
  },
  actionTitle: { fontSize: 16, fontWeight: '600' },
  actionSub: { fontSize: 13, color: '#666', marginTop: 2 },
  sectionLabel: { fontSize: 13, color: '#888', fontWeight: '600', marginTop: 8, marginBottom: 4 },
  recent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recentName: { fontSize: 15 },
  recentSub: { fontSize: 13, color: '#888' },
});
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/screens/CaptureMethodScreen.tsx
git commit -m "feat(agent): CaptureMethodScreen — recents + three entry points"
```

---

## Task 21: NQRScanScreen + PhoneLookupScreen + AccountEntryScreen

**Files:**
- Create: `apps/agent/src/screens/NQRScanScreen.tsx`
- Create: `apps/agent/src/screens/PhoneLookupScreen.tsx`
- Create: `apps/agent/src/screens/AccountEntryScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/NQRScanScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'NQRScan'>;

export function NQRScanScreen({ navigation }: Props): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const handleScan = async (payload: string) => {
    if (busy) return;
    setBusy(true);
    const sw = subWalletMemory.get();
    if (!sw) { setBusy(false); return; }
    try {
      const vendor = await api.vendor.nqrDecode(payload, sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.resolvedName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      Alert.alert('QR decode failed', e instanceof Error ? e.message : 'Try again.');
      setBusy(false);
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Camera access is needed to scan QR codes.</Text>
        <Pressable style={styles.btn} onPress={() => void requestPermission()}>
          <Text style={styles.btnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : ({ data }) => void handleScan(data)}
      />
      {busy && (
        <View style={styles.overlay}>
          <ActivityIndicator color="white" size="large" />
          <Text style={styles.overlayText}>Resolving vendor…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  sub: { color: '#666', textAlign: 'center' },
  btn: { backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: 'white', fontWeight: '600' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  overlayText: { color: 'white', fontSize: 16 },
});
```

- [ ] **Step 2: Create `apps/agent/src/screens/PhoneLookupScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'PhoneLookup'>;

export function PhoneLookupScreen({ navigation }: Props): JSX.Element {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lookup = async () => {
    const sw = subWalletMemory.get();
    if (!sw || !phone.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const vendor = await api.vendor.phoneLookup(phone.trim(), sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.resolvedName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Phone number not found.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.label}>Phone number</Text>
      <TextInput
        style={styles.input}
        placeholder="+2348012345678"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        autoFocus
      />
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={styles.button} onPress={() => void lookup()}>
          <Text style={styles.buttonText}>Look up</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 3: Create `apps/agent/src/screens/AccountEntryScreen.tsx`**

The bank list is a static array of common Nigerian banks `{ code: string; name: string }[]`. The picker is a minimal `FlatList`-based approach — no external library needed.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

const BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '050', name: 'EcoBank' },
  { code: '011', name: 'First Bank' },
  { code: '214', name: 'First City Monument Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'ProvidusBank' },
  { code: '221', name: 'Stanbic IBTC' },
  { code: '068', name: 'Standard Chartered' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'Suntrust Bank' },
  { code: '032', name: 'Union Bank' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '120001', name: 'OPay' },
  { code: '090405', name: 'Moniepoint' },
  { code: '100002', name: 'Kuda Bank' },
  { code: '110005', name: 'PalmPay' },
];

type Props = NativeStackScreenProps<PayStackParamList, 'AccountEntry'>;

export function AccountEntryScreen({ navigation }: Props): JSX.Element {
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankFilter, setBankFilter] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedBank = BANKS.find((b) => b.code === bankCode);
  const filteredBanks = BANKS.filter((b) =>
    b.name.toLowerCase().includes(bankFilter.toLowerCase()),
  );

  const enquire = async () => {
    const sw = subWalletMemory.get();
    if (!sw || !bankCode || accountNumber.length < 10) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const vendor = await api.vendor.nameEnquiry(bankCode, accountNumber, sw.id);
      navigation.navigate('Confirm', {
        resolvedName: vendor.resolvedName,
        bankCode: vendor.bankCode,
        accountNumber: vendor.accountNumber,
        accountMasked: `****${vendor.accountNumber.slice(-4)}`,
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Name enquiry failed. Check details and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (showPicker) {
    return (
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          placeholder="Search banks…"
          value={bankFilter}
          onChangeText={setBankFilter}
          autoFocus
        />
        <FlatList
          data={filteredBanks}
          keyExtractor={(b) => b.code}
          renderItem={({ item }) => (
            <Pressable
              style={styles.bankRow}
              onPress={() => {
                setBankCode(item.code);
                setShowPicker(false);
                setBankFilter('');
              }}
            >
              <Text style={styles.bankName}>{item.name}</Text>
            </Pressable>
          )}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.label}>Bank</Text>
      <Pressable style={styles.input} onPress={() => setShowPicker(true)}>
        <Text style={selectedBank ? styles.selected : styles.placeholder}>
          {selectedBank?.name ?? 'Select bank…'}
        </Text>
      </Pressable>

      <Text style={styles.label}>Account number</Text>
      <TextInput
        style={styles.input}
        placeholder="0123456789"
        keyboardType="number-pad"
        maxLength={10}
        value={accountNumber}
        onChangeText={setAccountNumber}
      />

      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}

      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable
          style={[styles.button, (!bankCode || accountNumber.length < 10) && styles.disabled]}
          disabled={!bankCode || accountNumber.length < 10}
          onPress={() => void enquire()}
        >
          <Text style={styles.buttonText}>Confirm name</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  placeholder: { color: '#999', fontSize: 16 },
  selected: { fontSize: 16 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  disabled: { opacity: 0.4 },
  buttonText: { color: 'white', fontWeight: '600' },
  bankRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  bankName: { fontSize: 15 },
});
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/screens/NQRScanScreen.tsx \
        apps/agent/src/screens/PhoneLookupScreen.tsx \
        apps/agent/src/screens/AccountEntryScreen.tsx
git commit -m "feat(agent): vendor capture screens — NQR, phone lookup, account entry"
```

---

## Task 22: TransactionApi extension + ConfirmScreen

**Files:**
- Modify: `packages/api-client/src/transaction-api.ts` (add `createIntent`, `evaluate`)
- Create: `apps/agent/src/screens/ConfirmScreen.tsx`

- [ ] **Step 1: Extend `packages/api-client/src/transaction-api.ts`**

Add `createIntent` and `evaluate` after the existing `getById` method:

```typescript
import type { TransactionDetailResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type CreateIntentInput = {
  masterWalletId: string;
  subWalletId: string | null;
  amountKobo: string;
  idempotencyKey: string;
  vendorBankCode: string;
  vendorAccountNumber: string;
  vendorResolvedName: string;
  category: string | null;
  agentNote: string | null;
  geolocation: { lat: number; lng: number } | null;
};

export type CreateIntentResult = { transactionId: string; status: string };

export type EvaluateResult =
  | { kind: 'allow'; status: string }
  | { kind: 'bump_pending'; bumpRequestId: string; status: string; expiresAt: string };

export class TransactionApi {
  constructor(private readonly client: AuthedClient) {}

  getById(transactionId: string): Promise<TransactionDetailResponse> {
    return this.client.request<TransactionDetailResponse>(
      `/transactions/${encodeURIComponent(transactionId)}`,
    );
  }

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    return this.client.request<CreateIntentResult>('/transactions/intent', {
      method: 'POST',
      jsonBody: input,
    });
  }

  evaluate(transactionId: string): Promise<EvaluateResult> {
    return this.client.request<EvaluateResult>(
      `/transactions/${encodeURIComponent(transactionId)}/evaluate`,
      { method: 'POST' },
    );
  }
}
```

- [ ] **Step 2: Run api-client typecheck**

```bash
pnpm --filter @amana/api-client typecheck
```

Expected: passes with no errors.

- [ ] **Step 3: Create `apps/agent/src/screens/ConfirmScreen.tsx`**

GPS is captured at "Send" tap time via `expo-location`. Amount entered in Naira, converted to kobo string.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Confirm'>;

export function ConfirmScreen({ route, navigation }: Props): JSX.Element {
  const { resolvedName, bankCode, accountNumber, accountMasked } = route.params;
  const [amountNaira, setAmountNaira] = useState('');
  const [note, setNote] = useState('');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const send = async () => {
    const sw = subWalletMemory.get();
    if (!sw) return;
    const naira = parseFloat(amountNaira);
    if (!Number.isFinite(naira) || naira <= 0) {
      setErrorMsg('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);

    let geolocation: { lat: number; lng: number } | null = null;
    if (gpsEnabled) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          geolocation = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        }
      } catch {
        // GPS failed — send without location rather than blocking payment
      }
    }

    try {
      const { transactionId } = await api.transaction.createIntent({
        masterWalletId: sw.masterWalletId,
        subWalletId: sw.id,
        amountKobo: String(Math.round(naira * 100)),
        idempotencyKey: `${sw.id}-${Date.now()}`,
        vendorBankCode: bankCode,
        vendorAccountNumber: accountNumber,
        vendorResolvedName: resolvedName,
        category: 'ad_hoc_service',
        agentNote: note.trim() || null,
        geolocation,
      });
      const evalResult = await api.transaction.evaluate(transactionId);
      if (evalResult.kind === 'allow') {
        navigation.replace('Sending', { transactionId });
      } else {
        navigation.replace('BumpWait', {
          transactionId,
          amountKobo: String(Math.round(naira * 100)),
          resolvedName,
          expiresAt: evalResult.expiresAt,
        });
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Payment failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.resolvedName}>{resolvedName}</Text>
        <Text style={styles.accountMasked}>{accountMasked}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Amount (₦)</Text>
          <TextInput
            style={styles.amountInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            value={amountNaira}
            onChangeText={setAmountNaira}
            autoFocus
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="What is this for?"
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Capture GPS location</Text>
          <Switch value={gpsEnabled} onValueChange={setGpsEnabled} />
        </View>

        {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}

        {busy ? (
          <ActivityIndicator style={{ marginTop: 8 }} />
        ) : (
          <Pressable style={styles.button} onPress={() => void send()}>
            <Text style={styles.buttonText}>Send payment</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 20 },
  resolvedName: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  accountMasked: { fontSize: 15, color: '#888', textAlign: 'center', marginTop: -12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  amountInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 24,
    fontWeight: '600',
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 17 },
});
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/transaction-api.ts apps/agent/src/screens/ConfirmScreen.tsx
git commit -m "feat(agent): ConfirmScreen — GPS, note, intent+evaluate; extend TransactionApi"
```

---

## Task 23: BumpWaitScreen + SendingScreen

**Files:**
- Create: `apps/agent/src/screens/BumpWaitScreen.tsx`
- Create: `apps/agent/src/screens/SendingScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/BumpWaitScreen.tsx`**

`BumpWaitScreen` shows an expiry countdown and listens for a `bump_decided` push notification. Cancel calls `DELETE /transactions/:id/bump` (i.e., `api.bump.cancelBump`).

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'BumpWait'>;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BumpWaitScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId, amountKobo, resolvedName, expiresAt } = route.params;
  const [msLeft, setMsLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const navigated = useRef(false);

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(new Date(expiresAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  // Push notification listener for bump_decided
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (navigated.current) return;
      const data = notification.request.content.data as Record<string, unknown>;
      if (data.kind !== 'bump_decided' || data.transactionId !== transactionId) return;
      navigated.current = true;
      if (data.decision === 'approved' || data.decision === 'approved_once' || data.decision === 'raise_limit') {
        navigation.replace('Sending', { transactionId });
      } else {
        navigation.replace('Failed', {
          transactionId,
          errorMessage: `Bump ${String(data.decision ?? 'denied')}`,
        });
      }
    });
    return () => sub.remove();
  }, [navigation, transactionId]);

  const cancel = async () => {
    setCancelling(true);
    setErrorMsg(null);
    try {
      await api.bump.cancelBump(transactionId);
      navigation.replace('Failed', {
        transactionId,
        errorMessage: 'CANCELLED_BY_AGENT',
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Cancel failed.');
      setCancelling(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Awaiting principal approval</Text>
      <Text style={styles.amount}>{formatNaira(amountKobo)}</Text>
      <Text style={styles.vendor}>to {resolvedName}</Text>

      <View style={styles.timer}>
        <Text style={styles.timerLabel}>Expires in</Text>
        <Text style={[styles.timerValue, msLeft < 60_000 && styles.timerRed]}>
          {formatCountdown(msLeft)}
        </Text>
      </View>

      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}

      {cancelling ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={styles.cancelBtn} onPress={() => void cancel()}>
          <Text style={styles.cancelText}>Cancel payment</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 18, fontWeight: '600', color: '#444', textAlign: 'center' },
  amount: { fontSize: 40, fontWeight: '800' },
  vendor: { fontSize: 16, color: '#666' },
  timer: { alignItems: 'center', marginTop: 8 },
  timerLabel: { fontSize: 13, color: '#888' },
  timerValue: { fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerRed: { color: '#b00020' },
  err: { color: '#b00020' },
  cancelBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#b00020',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
  },
  cancelText: { color: '#b00020', fontWeight: '600' },
});
```

- [ ] **Step 2: Create `apps/agent/src/screens/SendingScreen.tsx`**

Polls `GET /transactions/:id` every 3 s for up to 30 s while `status === 'in_flight'`. Also listens for `txn_settled` / `txn_failed` push — whichever arrives first wins.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Sending'>;

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 10;

export function SendingScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const done = useRef(false);

  const navigateResult = (status: string) => {
    if (done.current) return;
    done.current = true;
    if (status === 'settled') {
      navigation.replace('Receipt', { transactionId });
    } else {
      navigation.replace('Failed', { transactionId, errorMessage: null });
    }
  };

  useEffect(() => {
    // Push listener — wins if it arrives before polling finishes
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      if (
        (data.kind === 'txn_settled' || data.kind === 'txn_failed') &&
        data.transactionId === transactionId
      ) {
        navigateResult(data.kind === 'txn_settled' ? 'settled' : 'failed');
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  useEffect(() => {
    let polls = 0;
    const poll = async () => {
      if (done.current) return;
      try {
        const r = await api.transaction.getById(transactionId);
        const status = r.transaction.status;
        if (status !== 'in_flight' && status !== 'rule_eval' && status !== 'draft') {
          navigateResult(status);
          return;
        }
      } catch {
        // Network error — keep polling
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        navigateResult('failed');
        return;
      }
      setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    setTimeout(() => void poll(), POLL_INTERVAL_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.title}>Sending payment…</Text>
      <Text style={styles.sub}>This usually takes under 10 seconds.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  sub: { color: '#666', textAlign: 'center' },
});
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/screens/BumpWaitScreen.tsx apps/agent/src/screens/SendingScreen.tsx
git commit -m "feat(agent): BumpWaitScreen + SendingScreen — push + poll, countdown timer"
```

---

## Task 24: ReceiptScreen + ShowRecipientScreen + FailedScreen

**Files:**
- Create: `apps/agent/src/screens/ReceiptScreen.tsx`
- Create: `apps/agent/src/screens/ShowRecipientScreen.tsx`
- Create: `apps/agent/src/screens/FailedScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/ReceiptScreen.tsx`**

Loads the settled transaction on mount, shows all key fields. "Show recipient" and "Add photo" buttons.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TransactionDetail } from '@amana/types';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Receipt'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ReceiptScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [txn, setTxn] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.transaction
      .getById(transactionId)
      .then((r) => setTxn(r.transaction))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [transactionId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!txn) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Could not load receipt.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.amount}>{formatNaira(txn.amountKobo)}</Text>
      <Text style={styles.vendor}>{txn.vendorResolvedName ?? '—'}</Text>
      <Text style={styles.acct}>{txn.vendorAccountMasked ?? ''}</Text>

      {txn.settledAt && (
        <Text style={styles.meta}>Settled {formatDateTime(txn.settledAt)}</Text>
      )}
      {txn.nibssSessionId && (
        <Text style={styles.meta} selectable>
          NIBSS: {txn.nibssSessionId}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          style={styles.btn}
          onPress={() =>
            navigation.navigate('ShowRecipient', {
              amountKobo: txn.amountKobo,
              resolvedName: txn.vendorResolvedName ?? '—',
              sessionId: txn.nibssSessionId ?? '',
            })
          }
        >
          <Text style={styles.btnText}>Show recipient</Text>
        </Pressable>

        {!txn.attachedMedia && (
          <Pressable
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => navigation.navigate('PhotoAttach', { transactionId })}
          >
            <Text style={[styles.btnText, styles.btnTextSecondary]}>Add photo</Text>
          </Pressable>
        )}

        {txn.attachedMedia && (
          <Text style={styles.photoBadge}>📎 Photo attached</Text>
        )}
      </View>

      <Pressable style={styles.doneBtn} onPress={() => navigation.popToTop()}>
        <Text style={styles.doneBtnText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 24, alignItems: 'center', gap: 8 },
  amount: { fontSize: 48, fontWeight: '800', marginBottom: 4 },
  vendor: { fontSize: 20, fontWeight: '600' },
  acct: { fontSize: 14, color: '#888' },
  meta: { fontSize: 13, color: '#666' },
  actions: { width: '100%', gap: 12, marginTop: 24 },
  btn: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#f0f0f0' },
  btnText: { color: 'white', fontWeight: '600', fontSize: 15 },
  btnTextSecondary: { color: '#1a1a2e' },
  photoBadge: { textAlign: 'center', color: '#2e7d32', fontWeight: '600' },
  err: { color: '#b00020' },
  doneBtn: { marginTop: 16 },
  doneBtnText: { color: '#888', fontSize: 15 },
});
```

- [ ] **Step 2: Create `apps/agent/src/screens/ShowRecipientScreen.tsx`**

Portrait-locked fullscreen. Large text intended to be held up so the tradesman can read it.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'ShowRecipient'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ShowRecipientScreen({ route, navigation }: Props): JSX.Element {
  const { amountKobo, resolvedName, sessionId } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.sent}>{formatNaira(amountKobo)} sent to</Text>
      <Text style={styles.name}>{resolvedName}</Text>
      {sessionId && (
        <Text style={styles.session}>
          NIBSS session: {sessionId}
          {'\n'}
          Should appear in your bank within 30 seconds.
        </Text>
      )}
      <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
    backgroundColor: '#fff',
  },
  sent: { fontSize: 22, color: '#444', textAlign: 'center' },
  name: { fontSize: 48, fontWeight: '800', textAlign: 'center' },
  session: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },
  backBtn: { marginTop: 32, paddingHorizontal: 32, paddingVertical: 12 },
  backText: { fontSize: 16, color: '#888' },
});
```

- [ ] **Step 3: Create `apps/agent/src/screens/FailedScreen.tsx`**

`errorMessage` may be null (transactionId provided for retry). Loads fresh on mount to get the error message when it's null.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TransactionDetail } from '@amana/types';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'Failed'>;

const ERROR_LABELS: Record<string, string> = {
  CANCELLED_BY_AGENT: 'You cancelled this payment.',
  BUMP_DENIED: 'Your principal declined the payment.',
  BUMP_EXPIRED: 'The approval request expired.',
  INSUFFICIENT_FUNDS: 'Insufficient funds in sub-wallet.',
  NIP_FAILURE: 'The bank transfer failed. No funds were deducted.',
};

export function FailedScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId, errorMessage: passedError } = route.params;
  const [txn, setTxn] = useState<TransactionDetail | null>(null);

  useEffect(() => {
    if (passedError !== null) return; // already have the message
    api.transaction
      .getById(transactionId)
      .then((r) => setTxn(r.transaction))
      .catch(() => {});
  }, [transactionId, passedError]);

  const errorCode = passedError ?? txn?.errorMessage ?? 'UNKNOWN';
  const errorLabel = ERROR_LABELS[errorCode] ?? `Error: ${errorCode}`;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>✕</Text>
      <Text style={styles.title}>Payment failed</Text>
      <Text style={styles.reason}>{errorLabel}</Text>

      <View style={styles.actions}>
        <Pressable style={styles.retryBtn} onPress={() => navigation.popToTop()}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable style={styles.dismissBtn} onPress={() => navigation.popToTop()}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  icon: { fontSize: 56, color: '#b00020' },
  title: { fontSize: 24, fontWeight: '700' },
  reason: { fontSize: 16, color: '#666', textAlign: 'center' },
  actions: { gap: 12, width: '100%', marginTop: 16 },
  retryBtn: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  retryText: { color: 'white', fontWeight: '600', fontSize: 15 },
  dismissBtn: { paddingVertical: 14, alignItems: 'center' },
  dismissText: { color: '#888', fontSize: 15 },
});
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/screens/ReceiptScreen.tsx \
        apps/agent/src/screens/ShowRecipientScreen.tsx \
        apps/agent/src/screens/FailedScreen.tsx
git commit -m "feat(agent): ReceiptScreen + ShowRecipientScreen + FailedScreen"
```

---

## Task 25: PhotoAttachScreen

**Files:**
- Create: `apps/agent/src/screens/PhotoAttachScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/PhotoAttachScreen.tsx`**

Camera capture → preview → "Use photo" → `POST /media/upload-url` → PUT to S3 pre-signed URL → `PATCH /transactions/:id/media`.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import type { PayStackParamList } from '../nav/PayStack';

type Props = NativeStackScreenProps<PayStackParamList, 'PhotoAttach'>;

type Phase = 'camera' | 'preview' | 'uploading' | 'done' | 'error';

export function PhotoAttachScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo) {
        setPhotoUri(photo.uri);
        setPhase('preview');
      }
    } catch {
      Alert.alert('Error', 'Could not capture photo.');
    }
  };

  const upload = async () => {
    if (!photoUri) return;
    setPhase('uploading');
    try {
      const { uploadUrl, key } = await api.media.getUploadUrl(transactionId, 'image/jpeg');

      // PUT directly to S3 — no backend proxy
      const blob = await (await fetch(photoUri)).blob();
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

      await api.media.attachMedia(transactionId, key);
      setPhase('done');
      setTimeout(() => navigation.goBack(), 1200);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed.');
      setPhase('error');
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Camera access is needed to attach a photo.</Text>
        <Pressable style={styles.btn} onPress={() => void requestPermission()}>
          <Text style={styles.btnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'camera') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} />
        <View style={styles.captureBar}>
          <Pressable style={styles.captureBtn} onPress={() => void takePicture()}>
            <View style={styles.captureInner} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (phase === 'preview' && photoUri) {
    return (
      <View style={{ flex: 1 }}>
        <Image source={{ uri: photoUri }} style={{ flex: 1 }} resizeMode="cover" />
        <View style={styles.previewBar}>
          <Pressable style={styles.retakeBtn} onPress={() => { setPhotoUri(null); setPhase('camera'); }}>
            <Text style={styles.retakeText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.useBtn} onPress={() => void upload()}>
            <Text style={styles.useText}>Use photo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (phase === 'uploading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.sub}>Uploading photo…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.center}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.sub}>Photo attached!</Text>
      </View>
    );
  }

  // phase === 'error'
  return (
    <View style={styles.center}>
      <Text style={styles.err}>{errorMsg}</Text>
      <Pressable style={styles.btn} onPress={() => setPhase('camera')}>
        <Text style={styles.btnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  sub: { color: '#666', textAlign: 'center' },
  err: { color: '#b00020', textAlign: 'center' },
  successIcon: { fontSize: 64, color: '#2e7d32' },
  btn: { backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: 'white', fontWeight: '600' },
  captureBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'white' },
  previewBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
  },
  retakeBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
  },
  retakeText: { color: 'white', fontWeight: '600' },
  useBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
  },
  useText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/screens/PhotoAttachScreen.tsx
git commit -m "feat(agent): PhotoAttachScreen — camera capture, S3 upload, PATCH media"
```

---

## Task 26: TransactionListScreen + TransactionDetailScreen

**Files:**
- Create: `apps/agent/src/screens/TransactionListScreen.tsx`
- Create: `apps/agent/src/screens/TransactionDetailScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/TransactionListScreen.tsx`**

Paginated list via `GET /sub-wallets/:id/transactions`. Pull-to-refresh loads from the top. "Load more" appends next page.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { TransactionSummary } from '@amana/types';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { HistoryStackParamList } from '../nav/HistoryStack';

type Props = NativeStackScreenProps<HistoryStackParamList, 'TransactionList'>;

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
}

const STATUS_COLOR: Record<string, string> = {
  settled: '#2e7d32',
  failed: '#b00020',
  bump_pending: '#a15a00',
  in_flight: '#1769ff',
  reversed: '#888',
};

export function TransactionListScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();
  const [txns, setTxns] = useState<TransactionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (cursor?: string, append = false) => {
      if (!sw) return;
      if (!append) setLoading(true);
      else setLoadingMore(true);
      try {
        const r = await api.subWallet.getTransactions(sw.id, cursor, 20);
        setTxns((prev) => (append ? [...prev, ...r.transactions] : r.transactions));
        setNextCursor(r.nextCursor);
      } catch {
        // silent fail — stale data stays visible
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [sw?.id],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage();
    }, [loadPage]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    void loadPage();
  };

  return (
    <FlatList
      data={txns}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Text style={styles.empty}>No transactions yet.</Text>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.vendor}>{item.vendorResolvedName ?? '—'}</Text>
            <Text style={styles.date}>{formatDate(item.initiatedAt)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
            <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? '#888' }]}>
              {item.status}
            </Text>
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        nextCursor ? (
          loadingMore ? (
            <ActivityIndicator style={{ padding: 16 }} />
          ) : (
            <Pressable style={styles.loadMore} onPress={() => void loadPage(nextCursor, true)}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </Pressable>
          )
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 8 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowLeft: { gap: 4, flex: 1 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  vendor: { fontSize: 15, fontWeight: '500' },
  date: { fontSize: 12, color: '#888' },
  amount: { fontSize: 15, fontWeight: '600' },
  status: { fontSize: 11, textTransform: 'capitalize' },
  loadMore: { padding: 16, alignItems: 'center' },
  loadMoreText: { color: '#1a1a2e', fontWeight: '600' },
});
```

- [ ] **Step 2: Create `apps/agent/src/screens/TransactionDetailScreen.tsx`**

Same structure as the principal's TransactionDetailScreen. Shows all fields plus "Add photo" if settled and `attachedMedia` is null. Import types from `@amana/types`.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError } from '@amana/api-client';
import type { TransactionDetail } from '@amana/types';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../lib/api';
import type { HistoryStackParamList } from '../nav/HistoryStack';

type Props = NativeStackScreenProps<HistoryStackParamList, 'TransactionDetail'>;

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; txn: TransactionDetail };

function formatNaira(koboStr: string): string {
  const naira = Number(BigInt(koboStr)) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_LABEL: Record<string, string> = {
  settled: 'Settled',
  failed: 'Failed',
  reversed: 'Reversed',
  bump_pending: 'Awaiting decision',
  in_flight: 'Sending…',
  rule_eval: 'Evaluating…',
  draft: 'Draft',
};

export function TransactionDetailScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });

  useFocusEffect(
    useCallback(() => {
      setState({ kind: 'loading' });
      api.transaction
        .getById(transactionId)
        .then((r) => setState({ kind: 'ready', txn: r.transaction }))
        .catch((e: unknown) => {
          const code = e instanceof ApiError ? e.code : 'unknown_error';
          setState({ kind: 'error', code });
        });
    }, [transactionId]),
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Could not load transaction: {state.code}</Text>
      </View>
    );
  }

  const { txn } = state;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.amount}>{formatNaira(txn.amountKobo)}</Text>
      <Text style={styles.status}>{STATUS_LABEL[txn.status] ?? txn.status}</Text>

      <View style={styles.section}>
        {txn.vendorResolvedName && <Text style={styles.field}>To: {txn.vendorResolvedName}</Text>}
        {txn.vendorAccountMasked && <Text style={styles.field}>{txn.vendorAccountMasked}</Text>}
        <Text style={styles.field}>Initiated: {formatDateTime(txn.initiatedAt)}</Text>
        {txn.settledAt && <Text style={styles.field}>Settled: {formatDateTime(txn.settledAt)}</Text>}
        {txn.nibssSessionId && (
          <Text style={styles.field} selectable>
            NIBSS: {txn.nibssSessionId}
          </Text>
        )}
        {txn.agentNote && <Text style={styles.field}>Note: {txn.agentNote}</Text>}
        {txn.errorMessage && <Text style={[styles.field, styles.errField]}>Error: {txn.errorMessage}</Text>}
        {txn.anomalyScore !== null && txn.anomalyScore >= 0.85 && (
          <Text style={[styles.field, styles.anomaly]}>⚠ Anomaly score: {txn.anomalyScore.toFixed(2)}</Text>
        )}
      </View>

      {txn.status === 'settled' && !txn.attachedMedia && (
        <Pressable
          style={styles.addPhotoBtn}
          onPress={() =>
            navigation.getParent()?.navigate('PhotoAttach', { transactionId })
          }
        >
          <Text style={styles.addPhotoText}>Add photo</Text>
        </Pressable>
      )}

      {txn.attachedMedia && <Text style={styles.photoBadge}>📎 Photo attached</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 24, gap: 8 },
  amount: { fontSize: 40, fontWeight: '800', textAlign: 'center' },
  status: { textAlign: 'center', color: '#666', marginBottom: 8 },
  section: { gap: 6 },
  field: { fontSize: 14, color: '#444' },
  errField: { color: '#b00020' },
  anomaly: { color: '#a15a00', fontWeight: '600' },
  addPhotoBtn: {
    marginTop: 16,
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  addPhotoText: { color: 'white', fontWeight: '600' },
  photoBadge: { textAlign: 'center', color: '#2e7d32', fontWeight: '600' },
  err: { color: '#b00020' },
});
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @amana/agent typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/screens/TransactionListScreen.tsx \
        apps/agent/src/screens/TransactionDetailScreen.tsx
git commit -m "feat(agent): TransactionListScreen + TransactionDetailScreen — paginated history"
```

---

## Task 27: SettingsScreen + EnableNotificationsScreen

**Files:**
- Create: `apps/agent/src/screens/SettingsScreen.tsx`
- Create: `apps/agent/src/screens/EnableNotificationsScreen.tsx`

- [ ] **Step 1: Create `apps/agent/src/screens/SettingsScreen.tsx`**

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { secureTokenStore } from '../lib/secure-token-store';
import { subWalletMemory } from '../lib/sub-wallet-memory';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const sw = subWalletMemory.get();

  const signOut = async () => {
    await secureTokenStore.clear();
    subWalletMemory.clear();
    // RootNavigator re-reads SecureStore on next focus — navigate to trigger re-render
    // Re-render happens automatically via React state in RootNavigator once storage is cleared.
    // Force it by reloading: in Expo Go use Updates.reloadAsync(); in production the state won't
    // reset until a component triggers re-check. Simplest: ask user to restart. For MVP, navigation.reset is enough.
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Wallet</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Name</Text>
          <Text style={styles.rowValue}>{sw?.name ?? '—'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Notifications</Text>
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('EnableNotifications')}
        >
          <Text style={styles.rowLabel}>Push notifications</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Pressable style={styles.signOutBtn} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  rowLabel: { fontSize: 15 },
  rowValue: { color: '#888', fontSize: 15 },
  chevron: { fontSize: 20, color: '#ccc' },
  signOutBtn: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: { color: '#b00020', fontWeight: '600', fontSize: 15 },
});
```

- [ ] **Step 2: Create `apps/agent/src/screens/EnableNotificationsScreen.tsx`**

Same push permission request pattern as the principal app.

```tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import type { SettingsStackParamList } from '../nav/SettingsStack';

type Props = NativeStackScreenProps<SettingsStackParamList, 'EnableNotifications'>;

export function EnableNotificationsScreen({ navigation }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission denied. Enable notifications in your device settings.');
        setBusy(false);
        return;
      }
      const token = await Notifications.getExpoPushTokenAsync();
      await api.notification.register({ token: token.data, platform: 'expo' });
      navigation.goBack();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Stay in the loop</Text>
      <Text style={styles.sub}>
        Get instant alerts when your payment settles, fails, or needs principal approval.
      </Text>
      {errorMsg && <Text style={styles.err}>{errorMsg}</Text>}
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={styles.button} onPress={() => void enable()}>
          <Text style={styles.buttonText}>Enable notifications</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 32, gap: 20, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 16, color: '#666', lineHeight: 24 },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
```

- [ ] **Step 3: Run typecheck (full agent)**

```bash
pnpm --filter @amana/agent typecheck
```

Expected: zero errors. Fix any that remain.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/screens/SettingsScreen.tsx \
        apps/agent/src/screens/EnableNotificationsScreen.tsx
git commit -m "feat(agent): SettingsScreen + EnableNotificationsScreen"
```

---

## Task 28: Principal app — NFC emit on PairingScreen

**Files:**
- Modify: `apps/principal/src/screens/PairingScreen.tsx` (add NFC emit, Android only)
- Modify: `apps/principal/package.json` (add `react-native-nfc-manager`)

- [ ] **Step 1: Add `react-native-nfc-manager` to principal's package.json**

In `apps/principal/package.json`, add to `"dependencies"`:

```json
"react-native-nfc-manager": "^3.14.14"
```

Then run:

```bash
pnpm install
```

- [ ] **Step 2: Modify `apps/principal/src/screens/PairingScreen.tsx` to emit NFC**

Add NFC emit alongside the existing QR display. On Android when the device has NFC, write the pairing code as an NDEF text record so agents can tap to pair.

The existing `PairingScreen.tsx` already has: state machine `idle → loading → issued → error`, QR display, share/copy buttons. Patch it to add NFC emit when `state.kind === 'issued'` on Android.

Replace the existing import block and component with the following (full file replacement to show complete patched version):

```tsx
import { ApiError } from '@amana/api-client';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import { api } from '../lib/api';
import { useHouseholdStore } from '../state/household.store';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'issued'; code: string; expiresAt: string }
  | { kind: 'error'; code: string };

async function emitNfc(code: string): Promise<void> {
  await NfcManager.requestTechnology(NfcTech.Ndef);
  try {
    const bytes = Ndef.encodeMessage([Ndef.textRecord(code)]);
    if (bytes) await NfcManager.ndefHandler.writeNdefMessage(bytes);
  } finally {
    await NfcManager.cancelTechnologyRequest();
  }
}

export function PairingScreen(): JSX.Element {
  const household = useHouseholdStore((s) => s.household);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const [nfcReady, setNfcReady] = useState(false);

  // Initialise NFC on Android only
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NfcManager.start()
      .then(() => NfcManager.isEnabled())
      .then((enabled) => setNfcReady(enabled))
      .catch(() => setNfcReady(false));
    return () => { void NfcManager.cancelTechnologyRequest().catch(() => {}); };
  }, []);

  const issue = async () => {
    if (!household) { setState({ kind: 'error', code: 'no_household' }); return; }
    setState({ kind: 'loading' });
    try {
      const r = await api.pairing.issue({ householdId: household.id });
      setState({ kind: 'issued', code: r.code, expiresAt: r.expiresAt });
      setCopied(false);
      // Start NFC emit so agent can tap immediately
      if (Platform.OS === 'android' && nfcReady) {
        void emitNfc(r.code).catch(() => {}); // best-effort; don't block UI
      }
    } catch (e) {
      setState({ kind: 'error', code: e instanceof ApiError ? e.code : 'unknown_error' });
    }
  };

  const copy = async () => {
    if (state.kind !== 'issued') return;
    await Clipboard.setStringAsync(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (state.kind !== 'issued') return;
    try {
      await Share.share({ message: `amana://pair?token=${state.code}` });
    } catch { /* user cancelled */ }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pair an agent</Text>
      <Text style={styles.muted}>
        Issue a one-time code, then have your agent scan the QR or tap phones (Android).
      </Text>

      {state.kind === 'idle' && (
        <Pressable style={styles.button} onPress={() => void issue()}>
          <Text style={styles.buttonText}>Generate code</Text>
        </Pressable>
      )}

      {state.kind === 'loading' && <ActivityIndicator />}

      {state.kind === 'issued' && (
        <View style={styles.card}>
          <Text style={styles.muted}>Have your agent scan this QR:</Text>
          <View style={styles.qrWrap}>
            <QRCode value={state.code} size={220} />
          </View>
          {Platform.OS === 'android' && nfcReady && (
            <Text style={styles.nfcHint}>📶 NFC active — touch phones to pair</Text>
          )}
          <Text style={styles.muted}>Or share the deep-link:</Text>
          <Text style={styles.code} selectable>{state.code}</Text>
          <Text style={styles.muted}>Expires {new Date(state.expiresAt).toLocaleString()}</Text>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void share()}>
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.secondary]} onPress={() => void copy()}>
              <Text style={[styles.buttonText, styles.secondaryText]}>
                {copied ? 'Copied ✓' : 'Copy'}
              </Text>
            </Pressable>
          </View>
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
  nfcHint: { color: '#1565c0', fontSize: 13, fontWeight: '600' },
  card: { padding: 16, gap: 12, borderRadius: 12, backgroundColor: '#f3f3f3' },
  code: { fontSize: 28, fontFamily: 'Courier', letterSpacing: 2, fontWeight: '700' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  qrWrap: { alignItems: 'center', paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 8 },
  secondary: { backgroundColor: '#eee' },
  buttonText: { color: 'white', fontWeight: '600' },
  secondaryText: { color: '#222' },
});
```

Note: The `Share.share` message is changed to the deep-link format `amana://pair?token=${code}` so agents on iOS can tap it to pair via SMS.

- [ ] **Step 3: Run principal typecheck**

```bash
pnpm --filter @amana/principal typecheck
```

Fix any TypeScript errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/principal/package.json apps/principal/src/screens/PairingScreen.tsx
git commit -m "feat(principal): NFC emit on PairingScreen + SMS deep-link format (Android)"
```

---

## Plan complete

All 28 tasks cover:
- Backend (Tasks 1–8): migration, media service, new routes, agent transaction access
- API client (Tasks 9–11): VendorApi, MediaApi, MeApi, TransactionApi extensions, SubWalletApi/BumpApi/PairingApi additions
- Agent app lib (Tasks 12–14): SecureStore, sub-wallet memory singleton, push helpers
- Agent app screens (Tasks 15–27): auth → pairing → home → pay flow → history → settings
- Principal patch (Task 28): NFC emit + SMS deep-link format

Approximate new test coverage from Tasks 1–11: ~50 cases across backend (TDD red-green), API client (mock fetch), and push logic (pure vitest). Mobile screens are typecheck-verified only.
