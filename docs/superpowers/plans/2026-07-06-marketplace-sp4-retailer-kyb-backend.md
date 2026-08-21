# Marketplace SP4 — Retailer Onboarding & Business KYB (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for the curated retailer-onboarding lifecycle (`applied → kyb_pending → approved / suspended`) with Anchor **Business KYB**, an admin/ops auth surface to drive it, KYB webhook handling, and the long-planted `redemptions` text→uuid **FK migration** — all backend, no portal UI.

**Architecture:** Follow the repo's established Anchor abstraction — a **flat internal contract** (`types.ts` line 124–127 note), not Anchor's JSON:API. Add `createBusinessCustomer` to the adapter mirroring `createCustomer`; add `kyb.approved`/`kyb.rejected` webhook events mirroring `kyc.*`. Retailer onboarding is a **service-layer state machine** (`retailer-onboarding.service.ts`) with explicit transition guards, driven by admin routes (`x-admin-api-key`) since retailer-facing auth is deferred to SP4b (the portal). Finally, convert `redemptions.{retailer_id,catalog_item_id,deal_id}` from `text` placeholders to real `uuid` FKs — a migration whose blast radius is ~9 test files that insert redemptions with literal fake ids and must be reseeded with real rows.

**Tech Stack:** Hono, Drizzle ORM, Postgres 16, Vitest (real DB), Zod, `drizzle-kit`.

**Scope note (bookkeeping honesty):** This is **SP4 backend (SP4a)**. The retailer **portal app** and its Phase-2 platform gate (Expo-web/PWA vs Next) remain deferred to SP4b. Do not record "SP4 shipped."

---

## Prerequisites

- On branch `feat/marketplace-sp4-retailer-kyb-backend` (already created off `main`).
- `docker compose up -d` running; test DB reachable.
- Apply existing migrations before starting: `pnpm --filter @amana/backend db:migrate`.
- After writing the new migration (Task 6) apply it to the test DB the same way before running the FK-dependent tests.

## File Structure

**Anchor integration (flat internal contract):**
- Modify `apps/backend/src/integrations/anchor/types.ts` — add business-customer request/response types, KYB webhook data types, extend `AnchorWebhookEventType`.
- Modify `apps/backend/src/integrations/anchor/adapter.ts` — add `createBusinessCustomer()`.
- Modify `apps/backend/src/integrations/anchor/webhook.ts` — add `kyb.approved`/`kyb.rejected` to `KNOWN_TYPES`.

**Auth / env:**
- Create `apps/backend/src/middleware/admin-auth.ts` — `adminAuth()` (x-admin-api-key).
- Modify `apps/backend/src/env.ts` — add `ADMIN_API_KEY`, boot-enforce in production.

**Retailer onboarding:**
- Modify `apps/backend/src/modules/marketplace/retailers.repo.ts` — status/anchor-id mutators + lookups.
- Create `apps/backend/src/modules/marketplace/retailer-onboarding.service.ts` — the state machine.
- Modify `apps/backend/src/modules/marketplace/index.ts` — barrel export.

**Routes:**
- Create `apps/backend/src/routes/retailers.ts` — admin-gated onboarding endpoints.
- Modify `apps/backend/src/routes/webhooks.ts` — dispatch `kyb.*`.
- Modify `apps/backend/src/server.ts` — mount `/retailers`.

**FK migration (first-class):**
- Create `apps/backend/src/db/migrations/0030_redemptions_fk.sql` (+ drizzle meta) — text→uuid + FK.
- Modify `apps/backend/src/db/schema/marketplace.ts` — redemptions columns to uuid + `references`.
- Modify ~9 test files that insert redemptions with fake text ids (Task 6) to seed real retailer/catalog-item rows.

**Docs:**
- Modify `docs/runbook/anchor-sandbox.md` — KYB note.
- Create/append `docs/runbook/retailer-onboarding.md` — onboarding state machine + admin auth.

---

### Task 1: Anchor Business KYB — types + adapter method

