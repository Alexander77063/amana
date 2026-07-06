# Marketplace SP3 — Digital VAS (Bill Payment) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Money code — Task 13 requires a **security-reviewer** pass before the PR.

**Goal:** Add an in-app **digital VAS** section — buy airtime, data, electricity, and cable-TV from a wallet — that reserves funds from a buyer's sub-wallet, calls Anchor's bill-payment API, and settles-with-commission or refunds based on the async `bills.*` webhook, gated by the sub-wallet spend limit and a principal-approved recipient allowlist.

**Architecture:** VAS purchase is a spend whose external payout is an Anchor **bill payment** (not a NIP transfer) and whose revenue is a **reseller commission** (not the ₦100 spend fee). It reuses three proven patterns verbatim: the **reserve** mirrors `nip-out.service.send` (debit source → credit suspense under a per-sub-wallet advisory lock + `wouldExceedSpendLimit`); the **settle** mirrors `redemption-settlement.service.finalise`'s commission carve (`debit suspense = credit external [amount−commission] + credit commission`); the **fail** path uses the existing `reversalService.reverse` to **refund the buyer** — the one deliberate inversion of SP1's "payout failure never refunds" rule (a failed bill delivered nothing). Async fulfilment (`PENDING` → webhook `bills.successful`/`bills.failed`) reuses the existing `routes/webhooks.ts` audit-dedupe-then-dispatch machinery. A new `vas_beneficiaries` allowlist enforces recipient control: an agent may top up their own registered phone freely; any other phone/meter/smartcard must be a principal-approved beneficiary.

**Tech Stack:** Hono, Drizzle ORM, Postgres 16, `postgres-js`, Vitest (real DB), `fast-check`, bigint kobo. Anchor Bill Payment API (`GET /bills/billers?category=`, `GET /bills/billers/{id}/products`, `GET /bills/customer-validation/{slug}/{account}`, `POST /bills`; webhooks `bills.initiated|successful|failed`; commission airtime/data 2%, electricity 1%, cable ≤1.5%).

---

## Locked decisions (do not re-litigate)

1. **Provider = Anchor VAS, no second aggregator.** Confirmed by Anchor 2026-06-30 (see `project_pricing_decision` memory / `docs/business/PRICING.md`): VTU served directly by Anchor's VAS API; rates airtime/data 2%, electricity 0.5–1% (cap ₦1,000), cable 1.2% (cap ₦1,500).
2. **Scope = all four categories:** airtime, data, electricity, cable TV.
3. **Recipient control = beneficiary allowlist + own number.** Agent may top up their own registered phone (airtime/data) freely within the limit; any other recipient (phone, meter, smartcard) must be an **active principal-approved `vas_beneficiaries` row** for that sub-wallet. Else → 403.
4. **No ₦100 spend fee on VAS.** VAS revenue is the Anchor commission (reseller discount carved from the buyer's face-value payment). There is no ₦50 NIP cost to clear because Anchor fulfils directly — so the spend fee does not apply. Commission is booked to the credit-normal `commission` LA, exactly as redemption settlement does.
5. **Buyer is charged face value.** Reserve = the requested bill amount. Commission is carved from it at settle: `external = amount − commission`, `commission` LA = commission. Buyer's cost = face value; Amana nets the commission.
6. **Failed bill refunds the buyer** (`reversalService.reverse`). This deliberately inverts SP1's redemption rule — a failed bill delivered no value.
7. **Over-limit → reject** (`LimitExceededError` → 409), matching SP5a's marketplace decision. Over-limit→bump for VAS is a deferred follow-up.
8. **VAS holds count in the spend-limit window** (like SP5a marketplace holds).

**Deferred follow-ups (note, do not build):** over-limit→bump for VAS; recon-sweep of stuck `PENDING` VAS bills (webhook is the primary path; a bill stuck `in_flight` with no webhook is an ops concern, mirror `reconciliationService` in a later pass); partner-funded VAS campaigns; prepaid-token **display** (SP5b mobile — we persist the token, we don't render it).

**⚠️ Intentional interim gap — category-lock does NOT gate VAS in SP3.** `vasPurchaseService.create` enforces the spend **limit** (`wouldExceedSpendLimit`) and the **recipient allowlist**, but does **not** call the rule engine — so a category-locked sub-wallet (e.g. "transport only") can still buy airtime/data within its limit to an approved recipient. This cuts against the product's core control promise and is a deliberate scope split: **VAS category/merchant rule-fusion is SP5b's job** (it owns the new rule-kind wiring). This MUST be called out explicitly in the PR body so the reviewer signs off on it as an interim gap rather than discovering it. The recipient allowlist is the interim cash-out guard in the meantime.

---

## File Structure

**New — schema & migration**
- `apps/backend/src/db/schema/vas.ts` — `vasCategoryEnum`, `vasStatusEnum`, `vasRecipientKindEnum`, `vas_purchases`, `vas_beneficiaries` tables.
- `apps/backend/src/db/migrations/0029_*.sql` — generated: `ALTER TYPE txn_kind ADD VALUE 'vas_purchase'`; new enums + tables.

**New — module `apps/backend/src/modules/vas/`**
- `config.ts` — category → Anchor bill `type` string + commission rate/cap table + recipient-kind per category.
- `commission.ts` — `computeCommissionKobo(category, amount, anchorCommission?)`.
- `vas-purchases.repo.ts` — Drizzle queries for `vas_purchases`.
- `beneficiaries.repo.ts` — Drizzle queries for `vas_beneficiaries`.
- `beneficiaries.service.ts` — add/list/remove (principal-authorized) + `assertRecipientAllowed`.
- `purchase.service.ts` — `create()` (reserve → Anchor payBill → settle/reverse), mirrors `nip-out.service`.
- `vas-settlement.service.ts` — `finalise()` commission carve, mirrors `redemption-settlement.service`.
- `catalog.service.ts` — thin proxy: `listBillers`, `listProducts`, `validateCustomer` (pass-through to adapter).
- `index.ts` — barrel export.

**New — HTTP**
- `apps/backend/src/routes/vas.ts` — buyer routes (billers/products/validate/purchase/purchases) + principal beneficiary CRUD.

**Modified**
- `apps/backend/src/integrations/anchor/types.ts` — bill request/response/biller/product/validation types + `bills.*` webhook event data + event-type union.
- `apps/backend/src/integrations/anchor/adapter.ts` — `listBillers`, `listProducts`, `validateCustomer`, `payBill`.
- `apps/backend/src/integrations/anchor/webhook.ts` — add `bills.initiated|successful|failed` to `KNOWN_TYPES`.
- `apps/backend/src/routes/webhooks.ts` — dispatch `bills.successful`→settle, `bills.failed`→reverse.
- `apps/backend/src/modules/wallet/postings.repo.ts` — extend `sumDebitsInWindow` to count `vas_purchase`.
- `apps/backend/src/db/schema/transactions.ts` — add `vas_purchase` to `txnKindEnum`.
- `apps/backend/src/server.ts` — mount `vasRoute`.
- `apps/backend/src/modules/audit/events.ts` — VAS audit events.

**Tests** (one file per unit, real-DB conventions)
- `tests/modules/vas/purchase.service.test.ts`, `vas-settlement.service.test.ts`, `beneficiaries.service.test.ts`, `commission.test.ts`
- `tests/routes/vas.test.ts`, `tests/routes/vas-beneficiaries.test.ts`, `tests/routes/webhooks-bills.test.ts`
- `tests/modules/wallet/spend-limit-vas.test.ts`

---

## Task 1: `txn_kind` += `vas_purchase` + VAS enums & tables (schema)

**Files:**
- Modify: `apps/backend/src/db/schema/transactions.ts:15-23`
- Create: `apps/backend/src/db/schema/vas.ts`
- Modify: `apps/backend/src/db/schema/index.ts` (add `export * from './vas'`)

- [ ] **Step 1: Add the txn kind.** In `transactions.ts`, extend the enum:

```typescript
export const txnKindEnum = pgEnum('txn_kind', [
  'spend',
  'topup',
  'refund',
  'fee',
  'reversal',
  'marketplace_purchase',
  'redemption',
  'vas_purchase',
]);
```

- [ ] **Step 2: Create `vas.ts`.** Mirror the style of `db/schema/marketplace.ts` (uuid PKs, `bigint(..., { mode: 'bigint' })` kobo, timestamptz).

```typescript
import { sql } from 'drizzle-orm';
import { bigint, boolean, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { masterWallets, subWallets } from './wallet';
import { transactions } from './transactions';

export const vasCategoryEnum = pgEnum('vas_category', [
  'airtime',
  'data',
  'electricity',
  'cabletv',
]);

// Lifecycle of the bill fulfilment (distinct from the money txn status).
export const vasStatusEnum = pgEnum('vas_status', ['pending', 'successful', 'failed']);

export const vasRecipientKindEnum = pgEnum('vas_recipient_kind', ['phone', 'meter', 'smartcard']);

export const vasPurchases = pgTable('vas_purchases', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'restrict' }),
  buyerUserId: uuid('buyer_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  masterWalletId: uuid('master_wallet_id')
    .notNull()
    .references(() => masterWallets.id, { onDelete: 'restrict' }),
  subWalletId: uuid('sub_wallet_id').references(() => subWallets.id, { onDelete: 'restrict' }),
  category: vasCategoryEnum('category').notNull(),
  provider: text('provider').notNull(), // Anchor biller slug (e.g. 'mtn', 'ikeja-electric')
  productSlug: text('product_slug'), // data plan / disco product slug; null for airtime
  recipientKind: vasRecipientKindEnum('recipient_kind').notNull(),
  recipient: text('recipient').notNull(), // phone | meter | smartcard number
  customerName: text('customer_name'), // from customer-validation (electricity/cable)
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  commissionKobo: bigint('commission_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  anchorBillId: text('anchor_bill_id'), // Anchor BillPayment id (set once the call returns)
  token: text('token'), // prepaid electricity token (set on success)
  status: vasStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const vasBeneficiaries = pgTable(
  'vas_beneficiaries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    subWalletId: uuid('sub_wallet_id')
      .notNull()
      .references(() => subWallets.id, { onDelete: 'cascade' }),
    kind: vasRecipientKindEnum('kind').notNull(),
    value: text('value').notNull(), // normalized phone / meter / smartcard
    label: text('label').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft-remove keeps history; an inactive row does not authorize a purchase. MUST be a real
    // boolean — this is an authorization control, and a stringly-typed 'false' is truthy in JS,
    // so any `if (b.active)` check would fail OPEN on a cash-out gate.
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    uniqPerWallet: unique('vas_beneficiaries_wallet_kind_value_uniq').on(
      t.subWalletId,
      t.kind,
      t.value,
    ),
  }),
);
```

- [ ] **Step 3: Barrel export.** In `db/schema/index.ts` add `export * from './vas';` (keep alphabetical if the file is ordered).

- [ ] **Step 4: Typecheck.** Run: `pnpm --filter @amana/backend typecheck` — Expected: PASS (no usages yet, schema compiles).

- [ ] **Step 5: Commit.** `git add apps/backend/src/db/schema && git commit -m "feat(vas): txn_kind vas_purchase + vas_purchases/vas_beneficiaries schema"`

---

## Task 2: Generate & apply the migration

**Files:** Create: `apps/backend/src/db/migrations/0029_*.sql` (name auto-assigned by drizzle-kit)

> Use the `drizzle-migration` skill for the full workflow. `ALTER TYPE ... ADD VALUE` must be its own statement (Postgres forbids using a new enum value in the same tx it's added — drizzle-kit emits it standalone, matching migration `0026`).

- [ ] **Step 1: Generate.** Run: `pnpm --filter @amana/backend db:generate` (drizzle-kit generate). Expected: a new `0029_*.sql` containing `ALTER TYPE "txn_kind" ADD VALUE 'vas_purchase';`, `CREATE TYPE ... vas_category/vas_status/vas_recipient_kind`, and `CREATE TABLE vas_purchases`, `vas_beneficiaries`.

- [ ] **Step 2: Review the SQL.** Confirm the enum-add uses the standalone `ALTER TYPE` form (like `0026_swift_iceman.sql`) and the FKs are `ON DELETE restrict` (purchases) / `cascade` (beneficiaries). No `DROP`.

- [ ] **Step 3: Apply to dev + test DB.** Run: `pnpm --filter @amana/backend db:migrate`. (Tests do not auto-migrate — this is required before Task 3+ tests.) Expected: `0029` applied.

- [ ] **Step 4: Commit.** `git add apps/backend/src/db/migrations && git commit -m "feat(vas): migration 0029 — vas_purchase kind, vas tables"`

---

## Task 3: Anchor types + adapter methods (bill payment)

**Files:**
- Modify: `apps/backend/src/integrations/anchor/types.ts`
- Modify: `apps/backend/src/integrations/anchor/adapter.ts`
- Test: `apps/backend/tests/integrations/anchor/vas-adapter.test.ts`

> **CRITICAL — follow the codebase's flat Anchor convention, NOT Anchor's public JSON:API.** Every existing adapter method (`transfer`, `createCustomer`, `provisionVirtualAccount`) posts a **flat** typed body and reads a **flat** typed response. `adapter.transfer.test.ts` proves the wire shape: `transfer({ amountKobo: 520000n, ... })` serializes to `{"amountKobo":"520000",...}` — **kobo, bigint-as-string** (via `bigintReplacer` in `client.ts`). Anchor's public docs show a nested `{data:{type,attributes}}` shape, but this codebase talks to Anchor through a flat internal contract whose live fidelity is the **one outstanding go-live gate** ("live Anchor sandbox E2E", per the security-audit backlog / `docs/runbook/go-live-checklist.md`). **VAS inherits that exact convention** — flat body, `amountKobo` in kobo, flat response — so it shares the same single verification gate rather than introducing a second, divergent contract. Do **not** build a nested body or a naira amount. `baseUrl` already includes `/api/v1`, so adapter paths are `/bills...` (matching `/transfers`, `/customers`). **The only genuinely VAS-specific unknowns to confirm when the live-E2E gate is closed:** the exact response field name for commission (assumed `commissionKobo`) and the cable-TV `type` string — both isolated to `types.ts` + the `payBill` response mapping, neither affecting the money model.

- [ ] **Step 1: Write the failing adapter test.** Mirror `adapter.transfer.test.ts` exactly — real `AnchorClient` + a `fetchImpl` spy — and assert the **flat** wire body (`"amountKobo":"10000"`, kobo-as-string) plus the idempotency header. `listBillers` GETs `/bills/billers?category=airtime`.

```typescript
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

function jsonResponse(body: unknown, status = 202) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('AnchorAdapter VAS', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('payBill POSTs /bills with a FLAT body, amountKobo serialised as a string', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'bill_1', status: 'PENDING', commissionKobo: '200' }));
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const key = factories.idempotencyKey();
    const res = await adapter.payBill(
      {
        type: 'Airtime',
        provider: 'mtn',
        phoneNumber: '+2348010000000',
        amountKobo: 10_000n, // ₦100
        reference: key,
        accountId: 'anchor-acct',
      },
      key,
    );
    expect(res.status).toBe('PENDING');
    expect(res.id).toBe('bill_1');
    expect(res.commissionKobo).toBe(200n);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.x/bills');
    expect(init.body as string).toContain('"amountKobo":"10000"');
    expect(init.body as string).toContain('"type":"Airtime"');
    expect(init.body as string).toContain(`"reference":"${key}"`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(key);
  });

  it('listBillers GETs the category-filtered billers endpoint', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'b1', name: 'MTN', slug: 'mtn' }] }, 200));
    const adapter = new AnchorAdapter({
      db: testDb,
      client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
      retryDelaysMs: [1],
    });
    const billers = await adapter.listBillers('airtime');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.x/bills/billers?category=airtime');
    expect(billers[0].slug).toBe('mtn');
  });
});
```

> The response shape here (`{ id, status, commissionKobo }` flat; `listBillers` → `{ data: [{ id, name, slug }] }`) is the **assumed flat internal contract**, consistent with how `transfer` consumes `{ id, status, reference }` flat. If the live-E2E gate later reveals Anchor returns nested `{data:{attributes}}`, the fix is a single response-mapping change in the adapter (and its unit test) — the same fix `transfer` will need, tracked by the same gate.

- [ ] **Step 2: Run — expect FAIL** (`payBill is not a function`). Run: `pnpm --filter @amana/backend exec vitest run tests/integrations/anchor/vas-adapter.test.ts`

- [ ] **Step 3: Add the types** to `types.ts`:

```typescript
export type VasBillType = 'Airtime' | 'Data' | 'Electricity' | 'CableTV';

export interface AnchorBiller {
  id: string;
  name: string;
  slug: string;
}

export interface AnchorBillProduct {
  id: string;
  name: string;
  slug: string;
  amountKobo: bigint | null; // fixed-price products (data plans); null = variable (airtime)
}

export interface AnchorCustomerValidation {
  customerNumber: string;
  customerName: string;
}

// FLAT request body — mirrors AnchorTransferRequest (amountKobo: bigint, serialized as a
// kobo string by bigintReplacer). Do NOT nest under data/attributes.
export interface AnchorBillRequest {
  type: VasBillType;
  provider?: string; // biller slug (airtime/data)
  productSlug?: string; // data plan / disco product
  phoneNumber?: string; // airtime/data recipient
  meterAccountNumber?: string; // electricity/cable recipient
  amountKobo: bigint; // kobo (bigint → string on the wire)
  reference: string; // = idempotency key
  accountId: string; // Anchor DepositAccount id (Amana's operating account)
}

// FLAT response — mirrors AnchorTransferResponse. commissionKobo/token/failureReason are the
// assumed field names of the flat internal contract (verified when the live-E2E gate closes).
export interface AnchorBillResponse {
  id: string;
  status: 'PENDING' | 'INITIATED' | 'COMPLETED' | 'FAILED';
  commissionKobo: bigint;
  token: string | null; // prepaid electricity token when present
  failureReason?: string | null;
}

// Webhook payload (flat, mirrors AnchorTransferEventData). `reference` = our idempotency key.
export interface AnchorBillEventData {
  billId: string;
  reference: string;
  commissionKobo?: bigint | string;
  token?: string | null;
  failureReason?: string | null;
}
```

Extend the webhook event-type union (find `AnchorWebhookEventType`) to add `'bills.initiated' | 'bills.successful' | 'bills.failed'`.

- [ ] **Step 4: Add the adapter methods** to `adapter.ts`. `payBill` mirrors `transfer` verbatim: pass the **flat** `input` straight to `client.post('/bills', input, { idempotencyKey })` inside `execIdempotent` (bigint `amountKobo` → kobo-string via `bigintReplacer`; no body construction, no nesting). Reads use `client.get` + `breaker/executeWithRetry` like `nameEnquiry`.

```typescript
async listBillers(category: string): Promise<import('./types').AnchorBiller[]> {
  const res = await this.breaker.exec(() =>
    this.executeWithRetry(() =>
      this.client.get<{ data: Array<{ id: string; name: string; slug: string }> }>(
        `/bills/billers?category=${encodeURIComponent(category)}`,
      ),
    ),
  );
  return res.data.map((b) => ({ id: b.id, name: b.name, slug: b.slug }));
}

async listProducts(billerId: string): Promise<import('./types').AnchorBillProduct[]> {
  const res = await this.breaker.exec(() =>
    this.executeWithRetry(() =>
      this.client.get<{ data: Array<{ id: string; name: string; slug: string; amountKobo?: string | null }> }>(
        `/bills/billers/${encodeURIComponent(billerId)}/products`,
      ),
    ),
  );
  return res.data.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    amountKobo: p.amountKobo != null ? BigInt(p.amountKobo) : null,
  }));
}

async validateCustomer(
  providerSlug: string,
  accountNumber: string,
): Promise<import('./types').AnchorCustomerValidation> {
  return this.breaker.exec(() =>
    this.executeWithRetry(() =>
      this.client.get<import('./types').AnchorCustomerValidation>(
        `/bills/customer-validation/${encodeURIComponent(providerSlug)}/${encodeURIComponent(accountNumber)}`,
      ),
    ),
  );
}

async payBill(
  input: import('./types').AnchorBillRequest,
  idempotencyKey: string,
): Promise<import('./types').AnchorBillResponse> {
  return this.execIdempotent('anchor.bill', idempotencyKey, () =>
    this.client.post<import('./types').AnchorBillResponse>('/bills', input, { idempotencyKey }),
  );
}
```

> The response is consumed flat (`res.status`, `res.commissionKobo`) exactly as `transfer` consumes `AnchorTransferResponse`. `client.post` returns the parsed JSON cast to the typed shape — no mapping, matching every other method. If the live-E2E gate reveals a nested/renamed response, add a mapper here (one place) + update this test; that is the same open work `transfer` carries.

- [ ] **Step 5: Run — expect PASS.** Same vitest command.
- [ ] **Step 6: Commit.** `git commit -am "feat(vas): Anchor bill-payment adapter methods + types"`

---

## Task 4: VAS config + commission helper

**Files:**
- Create: `apps/backend/src/modules/vas/config.ts`
- Create: `apps/backend/src/modules/vas/commission.ts`
- Test: `apps/backend/tests/modules/vas/commission.test.ts`

> Commission is authoritative from Anchor's response (`commissionKobo`). `computeCommissionKobo` exists only as the **fallback/expected** value when Anchor omits it and for the buyer-facing quote — it must apply the confirmed rate + cap and floor to whole kobo, never a float.

- [ ] **Step 1: Write `config.ts`:**

```typescript
import type { VasBillType } from '../../integrations/anchor/types';

export type VasCategory = 'airtime' | 'data' | 'electricity' | 'cabletv';
export type RecipientKind = 'phone' | 'meter' | 'smartcard';

export const VAS_ANCHOR_TYPE: Record<VasCategory, VasBillType> = {
  airtime: 'Airtime',
  data: 'Data',
  electricity: 'Electricity',
  cabletv: 'CableTV',
};

export const VAS_RECIPIENT_KIND: Record<VasCategory, RecipientKind> = {
  airtime: 'phone',
  data: 'phone',
  electricity: 'meter',
  cabletv: 'smartcard',
};

/** Categories that require Anchor customer-validation before payment. */
export const REQUIRES_VALIDATION: Record<VasCategory, boolean> = {
  airtime: false,
  data: false,
  electricity: true,
  cabletv: true,
};

// Confirmed rates (Anchor 2026-06-30). basisPoints of amount, capped. cap=null → uncapped.
export const VAS_COMMISSION: Record<VasCategory, { bps: number; capKobo: bigint | null }> = {
  airtime: { bps: 200, capKobo: null }, // 2%
  data: { bps: 200, capKobo: null }, // 2%
  electricity: { bps: 100, capKobo: 100_000n }, // 1%, cap ₦1,000
  cabletv: { bps: 120, capKobo: 150_000n }, // 1.2%, cap ₦1,500
};
```

- [ ] **Step 2: Write the failing commission test:**

```typescript
import { describe, expect, it } from 'vitest';
import { computeCommissionKobo } from '../../../src/modules/vas/commission';

describe('computeCommissionKobo', () => {
  it('airtime 2% of ₦1,000 = ₦20', () => {
    expect(computeCommissionKobo('airtime', 100_000n)).toBe(2_000n);
  });
  it('electricity 1% capped at ₦1,000 for a ₦200,000 bill', () => {
    expect(computeCommissionKobo('electricity', 20_000_000n)).toBe(100_000n); // cap hit
  });
  it('floors to whole kobo (no float)', () => {
    expect(computeCommissionKobo('cabletv', 12_345n)).toBe(148n); // 1.2% of 12345 = 148.14 → 148
  });
  it('never exceeds the amount', () => {
    expect(computeCommissionKobo('airtime', 1n)).toBe(0n);
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vas/commission.test.ts`

- [ ] **Step 4: Implement `commission.ts`:**

```typescript
import { type VasCategory, VAS_COMMISSION } from './config';

/**
 * Expected reseller commission in kobo: `floor(amount * bps / 10000)`, capped, and never > amount.
 * All-bigint (no float). Anchor's response value is authoritative at settle; this is the fallback/quote.
 */
export function computeCommissionKobo(category: VasCategory, amountKobo: bigint): bigint {
  const { bps, capKobo } = VAS_COMMISSION[category];
  let c = (amountKobo * BigInt(bps)) / 10_000n; // floor via integer division
  if (capKobo !== null && c > capKobo) c = capKobo;
  if (c > amountKobo) c = amountKobo;
  return c;
}
```

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit.** `git commit -am "feat(vas): category config + commission helper"`

---

## Task 5: Extend `sumDebitsInWindow` to count VAS holds

**Files:**
- Modify: `apps/backend/src/modules/wallet/postings.repo.ts:87-110` (the `sumDebitsInWindow` SQL)
- Test: `apps/backend/tests/modules/wallet/spend-limit-vas.test.ts`

> A VAS purchase debits the `sub` LA (source). It must consume the same limit window as a spend / marketplace hold. VAS status **is** the txn status (`in_flight` pending, `settled` success, `failed` refunded), so — unlike marketplace's `EXISTS redemptions` join — we filter directly on `t.status IN ('in_flight','settled')`. A refunded (`failed`) VAS purchase drops out automatically.

- [ ] **Step 1: Write the failing test** (mirror the marketplace window test): seed a sub-wallet with a ₦10,000 daily limit; insert a `vas_purchase` reserve of ₦4,000 (status `in_flight`); assert `wouldExceedSpendLimit(db, sw, 7_000n, now) === true` (4,000 + 7,000 > 10,000) and `=== false` for `6_000n`; then set the VAS txn `failed` and assert a ₦7,000 reserve no longer exceeds.

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { kobo } from '../../../src/lib/kobo';
import { wouldExceedSpendLimit } from '../../../src/modules/transactions/spend-limit';
import { truncateAll, testDb } from '../../helpers/test-db';
// ...import factories + repos as in tests/modules/marketplace/purchase.service.test.ts seed()

beforeEach(truncateAll);

describe('spend-limit counts vas_purchase holds', () => {
  it('an in_flight VAS hold consumes the window; a failed one does not', async () => {
    const { sw } = await seedWithLimit(10_000n); // daily limit rule = ₦10,000
    const now = new Date();
    const txn = await insertVasReserve(sw.sub.id, sw.ledgerAccountId, kobo(4_000n)); // helper: kind vas_purchase, in_flight
    expect(await wouldExceedSpendLimit(testDb, sw.sub.id, kobo(7_000n), now)).toBe(true);
    expect(await wouldExceedSpendLimit(testDb, sw.sub.id, kobo(6_000n), now)).toBe(false);
    await setTxnStatus(txn.id, 'failed');
    expect(await wouldExceedSpendLimit(testDb, sw.sub.id, kobo(7_000n), now)).toBe(false);
  });
});
```

(Write `seedWithLimit`, `insertVasReserve`, `setTxnStatus` as local helpers reusing `transactionsRepo.insert` + `ledgerService.writeDoubleEntry` + `rulesRepo`; copy the limit-rule seed from the marketplace spend-limit test.)

- [ ] **Step 2: Run — expect FAIL** (VAS hold not counted → returns false where true expected).

- [ ] **Step 3: Add the third OR branch** in `sumDebitsInWindow`, after the `marketplace_purchase` branch (before the closing `)`):

```sql
          OR (
            t.kind = 'vas_purchase'
            AND t.status IN ('in_flight', 'settled')
            AND t.created_at >= ${cutoff.toISOString()}::timestamptz
          )
```

- [ ] **Step 4: Run — expect PASS.** Also run the existing marketplace + spend-limit window tests to confirm no regression: `pnpm --filter @amana/backend exec vitest run tests/modules/wallet tests/modules/marketplace`.
- [ ] **Step 5: Commit.** `git commit -am "feat(vas): count vas_purchase holds in the spend-limit window"`

---

## Task 6: Repos — `vas-purchases.repo.ts` + `beneficiaries.repo.ts`

**Files:**
- Create: `apps/backend/src/modules/vas/vas-purchases.repo.ts`
- Create: `apps/backend/src/modules/vas/beneficiaries.repo.ts`
- Test: covered indirectly by service tests (Tasks 7–9); no standalone test.

- [ ] **Step 1: `vas-purchases.repo.ts`** — mirror `redemptions.repo.ts` (typed insert with pre-generated id, `findById`, `findByTransactionId`, `setResult`, `listByBuyer`):

```typescript
import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vasPurchases } from '../../db/schema/vas';

type DbOrTx = PostgresJsDatabase;

export const vasPurchasesRepo = {
  async insert(db: DbOrTx, row: typeof vasPurchases.$inferInsert) {
    const [r] = await db.insert(vasPurchases).values(row).returning();
    return r;
  },
  async findById(db: DbOrTx, id: string) {
    const [r] = await db.select().from(vasPurchases).where(eq(vasPurchases.id, id)).limit(1);
    return r ?? null;
  },
  async findByTransactionId(db: DbOrTx, transactionId: string) {
    const [r] = await db
      .select()
      .from(vasPurchases)
      .where(eq(vasPurchases.transactionId, transactionId))
      .limit(1);
    return r ?? null;
  },
  async setResult(
    db: DbOrTx,
    id: string,
    patch: { status: 'pending' | 'successful' | 'failed'; anchorBillId?: string; token?: string | null; commissionKobo?: bigint; completedAt?: Date | null },
  ) {
    await db.update(vasPurchases).set(patch).where(eq(vasPurchases.id, id));
  },
  async listByBuyer(db: DbOrTx, buyerUserId: string) {
    return db
      .select()
      .from(vasPurchases)
      .where(eq(vasPurchases.buyerUserId, buyerUserId))
      .orderBy(desc(vasPurchases.createdAt));
  },
};
```

- [ ] **Step 2: `beneficiaries.repo.ts`:**

```typescript
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { vasBeneficiaries } from '../../db/schema/vas';

type DbOrTx = PostgresJsDatabase;

export const beneficiariesRepo = {
  async insert(db: DbOrTx, row: typeof vasBeneficiaries.$inferInsert) {
    const [r] = await db.insert(vasBeneficiaries).values(row).returning();
    return r;
  },
  async listActive(db: DbOrTx, subWalletId: string) {
    return db
      .select()
      .from(vasBeneficiaries)
      .where(and(eq(vasBeneficiaries.subWalletId, subWalletId), eq(vasBeneficiaries.active, true)));
  },
  async findActive(db: DbOrTx, subWalletId: string, kind: string, value: string) {
    const [r] = await db
      .select()
      .from(vasBeneficiaries)
      .where(
        and(
          eq(vasBeneficiaries.subWalletId, subWalletId),
          eq(vasBeneficiaries.kind, kind as never),
          eq(vasBeneficiaries.value, value),
          eq(vasBeneficiaries.active, true),
        ),
      )
      .limit(1);
    return r ?? null;
  },
  async findById(db: DbOrTx, id: string) {
    const [r] = await db.select().from(vasBeneficiaries).where(eq(vasBeneficiaries.id, id)).limit(1);
    return r ?? null;
  },
  async deactivate(db: DbOrTx, id: string) {
    await db.update(vasBeneficiaries).set({ active: false }).where(eq(vasBeneficiaries.id, id));
  },
};
```

- [ ] **Step 3: Typecheck.** Run: `pnpm --filter @amana/backend typecheck` — Expected PASS.
- [ ] **Step 4: Commit.** `git commit -am "feat(vas): vas-purchases + beneficiaries repos"`

---

## Task 7: Beneficiary service + recipient-control gate

**Files:**
- Create: `apps/backend/src/modules/vas/beneficiaries.service.ts`
- Test: `apps/backend/tests/modules/vas/beneficiaries.service.test.ts`

> `assertRecipientAllowed` is the cash-out control. Airtime/data to the **agent's own registered phone** (`users.phone` where `id = sub.agentUserId`) is always allowed. Any other recipient must be an active beneficiary. Principal-direct (`subWalletId null`) purchases skip the allowlist (principal owns the funds, decision #17 parity). Add/remove is **principal-only** and authorized via `assertSubWalletAccess`.

- [ ] **Step 1: Write failing tests:**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { ForbiddenError } from '../../../src/lib/errors';
import { beneficiariesService } from '../../../src/modules/vas/beneficiaries.service';
import { truncateAll, testDb } from '../../helpers/test-db';
// seed() from marketplace purchase test: returns { principal, agent, mw, sw }

beforeEach(truncateAll);

describe('assertRecipientAllowed', () => {
  it('allows airtime to the agent’s own phone without a beneficiary', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: agent.phone,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects airtime to an un-approved other number', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: '+2348099999999',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows an approved beneficiary', async () => {
    const { principal, agent, sw } = await seed();
    await beneficiariesService.add(testDb, {
      actorUserId: principal.id,
      subWalletId: sw.sub.id,
      kind: 'phone',
      value: '+2348099999999',
      label: 'Mum',
    });
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'airtime',
        recipient: '+2348099999999',
      }),
    ).resolves.toBeUndefined();
  });

  it('requires an approved meter for electricity (no own-meter concept)', async () => {
    const { agent, sw } = await seed();
    await expect(
      beneficiariesService.assertRecipientAllowed(testDb, {
        subWalletId: sw.sub.id,
        agentUserId: agent.id,
        category: 'electricity',
        recipient: '01234567890',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('add is rejected for a non-owning principal', async () => {
    const { sw } = await seed();
    const other = await makeOtherPrincipal();
    await expect(
      beneficiariesService.add(testDb, {
        actorUserId: other.id,
        subWalletId: sw.sub.id,
        kind: 'phone',
        value: '+2348012345678',
        label: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `beneficiaries.service.ts`:**

```typescript
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ForbiddenError } from '../../lib/errors';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { usersRepo } from '../identity/users.repo';
import { assertSubWalletAccess } from '../wallet/wallet-access.service';
import { type VasCategory, VAS_RECIPIENT_KIND } from './config';
import { beneficiariesRepo } from './beneficiaries.repo';
import { normalizeRecipient } from './recipient';