**Files:**
- Modify: `apps/backend/src/integrations/anchor/types.ts`
- Modify: `apps/backend/src/integrations/anchor/adapter.ts`
- Modify: `apps/backend/src/integrations/anchor/webhook.ts`
- Test: `apps/backend/tests/integrations/anchor/business-customer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/integrations/anchor/business-customer.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';

function fakeClient(post: ReturnType<typeof vi.fn>) {
  return { post, get: vi.fn() } as unknown as ConstructorParameters<typeof AnchorAdapter>[0];
}

describe('AnchorAdapter.createBusinessCustomer', () => {
  it('posts to /business-customers with the flat body and idempotency key', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'biz-1', businessName: 'Ada Salon', kybStatus: 'PENDING' });
    const adapter = new AnchorAdapter(fakeClient(post));
    const res = await adapter.createBusinessCustomer(
      { businessName: 'Ada Salon', bvn: '22222222222', rcNumber: 'RC12345', email: 'ada@salon.ng' },
      'kyb:retailer-1',
    );
    expect(res).toEqual({ id: 'biz-1', businessName: 'Ada Salon', kybStatus: 'PENDING' });
    expect(post).toHaveBeenCalledWith(
      '/business-customers',
      { businessName: 'Ada Salon', bvn: '22222222222', rcNumber: 'RC12345', email: 'ada@salon.ng' },
      { idempotencyKey: 'kyb:retailer-1' },
    );
  });
});
```

> Check the real `AnchorAdapter` constructor + `execIdempotent` signature first (adapter.ts) and adjust the `fakeClient`/construction to match how existing adapter tests build it. If existing adapter tests stub `execIdempotent` differently, follow that pattern instead of the sketch above.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/integrations/anchor/business-customer.test.ts`
Expected: FAIL — `createBusinessCustomer` is not a function.

- [ ] **Step 3: Add the types**

In `types.ts`, after `AnchorCreateCustomerResponse` (~line 122):

```ts
export interface AnchorCreateBusinessCustomerRequest {
  businessName: string;
  bvn: string;
  rcNumber?: string;
  email?: string;
}

export interface AnchorCreateBusinessCustomerResponse {
  id: string;
  businessName: string;
  kybStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}
```

Extend `AnchorWebhookEventType` (~line 83) with `'kyb.approved'` and `'kyb.rejected'`. After `AnchorKycRejectedData` (~line 189) add:

```ts
export interface AnchorKybApprovedData {
  businessCustomerId: string;
}