type DbOrTx = PostgresJsDatabase;

export const beneficiariesService = {
  async add(
    db: DbOrTx,
    input: { actorUserId: string; subWalletId: string; kind: 'phone' | 'meter' | 'smartcard'; value: string; label: string },
  ) {
    // Principal-only: authorize the actor owns the sub-wallet's household.
    await assertSubWalletAccess(db, input.actorUserId, input.subWalletId, { principalOnly: true });
    return beneficiariesRepo.insert(db, {
      subWalletId: input.subWalletId,
      kind: input.kind,
      value: normalizeRecipient(input.kind, input.value),
      label: input.label,
      createdByUserId: input.actorUserId,
    });
  },

  async list(db: DbOrTx, actorUserId: string, subWalletId: string) {
    await assertSubWalletAccess(db, actorUserId, subWalletId); // owner (principal) or the agent may read
    return beneficiariesRepo.listActive(db, subWalletId);
  },

  async remove(db: DbOrTx, actorUserId: string, id: string) {
    const b = await beneficiariesRepo.findById(db, id);
    if (!b) throw new ForbiddenError('beneficiary not found');
    await assertSubWalletAccess(db, actorUserId, b.subWalletId, { principalOnly: true });
    await beneficiariesRepo.deactivate(db, id);
  },

  /** The cash-out control gate. Throws ForbiddenError if the recipient is not permitted. */
  async assertRecipientAllowed(
    db: DbOrTx,
    input: { subWalletId: string | null; agentUserId: string | null; category: VasCategory; recipient: string },
  ): Promise<void> {
    if (!input.subWalletId) return; // principal-direct: principal owns the funds
    const kind = VAS_RECIPIENT_KIND[input.category];
    const value = normalizeRecipient(kind, input.recipient);

    // Own registered phone is always allowed for phone categories.
    if (kind === 'phone' && input.agentUserId) {
      const agent = await usersRepo.findById(db, input.agentUserId);
      if (agent && normalizeRecipient('phone', agent.phone) === value) return;
    }
    const hit = await beneficiariesRepo.findActive(db, input.subWalletId, kind, value);
    if (!hit) {
      throw new ForbiddenError(`recipient ${value} is not an approved ${kind} beneficiary`);
    }
  },
};
```

Also create `apps/backend/src/modules/vas/recipient.ts`:

```typescript
/** Normalize a recipient value for comparison/storage. Phones → digits with leading +234; others → trimmed digits. */
export function normalizeRecipient(kind: 'phone' | 'meter' | 'smartcard', raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (kind !== 'phone') return digits;
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}
```

> **Check the real `assertSubWalletAccess` signature** in `modules/wallet/wallet-access.service.ts`. If it does not accept a `{ principalOnly }` option, add one (it must reject when the actor is the agent, allowing only the owning principal) — or use the existing principal-ownership helper. Do not invent an API; adapt to what exists. Likewise confirm `usersRepo.findById` exists (else use a direct `users` select).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(vas): beneficiary allowlist + recipient-control gate"`

---

## Task 8: VAS settlement service (commission carve)

**Files:**
- Create: `apps/backend/src/modules/vas/vas-settlement.service.ts`
- Test: `apps/backend/tests/modules/vas/vas-settlement.service.test.ts`

> Mirrors `redemption-settlement.service.finalise` exactly: `debit suspense = amount`, `credit external = amount − commission`, `credit commission = commission`, omitting a zero-amount leg. Idempotent on `status==='settled'`. Sets the money txn `settled` and the `vas_purchases` row `successful` (+token). **No ₦100 fee.**

- [ ] **Step 1: Write failing test** — seed a `vas_purchase` reserve (helper reused from Task 5), then `finalise` and assert: exactly 3 postings on the txn; suspense debited `amount`; external credited `amount−commission`; commission LA credited `commission`; txn `settled`; vas row `successful` with token; second `finalise` is a no-op (idempotent).

```typescript
it('settles: suspense debit = external credit (amount−commission) + commission credit', async () => {
  const { sw, mw } = await seedWithLimit(1_000_000n);
  const { txn, vas } = await reserveVas(sw, mw, { amount: 100_000n, commission: 2_000n });
  await vasSettlementService.finalise(testDb, {
    transactionId: txn.id, commissionKobo: 2_000n, token: 'TKN-1', settledAt: new Date(),
  });
  const legs = await postingsRepo.listByTransaction(testDb, txn.id);
  // reserve wrote 2 legs; settle writes 3 more → 5 total on the txn
  const settleLegs = legs.filter((l) => /* posted after reserve */ true);
  expect(legs.length).toBe(5);
  const suspenseBal = await postingsRepo.accountBalance(testDb, mw.ledgerAccountIds.suspense);
  expect(suspenseBal).toBe(0n); // reserve +100k credit, settle -100k debit → net 0
  const commissionLA = await ledgerAccountsRepo.findByMasterAndKind(testDb, mw.master.id, 'commission');
  expect(await postingsRepo.accountBalance(testDb, commissionLA!.id)).toBe(-2_000n); // credit-normal
  const settled = await transactionsRepo.findById(testDb, txn.id);
  expect(settled!.status).toBe('settled');
  const vasRow = await vasPurchasesRepo.findByTransactionId(testDb, txn.id);
  expect(vasRow!.status).toBe('successful');
  expect(vasRow!.token).toBe('TKN-1');
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `vas-settlement.service.ts`** (adapt `redemption-settlement.finalise`; no NIBSS, no redemption row — use `vas_purchases`):

```typescript
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { kobo } from '../../lib/kobo';
import { logger } from '../../lib/logger';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { notificationService } from '../notifications/notification.service';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { vasPurchasesRepo } from './vas-purchases.repo';