export interface AnchorKybRejectedData {
  businessCustomerId: string;
  reason: string;
}
```

- [ ] **Step 4: Extend the webhook allowlist**

In `webhook.ts`, add `'kyb.approved'` and `'kyb.rejected'` to the `KNOWN_TYPES` set.

- [ ] **Step 5: Add the adapter method**

In `adapter.ts`, after `createCustomer` (~line 57):

```ts
  async createBusinessCustomer(
    input: import('./types').AnchorCreateBusinessCustomerRequest,
    idempotencyKey: string,
  ): Promise<import('./types').AnchorCreateBusinessCustomerResponse> {
    return this.execIdempotent('anchor.business_customer', idempotencyKey, () =>
      this.client.post<import('./types').AnchorCreateBusinessCustomerResponse>(
        '/business-customers',
        input,
        { idempotencyKey },
      ),
    );
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/integrations/anchor/business-customer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/integrations/anchor apps/backend/tests/integrations/anchor/business-customer.test.ts
git commit -m "feat(marketplace): Anchor createBusinessCustomer + kyb.* webhook types"
```

---

### Task 2: `ADMIN_API_KEY` env + `adminAuth()` middleware

**Files:**
- Modify: `apps/backend/src/env.ts`
- Create: `apps/backend/src/middleware/admin-auth.ts`
- Test: `apps/backend/tests/middleware/admin-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/middleware/admin-auth.test.ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { adminAuth } from '../../src/middleware/admin-auth';

function appWith(key: string | undefined) {
  const app = new Hono();
  app.use('/admin/*', adminAuth(key));
  app.get('/admin/ok', (c) => c.json({ ok: true }));
  return app;
}

describe('adminAuth', () => {
  it('401s when no key is configured', async () => {
    const res = await appWith(undefined).request('/admin/ok', { headers: { 'x-admin-api-key': 'anything' } });
    expect(res.status).toBe(401);
  });
  it('401s on wrong key', async () => {
    const res = await appWith('secret').request('/admin/ok', { headers: { 'x-admin-api-key': 'nope' } });
    expect(res.status).toBe(401);
  });
  it('401s on missing header', async () => {
    const res = await appWith('secret').request('/admin/ok');
    expect(res.status).toBe(401);
  });
  it('passes on correct key', async () => {
    const res = await appWith('secret').request('/admin/ok', { headers: { 'x-admin-api-key': 'secret' } });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/middleware/admin-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the middleware** (constant-time compare, mirrors webhook `safeEqualHex`)

```ts
// apps/backend/src/middleware/admin-auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Ops-only auth for retailer onboarding routes. Retailer-facing auth is SP4b (portal). */
export const adminAuth = (configuredKey: string | undefined): MiddlewareHandler => async (c, next) => {
  const provided = c.req.header('x-admin-api-key');
  if (!configuredKey || !provided || !safeEqual(provided, configuredKey)) {
    return c.json({ error: 'admin_unauthorized' }, 401);
  }
  await next();
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/middleware/admin-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `ADMIN_API_KEY` to env**

In `env.ts` schema block (near `ANCHOR_WEBHOOK_SECRET`, ~line 13): add `ADMIN_API_KEY: z.string().min(16).optional(),`. In the production `required` record (~line 38) add `ADMIN_API_KEY: parsed.data.ADMIN_API_KEY,` so a missing key fails fast at boot in production. Ensure it is surfaced on the returned env object like the other keys (~line 93).

- [ ] **Step 6: Run typecheck + the middleware test again**

Run: `pnpm --filter @amana/backend typecheck && pnpm --filter @amana/backend exec vitest run tests/middleware/admin-auth.test.ts`
Expected: typecheck clean; PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/env.ts apps/backend/src/middleware/admin-auth.ts apps/backend/tests/middleware/admin-auth.test.ts
git commit -m "feat(marketplace): ADMIN_API_KEY + adminAuth middleware for ops onboarding routes"
```

---

### Task 3: Retailer repo — status/anchor mutators + lookups

**Files:**
- Modify: `apps/backend/src/modules/marketplace/retailers.repo.ts`
- Test: `apps/backend/tests/modules/marketplace/retailers.repo.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests** (append to the existing file's `describe`)

```ts
  it('updateOnboardingStatus transitions the row', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer({ onboardingStatus: 'applied' }));
    const updated = await retailersRepo.updateOnboardingStatus(testDb, r.id, 'kyb_pending');
    expect(updated?.onboardingStatus).toBe('kyb_pending');
  });

  it('setAnchorBusinessCustomerId stores the id', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer());
    const updated = await retailersRepo.setAnchorBusinessCustomerId(testDb, r.id, 'biz-9');
    expect(updated?.anchorBusinessCustomerId).toBe('biz-9');
  });

  it('findByAnchorBusinessCustomerId resolves the retailer', async () => {
    const r = await retailersRepo.insert(testDb, newRetailer({ anchorBusinessCustomerId: 'biz-7' }));
    const found = await retailersRepo.findByAnchorBusinessCustomerId(testDb, 'biz-7');
    expect(found?.id).toBe(r.id);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/marketplace/retailers.repo.test.ts`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Implement** (add to `retailersRepo`, using `eq` already imported)

```ts
  async updateOnboardingStatus(
    db: DbOrTx,
    id: string,
    status: RetailerOnboardingStatus,
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .update(retailers)
      .set({ onboardingStatus: status })
      .where(eq(retailers.id, id))
      .returning();
    return row;
  },

  async setAnchorBusinessCustomerId(
    db: DbOrTx,
    id: string,
    anchorBusinessCustomerId: string,
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .update(retailers)
      .set({ anchorBusinessCustomerId })
      .where(eq(retailers.id, id))
      .returning();
    return row;
  },

  async findByAnchorBusinessCustomerId(
    db: DbOrTx,
    anchorBusinessCustomerId: string,
  ): Promise<RetailerRow | undefined> {
    const [row] = await db
      .select()
      .from(retailers)
      .where(eq(retailers.anchorBusinessCustomerId, anchorBusinessCustomerId))
      .limit(1);
    return row;
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/marketplace/retailers.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/marketplace/retailers.repo.ts apps/backend/tests/modules/marketplace/retailers.repo.test.ts
git commit -m "feat(marketplace): retailer repo onboarding-status + anchor-business-id mutators"
```

---

### Task 4: Retailer onboarding service — the state machine

**Files:**
- Create: `apps/backend/src/modules/marketplace/retailer-onboarding.service.ts`
- Modify: `apps/backend/src/modules/marketplace/index.ts` (barrel)
- Test: `apps/backend/tests/modules/marketplace/retailer-onboarding.service.test.ts`

**Transitions (guard-enforced):** `apply` → creates `applied`; `submitKyb` requires `applied|kyb_pending`, calls `anchor.createBusinessCustomer`, stores `anchorBusinessCustomerId`, sets `kyb_pending`; `handleKybApproved` requires `kyb_pending` → `approved`; `handleKybRejected` requires `kyb_pending` → `suspended`; `approve` (manual ops override) requires `applied|kyb_pending` → `approved`; `suspend` from any → `suspended`. Invalid transitions throw `ConflictError`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/backend/tests/modules/marketplace/retailer-onboarding.service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retailerOnboardingService } from '../../../src/modules/marketplace/retailer-onboarding.service';
import { retailersRepo } from '../../../src/modules/marketplace/retailers.repo';
import { ConflictError } from '../../../src/lib/errors';
import { testDb, truncateAll } from '../../helpers/test-db';

const anchor = { createBusinessCustomer: vi.fn() };

beforeEach(async () => {
  await truncateAll();
  anchor.createBusinessCustomer.mockReset();
});

const applyInput = { businessName: 'Ada Salon', payoutBankCode: '000014', payoutAccountNumber: '0123456789' };

describe('retailerOnboardingService', () => {
  it('apply creates an applied retailer', async () => {
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    expect(r.onboardingStatus).toBe('applied');
  });

  it('submitKyb calls Anchor, stores id, sets kyb_pending', async () => {
    anchor.createBusinessCustomer.mockResolvedValue({ id: 'biz-1', businessName: 'Ada Salon', kybStatus: 'PENDING' });
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    const after = await retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor as never);
    expect(anchor.createBusinessCustomer).toHaveBeenCalledOnce();
    expect(after.onboardingStatus).toBe('kyb_pending');
    expect(after.anchorBusinessCustomerId).toBe('biz-1');
  });

  it('handleKybApproved moves kyb_pending → approved', async () => {
    anchor.createBusinessCustomer.mockResolvedValue({ id: 'biz-2', businessName: 'X', kybStatus: 'PENDING' });
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    await retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor as never);
    const after = await retailerOnboardingService.handleKybApproved(testDb, 'biz-2');
    expect(after?.onboardingStatus).toBe('approved');
  });

  it('handleKybRejected moves kyb_pending → suspended', async () => {
    anchor.createBusinessCustomer.mockResolvedValue({ id: 'biz-3', businessName: 'X', kybStatus: 'PENDING' });
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    await retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor as never);
    const after = await retailerOnboardingService.handleKybRejected(testDb, 'biz-3', 'docs invalid');
    expect(after?.onboardingStatus).toBe('suspended');
  });

  it('submitKyb on an approved retailer throws ConflictError', async () => {
    anchor.createBusinessCustomer.mockResolvedValue({ id: 'biz-4', businessName: 'X', kybStatus: 'PENDING' });
    const r = await retailerOnboardingService.apply(testDb, applyInput);
    await retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor as never);
    await retailerOnboardingService.handleKybApproved(testDb, 'biz-4');
    await expect(
      retailerOnboardingService.submitKyb(testDb, r.id, { bvn: '22222222222' }, anchor as never),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/marketplace/retailer-onboarding.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service** (DI first-arg `db`, anchor adapter injected)

```ts
// apps/backend/src/modules/marketplace/retailer-onboarding.service.ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { retailersRepo, type RetailerRow } from './retailers.repo';

type DbOrTx = PostgresJsDatabase;

export type ApplyInput = {
  businessName: string;
  payoutBankCode: string;
  payoutAccountNumber: string;
};

export type SubmitKybInput = { bvn: string; rcNumber?: string; email?: string };

export const retailerOnboardingService = {
  async apply(db: DbOrTx, input: ApplyInput): Promise<RetailerRow> {
    return retailersRepo.insert(db, { ...input, onboardingStatus: 'applied' });
  },

  async submitKyb(
    db: DbOrTx,
    retailerId: string,
    input: SubmitKybInput,
    anchor: AnchorAdapter,
  ): Promise<RetailerRow> {
    const retailer = await retailersRepo.findById(db, retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${retailerId} not found`);
    if (retailer.onboardingStatus !== 'applied' && retailer.onboardingStatus !== 'kyb_pending') {
      throw new ConflictError(
        `retailer ${retailerId} cannot submit KYB from status ${retailer.onboardingStatus}`,
      );
    }
    const biz = await anchor.createBusinessCustomer(
      {
        businessName: retailer.businessName,
        bvn: input.bvn,
        rcNumber: input.rcNumber,
        email: input.email,
      },
      `kyb:${retailerId}`,
    );
    await retailersRepo.setAnchorBusinessCustomerId(db, retailerId, biz.id);
    const updated = await retailersRepo.updateOnboardingStatus(db, retailerId, 'kyb_pending');
    if (!updated) throw new NotFoundError(`retailer ${retailerId} vanished mid-KYB`);
    return updated;
  },

  async handleKybApproved(db: DbOrTx, businessCustomerId: string): Promise<RetailerRow | undefined> {
    const retailer = await retailersRepo.findByAnchorBusinessCustomerId(db, businessCustomerId);
    if (!retailer) return undefined;
    if (retailer.onboardingStatus !== 'kyb_pending') return retailer; // idempotent no-op
    return retailersRepo.updateOnboardingStatus(db, retailer.id, 'approved');
  },

  async handleKybRejected(
    db: DbOrTx,
    businessCustomerId: string,
    _reason: string,
  ): Promise<RetailerRow | undefined> {
    const retailer = await retailersRepo.findByAnchorBusinessCustomerId(db, businessCustomerId);
    if (!retailer) return undefined;
    if (retailer.onboardingStatus !== 'kyb_pending') return retailer;
    return retailersRepo.updateOnboardingStatus(db, retailer.id, 'suspended');
  },

  async approve(db: DbOrTx, retailerId: string): Promise<RetailerRow> {
    const retailer = await retailersRepo.findById(db, retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${retailerId} not found`);
    if (retailer.onboardingStatus !== 'applied' && retailer.onboardingStatus !== 'kyb_pending') {
      throw new ConflictError(`retailer ${retailerId} cannot be approved from ${retailer.onboardingStatus}`);
    }
    const updated = await retailersRepo.updateOnboardingStatus(db, retailerId, 'approved');
    if (!updated) throw new NotFoundError(`retailer ${retailerId} vanished`);
    return updated;
  },

  async suspend(db: DbOrTx, retailerId: string): Promise<RetailerRow> {
    const retailer = await retailersRepo.findById(db, retailerId);
    if (!retailer) throw new NotFoundError(`retailer ${retailerId} not found`);
    const updated = await retailersRepo.updateOnboardingStatus(db, retailerId, 'suspended');
    if (!updated) throw new NotFoundError(`retailer ${retailerId} vanished`);
    return updated;
  },
};
```

> Verify `ConflictError`/`NotFoundError` exist in `lib/errors.ts` (they're used by `catalog.service.ts`/`purchase.service.ts`). Add the barrel export line to `modules/marketplace/index.ts` matching the file's existing style.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/marketplace/retailer-onboarding.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/marketplace/retailer-onboarding.service.ts apps/backend/src/modules/marketplace/index.ts apps/backend/tests/modules/marketplace/retailer-onboarding.service.test.ts
git commit -m "feat(marketplace): retailer onboarding state machine (apply/submitKyb/approve/suspend + kyb webhooks)"
```

---

### Task 5: Admin retailer routes + webhook `kyb.*` dispatch

**Files:**
- Create: `apps/backend/src/routes/retailers.ts`
- Modify: `apps/backend/src/server.ts` (mount)
- Modify: `apps/backend/src/routes/webhooks.ts` (dispatch `kyb.approved`/`kyb.rejected`)
- Test: `apps/backend/tests/routes/retailers.test.ts`
- Test: `apps/backend/tests/routes/webhooks.marketplace.test.ts` (extend for kyb events)

- [ ] **Step 1: Write failing route tests** (admin-gated CRUD + lifecycle). Set `ADMIN_API_KEY` for the test process — add it to the test env (`.env.test` / `vitest` env or `process.env.ADMIN_API_KEY = 'test-admin-key-000000'` in a test setup). Confirm how existing route tests get env; mirror that.

```ts
// apps/backend/tests/routes/retailers.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../helpers/app'; // or however routes/*.test.ts import the Hono app
import { truncateAll } from '../helpers/test-db';

const ADMIN = { 'x-admin-api-key': process.env.ADMIN_API_KEY ?? 'test-admin-key-000000' };
const apply = { businessName: 'Ada Salon', payoutBankCode: '000014', payoutAccountNumber: '0123456789' };

beforeEach(async () => { await truncateAll(); });

describe('POST /retailers (admin)', () => {
  it('401 without admin key', async () => {
    const res = await app.request('/retailers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(apply) });
    expect(res.status).toBe(401);
  });
  it('creates an applied retailer with admin key', async () => {
    const res = await app.request('/retailers', { method: 'POST', headers: { ...ADMIN, 'content-type': 'application/json' }, body: JSON.stringify(apply) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.onboardingStatus).toBe('applied');
  });
  it('400 on malformed body', async () => {
    const res = await app.request('/retailers', { method: 'POST', headers: { ...ADMIN, 'content-type': 'application/json' }, body: JSON.stringify({ businessName: '' }) });
    expect(res.status).toBe(400);
  });
});

describe('GET /retailers/:id 400 on non-uuid', () => {
  it('returns 400 not 500', async () => {
    const res = await app.request('/retailers/not-a-uuid', { headers: ADMIN });
    expect(res.status).toBe(400);
  });
});
```

> `POST /retailers/:id/kyb` hits the real Anchor adapter. Follow the pattern the household/anchor route tests use to avoid a live call (they map `AnchorHttpError`→503; check whether they gate on `ANCHOR_API_KEY` or inject a stub). Test the `submitKyb` **service** for Anchor behavior (Task 4) and keep the route test focused on auth + validation + wiring, stubbing the adapter as those tests do.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/retailers.test.ts`
Expected: FAIL — route not mounted (404/401 mismatch or import error).

- [ ] **Step 3: Implement routes** (thin; validate via `lib/validate.ts`; uuid params; `adminAuth` on all)

```ts
// apps/backend/src/routes/retailers.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getAnchorAdapter } from '../integrations/anchor'; // match the actual accessor used in routes/households.ts
import { adminAuth } from '../middleware/admin-auth';
import { retailerOnboardingService } from '../modules/marketplace/retailer-onboarding.service';
import { retailersRepo } from '../modules/marketplace/retailers.repo';
import { db } from '../db/client'; // match how other routes obtain the db handle
import { loadEnv } from '../env';
import { parseBody, parseParams } from '../lib/validate';

const applySchema = z.object({
  businessName: z.string().min(1),
  payoutBankCode: z.string().min(3),
  payoutAccountNumber: z.string().min(10).max(10),
});
const kybSchema = z.object({ bvn: z.string().length(11), rcNumber: z.string().optional(), email: z.string().email().optional() });
const idParam = z.object({ id: z.string().uuid() });

export function createRetailerRoutes() {
  const app = new Hono();
  app.use('*', adminAuth(loadEnv().ADMIN_API_KEY));

  app.post('/', async (c) => {
    const body = await parseBody(c, applySchema);
    if (body instanceof Response) return body;
    const retailer = await retailerOnboardingService.apply(db, body);
    return c.json(retailer, 201);
  });

  app.get('/:id', async (c) => {
    const params = parseParams(c, idParam);
    if (params instanceof Response) return params;
    const retailer = await retailersRepo.findById(db, params.id);
    if (!retailer) return c.json({ error: 'not_found' }, 404);
    return c.json(retailer);
  });

  app.post('/:id/kyb', async (c) => {
    const params = parseParams(c, idParam);
    if (params instanceof Response) return params;
    const body = await parseBody(c, kybSchema);
    if (body instanceof Response) return body;
    const retailer = await retailerOnboardingService.submitKyb(db, params.id, body, getAnchorAdapter());
    return c.json(retailer);
  });

  app.post('/:id/approve', async (c) => {
    const params = parseParams(c, idParam);
    if (params instanceof Response) return params;
    return c.json(await retailerOnboardingService.approve(db, params.id));
  });

  app.post('/:id/suspend', async (c) => {
    const params = parseParams(c, idParam);
    if (params instanceof Response) return params;
    return c.json(await retailerOnboardingService.suspend(db, params.id));
  });

  return app;
}
```

> The imports above (`db`, `getAnchorAdapter`, `loadEnv`, `parseBody`/`parseParams` return contract) are sketches — **match the real accessors** used in `routes/households.ts` and `routes/marketplace.ts` before finalizing. `ConflictError`/`NotFoundError` thrown by the service map to 409/404 via `middleware/error-handler.ts`; confirm the mapping exists (it maps `ForbiddenError`→403; add `ConflictError`→409 / `NotFoundError`→404 if not already present).

- [ ] **Step 4: Mount in `server.ts`** — add `app.route('/retailers', createRetailerRoutes())` alongside the other `app.route(...)` calls (match import + registration style).

- [ ] **Step 5: Add webhook dispatch** — in `routes/webhooks.ts`, after the `kyc.rejected` branch (~line 150):

```ts
      } else if (event.type === 'kyb.approved') {
        const data = event.data as AnchorKybApprovedData;
        const r = await retailerOnboardingService.handleKybApproved(tx, data.businessCustomerId);
        if (!r) logger.warn({ businessCustomerId: data.businessCustomerId }, 'kyb.approved: no matching retailer');
      } else if (event.type === 'kyb.rejected') {
        const data = event.data as AnchorKybRejectedData;
        const r = await retailerOnboardingService.handleKybRejected(tx, data.businessCustomerId, data.reason);
        if (!r) logger.warn({ businessCustomerId: data.businessCustomerId }, 'kyb.rejected: no matching retailer');
      }
```

Add imports for `retailerOnboardingService` and the two data types at the top of `webhooks.ts`.

- [ ] **Step 6: Extend webhook test** — in `tests/routes/webhooks.marketplace.test.ts`, add a case: seed a `kyb_pending` retailer (via `retailerOnboardingService.apply` + `retailersRepo.setAnchorBusinessCustomerId` + `updateOnboardingStatus('kyb_pending')`, or directly), POST a signed `kyb.approved` webhook for its `businessCustomerId`, assert the retailer becomes `approved` and the endpoint returns 200. Reuse the existing signed-webhook helper in that file.

- [ ] **Step 7: Run route + webhook tests**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/retailers.test.ts tests/routes/webhooks.marketplace.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/routes/retailers.ts apps/backend/src/server.ts apps/backend/src/routes/webhooks.ts apps/backend/tests/routes/retailers.test.ts apps/backend/tests/routes/webhooks.marketplace.test.ts
git commit -m "feat(marketplace): admin retailer onboarding routes + kyb.* webhook dispatch"
```

---

### Task 6: `redemptions` text→uuid FK migration (first-class — reseeds ~9 test files)

**Files:**
- Create: `apps/backend/src/db/migrations/0030_redemptions_fk.sql` (via `drizzle-kit generate` after schema edit)
- Modify: `apps/backend/src/db/schema/marketplace.ts`
- Modify (reseed real rows): `tests/modules/marketplace/{expiry,redeem,purchase,redemption-settlement,redemptions.repo,ledger.property}.service?.test.ts`, `tests/modules/wallet/postings.repo.marketplace-hold.test.ts`, `tests/routes/webhooks.marketplace.test.ts`. (Grep first — exact list below.)

**Blast radius (verified):** these insert redemptions with **literal fake ids** (`retailerId: 'retailer-1'`, `catalogItemId: 'item-1'`, `'someone-else'`) that bypass `purchase.service`. Under an FK they will fail. Each must first insert a real `retailers` row (and `catalog_items` row) and use those uuids.

- [ ] **Step 1: Enumerate every offending insert**

Run: `git grep -n -E "retailerId: '(retailer|someone|item)|catalogItemId: 'item" apps/backend/tests`
Record the file:line list. Known offenders: `expiry.service.test.ts`, `ledger.property.test.ts`, `purchase.service.test.ts:60`, `redeem.service.test.ts:60,174`, `redemption-settlement.service.test.ts`, `redemptions.repo.test.ts:75`, `postings.repo.marketplace-hold.test.ts:53`, `webhooks.marketplace.test.ts:82`.

- [ ] **Step 2: Add a shared test factory for a real retailer + item**

In `tests/helpers/factories.ts` add:

```ts
import { retailersRepo } from '../../src/modules/marketplace/retailers.repo';
import { catalogItemsRepo } from '../../src/modules/marketplace/catalog-items.repo';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export async function seedRetailerAndItem(db: PostgresJsDatabase, priceKobo = 100_000n) {
  const retailer = await retailersRepo.insert(db, {
    businessName: 'Test Retailer',
    payoutBankCode: '000014',
    payoutAccountNumber: '0123456789',
    onboardingStatus: 'approved',
  });
  const item = await catalogItemsRepo.insert(db, {
    retailerId: retailer.id,
    name: 'Test Item',
    priceKobo,
    section: 'general',
  });
  return { retailer, item };
}
```

> Confirm `catalogItemsRepo.insert`'s exact input shape (Task-independent — read `catalog-items.repo.ts`) and match required fields.

- [ ] **Step 3: Rewrite each offending insert** to call `seedRetailerAndItem(testDb)` in the test's setup and pass `retailer.id` / `item.id` (and a real `deal.id` or `null` for `dealId`) into the redemption insert. Do them one file at a time; run that file's suite green before moving on. For `redeem.service.test.ts:174` (`retailerId: 'someone-else'` — an authz negative test) seed a **second** real retailer and use its id so the "different retailer" assertion still holds.

- [ ] **Step 4: Edit the schema**

In `db/schema/marketplace.ts`, replace the redemptions text columns (lines ~95–98):

```ts
  retailerId: uuid('retailer_id')
    .notNull()
    .references(() => retailers.id, { onDelete: 'restrict' }),
  catalogItemId: uuid('catalog_item_id')
    .notNull()
    .references(() => catalogItems.id, { onDelete: 'restrict' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'restrict' }),
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @amana/backend exec drizzle-kit generate` → produces `0030_*.sql`. Rename/verify it contains `ALTER TABLE "redemptions" ALTER COLUMN "retailer_id" ... USING "retailer_id"::uuid` and the three FK `ADD CONSTRAINT`s. If drizzle emits a drop+add without `USING`, hand-edit the SQL to use `ALTER COLUMN ... TYPE uuid USING "<col>"::uuid` so existing rows convert. (Dev/prod redemption rows already hold real uuids — written by `purchase.service`.)

- [ ] **Step 6: Apply to test DB + run the full marketplace suite**

Run: `pnpm --filter @amana/backend db:migrate && pnpm --filter @amana/backend exec vitest run tests/modules/marketplace tests/routes/marketplace.test.ts tests/routes/webhooks.marketplace.test.ts tests/modules/wallet/postings.repo.marketplace-hold.test.ts`
Expected: PASS (all reseeded).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/schema/marketplace.ts apps/backend/src/db/migrations apps/backend/tests
git commit -m "feat(marketplace): redemptions retailer/item/deal text->uuid FK + reseed direct-insert tests"
```

---

### Task 7: Full suite, security review, docs

- [ ] **Step 1: Typecheck + lint**

Run: `pnpm --filter @amana/backend typecheck && pnpm exec biome check --write apps/backend/src apps/backend/tests`
Expected: clean.

- [ ] **Step 2: Full backend suite + coverage gate**

Run: `pnpm --filter @amana/backend test && pnpm --filter @amana/backend test:coverage`
Expected: all pass; coverage ≥ thresholds (lines/statements 92, functions 90, branches 80).

- [ ] **Step 3: Security-reviewer pass** — dispatch the `security-reviewer` agent over the diff. Focus: admin-key constant-time compare + not-configured-means-deny; onboarding transition guards can't be bypassed to reach `approved` without KYB (except the explicit ops `approve`); webhook `kyb.*` idempotency (re-delivery no-ops); FK migration can't strand referential integrity; no role-claim trust. Address findings before proceeding.

- [ ] **Step 4: Docs** — append a KYB note to `docs/runbook/anchor-sandbox.md`; create `docs/runbook/retailer-onboarding.md` documenting the state machine, admin auth (`ADMIN_API_KEY`, `x-admin-api-key`), the `kyb.*` webhook flow, and that the retailer **portal UI is SP4b (deferred)**. Add `ADMIN_API_KEY` to `docs/runbook/go-live-checklist.md` production-secrets list and to `.env.example`.

- [ ] **Step 5: Commit + push + PR**

```bash
git add -A && git commit -m "docs(marketplace): SP4 retailer onboarding runbook + go-live secret"
git push -u origin feat/marketplace-sp4-retailer-kyb-backend
gh pr create --title "feat(marketplace): SP4 backend — retailer onboarding & Business KYB" --body "<summary + SP4a scope note: portal UI deferred to SP4b>"
```

---

## Self-Review

**Spec coverage (§ of marketplace-design.md):** §2 curated onboarding (apply→KYB→review→approve) ✓ Tasks 4–5; §3 "Anchor Business KYB is net-new" ✓ Task 1; §9 `retailers.anchor_business_customer_id` + onboarding status + redemptions FKs ("SP4 swaps to FKs") ✓ Tasks 3,6; §10.2 "Retailer portal + Business KYB" backend ✓ (portal UI explicitly deferred to SP4b). Partner-funded budget, buyer marketplace, portal platform gate — correctly out of scope.

**Placeholder scan:** All code steps carry concrete code. Integration-point imports (`db`, `getAnchorAdapter`, `loadEnv`, `app` handle in route tests, error-handler mapping) are flagged as **"match the real accessor"** rather than invented — the executor must read `routes/households.ts` / `routes/marketplace.ts` / `middleware/error-handler.ts` to bind them. This is deliberate: guessing them would be the worse failure.

**Type consistency:** `createBusinessCustomer` request/response, `AnchorKybApprovedData.businessCustomerId`, service method names (`apply`/`submitKyb`/`handleKybApproved`/`handleKybRejected`/`approve`/`suspend`), repo methods (`updateOnboardingStatus`/`setAnchorBusinessCustomerId`/`findByAnchorBusinessCustomerId`) are used consistently across Tasks 1→5. `kybStatus` enum matches between type and adapter test.

**Open risks flagged for execution:** (1) Anchor's real `/business-customers` wire shape is abstracted behind the flat internal contract — only the gated E2E would catch a divergence, same as every other adapter method (documented, accepted). (2) The FK migration `USING` cast + FK constraints are the highest-risk change; Task 6 reseeds every direct-insert test and verifies `USING` is present in the generated SQL.