type DbOrTx = PostgresJsDatabase;

export type VasFinaliseInput = {
  transactionId: string;
  commissionKobo: bigint;
  token: string | null;
  settledAt: Date;
};

export const vasSettlementService = {
  async finalise(db: DbOrTx, input: VasFinaliseInput): Promise<void> {
    const notify = await db.transaction<{ buyerUserId: string; subWalletId: string | null; amount: bigint } | null>(
      async (txx) => {
        const tx = txx as DbOrTx;
        const txn = await transactionsRepo.findById(tx, input.transactionId);
        if (!txn) throw new Error(`vas txn ${input.transactionId} not found`);
        if (txn.status === 'settled') return null; // idempotent
        if (txn.status !== 'in_flight') throw new Error(`cannot settle vas txn in status ${txn.status}`);

        const vas = await vasPurchasesRepo.findByTransactionId(tx, txn.id);
        if (!vas) throw new Error(`no vas_purchase for txn ${txn.id}`);

        const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(tx, txn.masterWalletId, 'suspense');
        if (!suspenseLA) throw new Error('master wallet missing suspense LA');
        let externalLA = await ledgerAccountsRepo.findByMasterAndKind(tx, txn.masterWalletId, 'external');
        if (!externalLA) externalLA = await ledgerAccountsRepo.insert(tx, { masterWalletId: txn.masterWalletId, kind: 'external', normalSide: 'credit' });
        let commissionLA = await ledgerAccountsRepo.findByMasterAndKind(tx, txn.masterWalletId, 'commission');
        if (!commissionLA) commissionLA = await ledgerAccountsRepo.insert(tx, { masterWalletId: txn.masterWalletId, kind: 'commission', normalSide: 'credit' });

        const amount = txn.amountKobo as bigint;
        let commission = input.commissionKobo;
        if (commission < 0n) commission = 0n;
        if (commission > amount) commission = amount;
        const external = amount - commission;
        if (amount !== external + commission) throw new Error(`vas carve invalid: ${amount} != ${external}+${commission}`);

        const legs = [{ ledgerAccountId: suspenseLA.id, debitKobo: kobo(amount), creditKobo: kobo(0n) }];
        if (external > 0n) legs.push({ ledgerAccountId: externalLA.id, debitKobo: kobo(0n), creditKobo: kobo(external) });
        if (commission > 0n) legs.push({ ledgerAccountId: commissionLA.id, debitKobo: kobo(0n), creditKobo: kobo(commission) });
        await ledgerService.writeDoubleEntry(tx, txn.id, legs);

        await transactionsRepo.setStatus(tx, txn.id, 'settled', input.settledAt);
        await vasPurchasesRepo.setResult(tx, vas.id, { status: 'successful', commissionKobo: commission, token: input.token, completedAt: input.settledAt });

        await auditRepo.append(tx, auditEvents.vasPurchaseSettled({
          vasPurchaseId: vas.id, transactionId: txn.id, category: vas.category, commissionKobo: commission, settledAt: input.settledAt,
        }));
        return { buyerUserId: vas.buyerUserId, subWalletId: txn.subWalletId, amount };
      },
    );

    if (!notify) return;
    try {
      await notificationService.dispatch(db, {
        kind: 'txn_settled',
        recipientUserId: notify.buyerUserId,
        dedupeKey: `vas-settled:${input.transactionId}`,
        amountKobo: kobo(notify.amount),
        subWalletId: notify.subWalletId ?? undefined,
        payload: { transactionId: input.transactionId, subWalletId: notify.subWalletId ?? null, amountKobo: kobo(notify.amount), vendorResolvedName: 'VAS', nibssSessionId: null },
      });
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'vas_settled notification failed (non-fatal)');
    }
  },
};
```

> Confirm `auditEvents.vasPurchaseSettled` — you add it in Task 11; if executing strictly in order, stub the audit call to `auditEvents` you create now, or add the event first. Keep the notification `kind` to an existing enum value (`txn_settled`); do not add a notification kind.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(vas): settlement service — commission carve, no fee"`

---

## Task 9: Purchase service (reserve → payBill → settle/reverse)

**Files:**
- Create: `apps/backend/src/modules/vas/purchase.service.ts`
- Test: `apps/backend/tests/modules/vas/purchase.service.test.ts`

> The core. Mirrors `nip-out.service.send`: authorize → recipient gate → (electricity/cable) validate customer → reserve under advisory lock + `wouldExceedSpendLimit` → call `adapter.payBill` → branch on status. `COMPLETED` settles inline via `vasSettlementService.finalise`; `PENDING`/`INITIATED` stays `in_flight` (webhook settles); `FAILED` or a thrown `AnchorHttpError` reverses (refunds) + marks vas row `failed`. Over-limit → `LimitExceededError`. The Anchor `DepositAccount` id is the master wallet's `anchorAccountId` (Amana's operating account funds the bill; the internal ledger already moved the buyer's money to suspense).

- [ ] **Step 1: Write failing tests** (the behavior matrix):
  - `(a)` under-limit airtime to own phone, Anchor `PENDING` → reserve legs written (debit sub, credit suspense), txn `in_flight`, vas row `pending`, `anchorBillId` set; spend-limit window now includes it.
  - `(b)` Anchor returns `COMPLETED` → settled inline (suspense drained, commission credited, txn `settled`, vas `successful`).
  - `(c)` Anchor throws `AnchorHttpError` → reversed (source restored, txn `failed`, vas `failed`), error surfaced as failure result (no throw to caller, mirroring nip-out) OR rethrow — match nip-out's contract (returns `{ status:'FAILED', reversed:true }`).
  - `(d)` Anchor 200 `status:'FAILED'` → reversed + vas `failed`.
  - `(e)` agent over the daily limit → `LimitExceededError`, **nothing written** (no txn/vas/postings, no Anchor call).
  - `(f)` recipient not allowed → `ForbiddenError`, no Anchor call, nothing written.
  - `(g)` electricity: `validateCustomer` invalid (adapter throws) → rejected before reserve.
  - `(h)` idempotency: same `idempotencyKey` twice → second returns the existing txn, no double debit (rely on `transactions.idempotency_key` UNIQUE; catch the conflict).
  - `(i)` sync/webhook race: pre-set the reserved txn to `settled` (simulating a `bills.successful` webhook that landed first), then a `COMPLETED` `payBill` response → `create` does NOT throw and does NOT double-settle (returns `status:'settled'`, ledger unchanged from the webhook's settle). Same for a pre-`failed` txn + `FAILED` response.

Use a fake adapter (`vi.fn`) returning canned `AnchorBillResponse`s; assert `postingsRepo.listByTransaction`, `transactionsRepo.findById`, `vasPurchasesRepo.findByTransactionId`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `purchase.service.ts`:**

```typescript
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { masterWallets } from '../../db/schema';
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorHttpError } from '../../integrations/anchor/client';
import { ConflictError, LimitExceededError } from '../../lib/errors';
import { kobo } from '../../lib/kobo';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { subWalletsRepo } from '../wallet/sub-wallets.repo';
import { transactionsRepo } from '../wallet/transactions.repo';
import { assertWalletAccess } from '../wallet/wallet-access.service';
import { wouldExceedSpendLimit } from '../transactions/spend-limit';
import { reversalService } from '../transactions/reversal.service';
import { beneficiariesService } from './beneficiaries.service';
import { computeCommissionKobo } from './commission';
import { type VasCategory, VAS_ANCHOR_TYPE, VAS_RECIPIENT_KIND, REQUIRES_VALIDATION } from './config';
import { normalizeRecipient } from './recipient';
import { vasPurchasesRepo } from './vas-purchases.repo';
import { vasSettlementService } from './vas-settlement.service';

type DbOrTx = PostgresJsDatabase;

export type VasCreateInput = {
  actorUserId: string;
  masterWalletId: string;
  subWalletId: string | null;
  category: VasCategory;
  provider: string; // biller slug
  productSlug?: string | null;
  recipient: string;
  amountKobo: bigint;
  idempotencyKey: string;
  now?: Date;
};

export type VasCreateOutput = {
  transactionId: string;
  vasPurchaseId: string;
  status: 'in_flight' | 'settled' | 'failed';
};

export const vasPurchaseService = {
  async create(db: DbOrTx, adapter: AnchorAdapter, input: VasCreateInput): Promise<VasCreateOutput> {
    const now = input.now ?? new Date();
    // 1. Authorize the actor against the wallet (identity vs ownership, never the role claim).
    await assertWalletAccess(db, input.actorUserId, { masterWalletId: input.masterWalletId, subWalletId: input.subWalletId });

    // Idempotency short-circuit: return the existing purchase if this key was already used.
    const existing = await transactionsRepo.findByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      const v = await vasPurchasesRepo.findByTransactionId(db, existing.id);
      if (v) return { transactionId: existing.id, vasPurchaseId: v.id, status: existing.status as VasCreateOutput['status'] };
    }

    const kind = VAS_RECIPIENT_KIND[input.category];
    const recipient = normalizeRecipient(kind, input.recipient);

    // 2. Recipient control gate (cash-out guard).
    let agentUserId: string | null = null;
    if (input.subWalletId) {
      const sub = await subWalletsRepo.findById(db, input.subWalletId);
      if (!sub) throw new Error(`sub_wallet ${input.subWalletId} not found`);
      agentUserId = sub.agentUserId;
    }
    await beneficiariesService.assertRecipientAllowed(db, { subWalletId: input.subWalletId, agentUserId, category: input.category, recipient });

    // 3. Validate the customer for electricity/cable (throws AnchorHttpError if invalid).
    let customerName: string | null = null;
    if (REQUIRES_VALIDATION[input.category]) {
      const v = await adapter.validateCustomer(input.provider, recipient);
      customerName = v.customerName;
    }

    // 4. Reserve under the per-sub-wallet advisory lock + limit gate (mirror nip-out).
    const amount = input.amountKobo;
    const { txnId, vasId } = await db.transaction(async (txx) => {
      const tx = txx as DbOrTx;
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(tx, input.masterWalletId, 'master');
      const suspenseLA = await ledgerAccountsRepo.findByMasterAndKind(tx, input.masterWalletId, 'suspense');
      if (!masterLA || !suspenseLA) throw new Error('master wallet missing master/suspense LAs');
      const sourceLA = input.subWalletId ? await ledgerAccountsRepo.findBySubWallet(tx, input.subWalletId) : masterLA;
      if (!sourceLA) throw new Error('source ledger account missing');

      if (input.subWalletId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.subWalletId}))`);
        if (await wouldExceedSpendLimit(tx, input.subWalletId, kobo(amount), now)) {
          throw new LimitExceededError(`vas purchase exceeds sub-wallet spend limit: ${amount}`);
        }
      }

      const txn = await transactionsRepo.insert(tx, {
        masterWalletId: input.masterWalletId,
        subWalletId: input.subWalletId,
        kind: 'vas_purchase',
        amountKobo: kobo(amount),
        idempotencyKey: input.idempotencyKey,
      });
      await ledgerService.writeDoubleEntry(tx, txn.id, [
        { ledgerAccountId: sourceLA.id, debitKobo: kobo(amount), creditKobo: kobo(0n) },
        { ledgerAccountId: suspenseLA.id, debitKobo: kobo(0n), creditKobo: kobo(amount) },
      ]);
      const vas = await vasPurchasesRepo.insert(tx, {
        transactionId: txn.id,
        buyerUserId: input.actorUserId,
        masterWalletId: input.masterWalletId,
        subWalletId: input.subWalletId,
        category: input.category,
        provider: input.provider,
        productSlug: input.productSlug ?? null,
        recipientKind: kind,
        recipient,
        customerName,
        amountKobo: kobo(amount),
        commissionKobo: kobo(computeCommissionKobo(input.category, amount)),
        status: 'pending',
      });
      return { txnId: txn.id, vasId: vas.id };
    }).catch((e) => {
      // UNIQUE(idempotency_key) race → treat as idempotent replay.
      if (isUniqueViolation(e)) throw new ConflictError(`vas purchase already exists: ${input.idempotencyKey}`);
      throw e;
    });

    // 5. Look up Amana's Anchor operating account (the DepositAccount that funds the bill).
    const [mw] = await db.select().from(masterWallets).where(eq(masterWallets.id, input.masterWalletId)).limit(1);
    if (!mw) throw new Error(`master_wallet ${input.masterWalletId} disappeared`);

    // 6. Call Anchor — synchronous failure reverses (refunds) cleanly.
    let response: import('../../integrations/anchor/types').AnchorBillResponse;
    try {
      response = await adapter.payBill(
        {
          type: VAS_ANCHOR_TYPE[input.category],
          provider: kind === 'phone' ? input.provider : undefined,
          productSlug: input.productSlug ?? undefined,
          phoneNumber: kind === 'phone' ? recipient : undefined,
          meterAccountNumber: kind !== 'phone' ? recipient : undefined,
          amountKobo: amount,
          reference: input.idempotencyKey,
          accountId: mw.anchorAccountId,
        },
        input.idempotencyKey,
      );
    } catch (e) {
      const reason = e instanceof AnchorHttpError ? `Anchor HTTP ${e.status}` : `Anchor error: ${(e as Error).message}`;
      if (await stillInFlight(db, txnId)) {
        await reversalService.reverse(db, { transactionId: txnId, reason, failedAt: now });
        await vasPurchasesRepo.setResult(db, vasId, { status: 'failed', completedAt: now });
        await auditRepo.append(db, auditEvents.vasPurchaseFailed({ vasPurchaseId: vasId, transactionId: txnId, reason, failedAt: now }));
      }
      return { transactionId: txnId, vasPurchaseId: vasId, status: 'failed' };
    }

    await vasPurchasesRepo.setResult(db, vasId, { anchorBillId: response.id, commissionKobo: response.commissionKobo });

    // Guard the sync/webhook race: a `bills.*` webhook may have already reached the txn's terminal
    // state between our reserve and this response. Only act on a still-in_flight txn; otherwise the
    // webhook already settled/reversed it and this inline branch is a no-op (settle/reverse would
    // otherwise throw `cannot settle/reverse txn in status …` → 500).
    if (!(await stillInFlight(db, txnId))) {
      const cur = await transactionsRepo.findById(db, txnId);
      return { transactionId: txnId, vasPurchaseId: vasId, status: (cur?.status as VasCreateOutput['status']) ?? 'in_flight' };
    }

    if (response.status === 'FAILED') {
      await reversalService.reverse(db, { transactionId: txnId, reason: response.failureReason ?? 'Anchor status=FAILED', failedAt: now });
      await vasPurchasesRepo.setResult(db, vasId, { status: 'failed', completedAt: now });
      return { transactionId: txnId, vasPurchaseId: vasId, status: 'failed' };
    }

    if (response.status === 'COMPLETED') {
      await vasSettlementService.finalise(db, { transactionId: txnId, commissionKobo: response.commissionKobo, token: response.token, settledAt: now });
      return { transactionId: txnId, vasPurchaseId: vasId, status: 'settled' };
    }

    // PENDING / INITIATED → wait for the webhook.
    await auditRepo.append(db, auditEvents.vasPurchaseInitiated({ vasPurchaseId: vasId, transactionId: txnId, anchorBillId: response.id, category: input.category, now }));
    return { transactionId: txnId, vasPurchaseId: vasId, status: 'in_flight' };
  },
};

async function stillInFlight(db: DbOrTx, txnId: string): Promise<boolean> {
  const t = await transactionsRepo.findById(db, txnId);
  return t?.status === 'in_flight';
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
```

> Verify: `transactionsRepo.findByIdempotencyKey` exists (webhooks.ts uses it — yes). `transactionsRepo.insert` accepts `kind:'vas_purchase'` (enum now includes it). Do NOT set `sent_at` (VAS window uses `created_at`). Match `reversalService.reverse` signature exactly.

- [ ] **Step 4: Run — expect PASS** (all matrix cases).
- [ ] **Step 5: Commit.** `git commit -am "feat(vas): purchase service — reserve, pay, settle/refund"`

---

## Task 10: Webhook wiring (`bills.*`)

**Files:**
- Modify: `apps/backend/src/integrations/anchor/webhook.ts:11-17` (add to `KNOWN_TYPES`)
- Modify: `apps/backend/src/routes/webhooks.ts` (add dispatch branches)
- Test: `apps/backend/tests/routes/webhooks-bills.test.ts`

> `bills.successful` → `vasSettlementService.finalise` (look up txn by `data.reference` = idempotency key); `bills.failed` → `reversalService.reverse` + mark vas `failed`. Both run **inside** the existing audit-dedupe transaction so a replayed webhook is a no-op and a handler error rolls back → Anchor retries. `bills.initiated` is acknowledged (audited) but takes no ledger action.

- [ ] **Step 1: Write failing tests** — POST a signed `bills.successful` webhook for a `PENDING` VAS txn → txn `settled`, vas `successful`, commission credited; a duplicate delivery → `deduped:true`, no double-settle. `bills.failed` → txn `failed`, source refunded, vas `failed`. (Sign with `ANCHOR_WEBHOOK_SECRET` HMAC like the existing webhook tests.)

- [ ] **Step 2: Run — expect FAIL** (unknown webhook type → 400/throw).

- [ ] **Step 3: Add `bills.*` to `KNOWN_TYPES`** in `webhook.ts`:

```typescript
const KNOWN_TYPES: ReadonlySet<AnchorWebhookEventType> = new Set([
  'transfer.completed',
  'transfer.failed',
  'virtual_account.credited',
  'kyc.approved',
  'kyc.rejected',
  'bills.initiated',
  'bills.successful',
  'bills.failed',
]);
```

- [ ] **Step 4: Add dispatch branches** in `routes/webhooks.ts` (inside the claim transaction, after the existing `else if` chain), importing `vasSettlementService`, `reversalService`, `vasPurchasesRepo`, and the `AnchorBillEventData` type:

```typescript
} else if (event.type === 'bills.successful') {
  const data = event.data as AnchorBillEventData;
  const txn = await transactionsRepo.findByIdempotencyKey(tx, data.reference);
  if (txn && txn.kind === 'vas_purchase') {
    await vasSettlementService.finalise(tx, {
      transactionId: txn.id,
      commissionKobo: BigInt(data.commissionAmount ?? 0),
      token: data.token ?? null,
      settledAt: new Date(event.createdAt),
    });
  }
} else if (event.type === 'bills.failed') {
  const data = event.data as AnchorBillEventData;
  const txn = await transactionsRepo.findByIdempotencyKey(tx, data.reference);
  if (txn && txn.kind === 'vas_purchase' && txn.status === 'in_flight') {
    await reversalService.reverse(tx, {
      transactionId: txn.id,
      reason: data.failureReason ?? 'bill failed',
      failedAt: new Date(event.createdAt),
    });
    const vas = await vasPurchasesRepo.findByTransactionId(tx, txn.id);
    if (vas) await vasPurchasesRepo.setResult(tx, vas.id, { status: 'failed', completedAt: new Date(event.createdAt) });
  }
} else if (event.type === 'bills.initiated') {
  // acknowledged + audited by the outer claim; no ledger action.
}
```

> `vasSettlementService.finalise` opens its own `db.transaction`. Confirm nesting a transaction inside the webhook's claim tx is safe with `postgres-js` (savepoints) — the existing `settlementService.finalise` is called the same way inside this claim tx, so the pattern is proven. Pass `tx` (the claim tx), matching how `settlementService.finalise(tx, …)` is already called.

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit.** `git commit -am "feat(vas): route bills.successful/failed webhooks to settle/refund"`

---

## Task 11: Audit events

**Files:**
- Modify: `apps/backend/src/modules/audit/events.ts`
- Test: covered by service tests.

- [ ] **Step 1: Add the event builders** (mirror `marketplaceRedemptionSettled` shape — `action`, `subjectKind:'vas_purchase'`, `subjectId`, `payloadJson`):

```typescript
vasPurchaseInitiated: (p: { vasPurchaseId: string; transactionId: string; anchorBillId: string; category: string; now: Date }) => ({
  actorKind: 'user' as const, action: 'vas.purchase.initiated', subjectKind: 'vas_purchase' as const, subjectId: p.vasPurchaseId,
  payloadJson: { transactionId: p.transactionId, anchorBillId: p.anchorBillId, category: p.category, at: p.now.toISOString() },
}),
vasPurchaseSettled: (p: { vasPurchaseId: string; transactionId: string; category: string; commissionKobo: bigint; settledAt: Date }) => ({
  actorKind: 'partner' as const, action: 'vas.purchase.settled', subjectKind: 'vas_purchase' as const, subjectId: p.vasPurchaseId,
  payloadJson: { transactionId: p.transactionId, category: p.category, commissionKobo: p.commissionKobo.toString(), at: p.settledAt.toISOString() },
}),
vasPurchaseFailed: (p: { vasPurchaseId: string; transactionId: string; reason: string; failedAt: Date }) => ({
  actorKind: 'partner' as const, action: 'vas.purchase.failed', subjectKind: 'vas_purchase' as const, subjectId: p.vasPurchaseId,
  payloadJson: { transactionId: p.transactionId, reason: p.reason, at: p.failedAt.toISOString() },
}),
```

> Match the exact shape/types the real `auditEvents` object + `auditRepo.append` expect (check `actorKind`/`subjectKind` allowed values; add `'vas_purchase'` to the subject-kind union if it is a typed enum). Serialize bigint commission as a string (JSON-safe), matching existing events.

- [ ] **Step 2: Typecheck + run the VAS suite.** Run: `pnpm --filter @amana/backend exec vitest run tests/modules/vas`
- [ ] **Step 3: Commit.** `git commit -am "feat(vas): audit events for vas purchase lifecycle"`

---

## Task 12: HTTP routes + mount

**Files:**
- Create: `apps/backend/src/routes/vas.ts`
- Modify: `apps/backend/src/server.ts` (mount `vasRoute` at `/vas`)
- Create: `apps/backend/src/modules/vas/catalog.service.ts` (thin adapter proxy)
- Create: `apps/backend/src/modules/vas/index.ts` (barrel)
- Test: `apps/backend/tests/routes/vas.test.ts`, `apps/backend/tests/routes/vas-beneficiaries.test.ts`

> Follow `routes/marketplace.ts`: `jwtAuth()`, `parseBody`/Zod, UUIDs via `z.string().uuid()`, resolve the master wallet (sub-wallet's master for an agent buy, actor's household master for principal-direct), delegate to services (authz inside), map typed errors via the global handler. The `adapter` comes from the same place `webhooks`/nip routes get it (check `server.ts` — likely a module singleton `anchorAdapter`).

- [ ] **Step 1: `catalog.service.ts`** — pass-throughs with light shaping:

```typescript
import type { AnchorAdapter } from '../../integrations/anchor/adapter';
import type { VasCategory } from './config';

export const vasCatalogService = {
  listBillers: (adapter: AnchorAdapter, category: VasCategory) => adapter.listBillers(category),
  listProducts: (adapter: AnchorAdapter, billerId: string) => adapter.listProducts(billerId),
  validateCustomer: (adapter: AnchorAdapter, providerSlug: string, account: string) =>
    adapter.validateCustomer(providerSlug, account),
};
```

- [ ] **Step 2: Write failing route tests** — the key behaviors:
  - `POST /vas/purchase` under limit, own phone, fake adapter `PENDING` → `201 { purchase: { status:'pending', ... } }`.
  - over limit → `409 { error:'limit_exceeded' }`.
  - un-approved recipient → `403 { error:'forbidden' }`.
  - cross-owner sub-wallet → `403`.
  - malformed body (bad uuid / missing category) → `400`.
  - `GET /vas/billers?category=airtime` → `200` list (fake adapter).
  - `POST /vas/beneficiaries` by owning principal → `201`; by agent → `403`.
  - `GET /vas/purchases` → buyer's list.

  (Inject a fake adapter: export the route as a factory `vasRoute(adapter)` OR allow overriding the module singleton in tests, matching how existing nip/transfer route tests inject the adapter. Check `tests/routes/transactions*.test.ts` for the established injection pattern and follow it.)

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `routes/vas.ts`:**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { anchorAdapter } from '../integrations/anchor'; // confirm the real export path used elsewhere
import { db } from '../db/client'; // confirm the real db handle import used by routes
import { jwtAuth } from '../middleware/jwt-auth';
import { parseBody, parseQuery } from '../lib/validate';
import { NotFoundError } from '../lib/errors';
import type { Actor, ActorVariables } from '../middleware/types'; // match marketplace.ts imports
import { householdsRepo } from '../modules/identity/households.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';
import { vasPurchaseService } from '../modules/vas/purchase.service';
import { vasPurchasesRepo } from '../modules/vas/vas-purchases.repo';
import { beneficiariesService } from '../modules/vas/beneficiaries.service';
import { vasCatalogService } from '../modules/vas/catalog.service';

const CATEGORY = z.enum(['airtime', 'data', 'electricity', 'cabletv']);

const PurchaseBody = z.object({
  subWalletId: z.string().uuid().nullable().optional(),
  category: CATEGORY,
  provider: z.string().min(1),
  productSlug: z.string().min(1).nullable().optional(),
  recipient: z.string().min(3),
  amountKobo: z.coerce.bigint().positive(),
  idempotencyKey: z.string().min(1),
});

const BeneficiaryBody = z.object({
  subWalletId: z.string().uuid(),
  kind: z.enum(['phone', 'meter', 'smartcard']),
  value: z.string().min(3),
  label: z.string().min(1),
});

async function resolveMaster(actorUserId: string, subWalletId: string | null): Promise<string> {
  if (subWalletId) {
    const sw = await subWalletsRepo.findById(db, subWalletId);
    if (!sw) throw new NotFoundError(`sub-wallet ${subWalletId} not found`);
    return sw.masterWalletId;
  }
  const hh = await householdsRepo.findByPrincipal(db, actorUserId);
  if (!hh) throw new NotFoundError('no household for actor');
  const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
  if (!mw) throw new NotFoundError('no master wallet for household');
  return mw.id;
}

export const vasRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/billers', async (c) => {
    const q = await parseQuery(c, z.object({ category: CATEGORY }));
    if (q instanceof Response) return q;
    return c.json({ billers: await vasCatalogService.listBillers(anchorAdapter, q.category) });
  })
  .get('/billers/:billerId/products', async (c) => {
    return c.json({ products: await vasCatalogService.listProducts(anchorAdapter, c.req.param('billerId')) });
  })
  .get('/validate', async (c) => {
    const q = await parseQuery(c, z.object({ provider: z.string().min(1), account: z.string().min(3) }));
    if (q instanceof Response) return q;
    return c.json({ customer: await vasCatalogService.validateCustomer(anchorAdapter, q.provider, q.account) });
  })
  .post('/purchase', async (c) => {
    const body = await parseBody(c, PurchaseBody);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const subWalletId = body.subWalletId ?? null;
    const masterWalletId = await resolveMaster(a.userId, subWalletId);
    const out = await vasPurchaseService.create(db, anchorAdapter, {
      actorUserId: a.userId,
      masterWalletId,
      subWalletId,
      category: body.category,
      provider: body.provider,
      productSlug: body.productSlug ?? null,
      recipient: body.recipient,
      amountKobo: body.amountKobo,
      idempotencyKey: body.idempotencyKey,
    });
    const vas = await vasPurchasesRepo.findById(db, out.vasPurchaseId);
    return c.json({ purchase: serializeVas(vas) }, 201);
  })
  .get('/purchases', async (c) => {
    const a = c.get('actor') as Actor;
    const rows = await vasPurchasesRepo.listByBuyer(db, a.userId);
    return c.json({ purchases: rows.map(serializeVas) });
  })
  .post('/beneficiaries', async (c) => {
    const body = await parseBody(c, BeneficiaryBody);
    if (body instanceof Response) return body;
    const a = c.get('actor') as Actor;
    const b = await beneficiariesService.add(db, { actorUserId: a.userId, ...body });
    return c.json({ beneficiary: b }, 201);
  })
  .get('/beneficiaries', async (c) => {
    const q = await parseQuery(c, z.object({ subWalletId: z.string().uuid() }));
    if (q instanceof Response) return q;
    const a = c.get('actor') as Actor;
    return c.json({ beneficiaries: await beneficiariesService.list(db, a.userId, q.subWalletId) });
  })
  .delete('/beneficiaries/:id', async (c) => {
    const a = c.get('actor') as Actor;
    await beneficiariesService.remove(db, a.userId, c.req.param('id'));
    return c.json({ ok: true });
  });

function serializeVas(v: NonNullable<Awaited<ReturnType<typeof vasPurchasesRepo.findById>>>) {
  return {
    id: v.id,
    category: v.category,
    provider: v.provider,
    recipient: v.recipient,
    amountKobo: (v.amountKobo as bigint).toString(),
    status: v.status,
    token: v.token,
    createdAt: v.createdAt,
  };
}
```

> Reconcile every import against the real files (`db` handle, `anchorAdapter` export, `ActorVariables`/`Actor`, `parseQuery`, `masterWalletsRepo.findByHousehold`, `householdsRepo.findByPrincipal`) — the marketplace route uses these exact helpers; copy its import lines. Confirm `z.coerce.bigint()` parses the JSON number/string amount; if the client sends kobo as a string, keep it a string schema and `BigInt()` it.

- [ ] **Step 5: Mount in `server.ts`.** Add `import { vasRoute } from './routes/vas';` and `app.route('/vas', vasRoute);` beside the marketplace mount.

- [ ] **Step 6: Run — expect PASS.** Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vas.test.ts tests/routes/vas-beneficiaries.test.ts tests/routes/webhooks-bills.test.ts`
- [ ] **Step 7: Commit.** `git commit -am "feat(vas): HTTP routes (billers/products/validate/purchase/beneficiaries) + mount"`

---

## Task 13: Hardening, full suite, review, PR

**Files:** none new — verification + docs.

- [ ] **Step 1: Property test** — add a `fast-check` property in `purchase.service.test.ts`: for random `amountKobo` and random Anchor commission ≤ amount, after settle the **ledger is balanced** (`sum(debit)==sum(credit)` across the txn's postings) and `external + commission == amount`. (Mirror the SP1 ledger property tests.)

- [ ] **Step 2: Concurrency test** — two concurrent `create` calls for the same sub-wallet whose combined amount exceeds the daily limit: exactly one succeeds, the other throws `LimitExceededError`; only one reserve hits the ledger. (Mirror the nip-out/marketplace advisory-lock race test.)

- [ ] **Step 3: Full backend suite.** Run: `pnpm --filter @amana/backend test` — Expected: ALL green (no regressions in transactions/marketplace/webhooks).

- [ ] **Step 4: Coverage gate.** Run: `pnpm --filter @amana/backend test:coverage` — Expected: thresholds hold (lines/statements ≥92, functions ≥90, branches ≥80). Add tests for any uncovered VAS branch.

- [ ] **Step 5: Lint + typecheck.** Run: `pnpm exec biome check --write . && pnpm --filter @amana/backend typecheck` — Expected: clean.

- [ ] **Step 6: Security-reviewer pass.** Dispatch the `security-reviewer` subagent on the VAS diff. It MUST confirm: (a) authorization — `assertWalletAccess` in `create`, `assertSubWalletAccess({principalOnly})` on beneficiary add/remove, role claim never trusted; (b) cash-out control — `assertRecipientAllowed` cannot be bypassed and normalization can't be spoofed (e.g. `0801…` vs `+234801…` collapse to one value); (c) no double-spend — advisory lock + `idempotency_key` UNIQUE + webhook dedupe; (d) refund-on-fail correct and the SP1 inversion is intentional; (e) no float in money math; (f) commission carve balanced and capped ≤ amount. Resolve every finding or explicitly accept it.

- [ ] **Step 7: Runbook.** Add a `## Digital VAS (bill payment)` section to `docs/runbook/funds-model.md` (or a new `docs/runbook/vas.md`): the money legs (reserve/settle-carve/refund), the commission model (no ₦100 fee), the recipient-control rule, the `bills.*` webhook flow, and the deferred follow-ups. Update root `CLAUDE.md` module list + `apps/backend`'s if it enumerates modules (add `vas`).

- [ ] **Step 8: Update the memory pointer** — mark SP3 done in the marketplace-build memory (SP3 ships; remaining SP4/SP5b).

- [ ] **Step 9: PR.** Use `superpowers:finishing-a-development-branch`. Branch `feat/marketplace-sp3-digital-vas`, PR body summarizing scope, the money model, the security-review outcome, and deferred follow-ups. **The PR body MUST explicitly flag the two intentional interim gaps for reviewer sign-off:** (1) **category-lock does not gate VAS** in SP3 (rule-fusion is SP5b; recipient allowlist is the interim guard); (2) the **Anchor flat wire contract + kobo unit are inherited from `transfer`** and share the single open "live Anchor sandbox E2E" verification gate (not independently verified here). Do NOT merge without the user's go-ahead.

---

## Self-Review (against the SP3 spec §10.5 + §13 + intake decisions)

- **All four categories** → Tasks 3–4 (config maps each to an Anchor type; adapter handles airtime/data/electricity/cable; validation for electricity/cable). ✅
- **Anchor VAS provider, no aggregator** → Task 3 uses Anchor `/bills`. ✅
- **Reserve→fulfil→settle/refund money model** → Tasks 8–10 (carve settle mirrors redemption; refund mirrors reversal). ✅
- **Commission, no ₦100 fee** → Task 8 books `commission` LA, no fee txn; decision #4. ✅
- **Spend-limit enforced + VAS holds count in window** → Tasks 5, 9. ✅
- **Recipient cash-out control (allowlist + own number)** → Tasks 1, 6, 7, 9. ✅
- **Async webhook fulfilment reusing dedupe machinery** → Task 10. ✅
- **Idempotency (3 layers: adapter execIdempotent, txn UNIQUE key, webhook dedupe)** → Tasks 3, 9, 10. ✅
- **Authz by identity not role; service-layer** → Tasks 7, 9 (`assertWalletAccess`, `assertSubWalletAccess`). ✅
- **Prepaid electricity token persisted** → Tasks 1, 8 (token column, set on success). Display deferred to SP5b. ✅
- **Tests: property (balance), concurrency (limit race), real-DB integration** → Task 13. ✅
- **Deferred seams noted (bump, recon of stuck pendings, rule-fusion, token display, campaigns)** → Locked decisions. ✅

**Type consistency check:** `AnchorBillResponse.commissionKobo` (bigint) flows → `vasSettlementService.finalise({commissionKobo})` → carve; `computeCommissionKobo` is the fallback/quote only. `VasCategory`/`RecipientKind` unions consistent across `config.ts`, `purchase.service.ts`, `beneficiaries.service.ts`, routes. `vas_purchases.status` (`pending|successful|failed`) is distinct from the money txn status (`in_flight|settled|failed`) and both are updated together at each transition. No placeholder steps; every code step shows the code.

**Known adapt-points (flagged inline for the executor, not placeholders):** exact `assertSubWalletAccess` option name; `anchorAdapter`/`db` import paths; `parseQuery` presence. **Resolved:** the Anchor amount unit is **kobo** and the body is **flat** — VAS inherits the `transfer` convention verbatim (proven by `adapter.transfer.test.ts`), not a VAS-specific decision. The only residual external unknowns — cable-TV `type` string and the exact commission response field name — are isolated to `types.ts`/the `payBill` response and share the existing "live Anchor sandbox E2E" go-live gate. None change the money model or the design.
