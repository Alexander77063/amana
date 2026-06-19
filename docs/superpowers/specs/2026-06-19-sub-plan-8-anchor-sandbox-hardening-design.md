# Sub-plan 8 — Anchor Sandbox Hardening Design

**Status:** Approved by user 2026-06-19.
**Scope:** Replace the placeholder Anchor virtual-account provisioning in `POST /households` with real Anchor API calls, wire the `kyc.approved`/`kyc.rejected` webhook handlers, and add both mocked integration tests and a real sandbox end-to-end test suite.

---

## 1. Architecture

Three concerns addressed in parallel:

**A. Real household provisioning.** `POST /households` currently calls `placeholderAnchorAccountForHousehold()`. This plan replaces it with two real Anchor calls — `createCustomer` (new adapter method) then `provisionVirtualAccount` (existing adapter method). The Anchor customer ID is stored on the `users` row; the real virtual account details are stored on `master_wallets` as before.

**B. KYC webhook handling.** `kyc.approved` and `kyc.rejected` events arrive at `/webhooks/anchor` but are currently ack-only. This plan wires them to update `users.kyc_tier` and log rejections respectively.

**C. Two-tier test strategy.** Normal vitest tests inject a mock `fetchImpl` into `AnchorClient` and run offline. A separate sandbox suite (`tests/sandbox/`) gates itself on `ANCHOR_API_KEY` and exercises the real Anchor sandbox end-to-end, driven by `pnpm test:sandbox`.

---

## 2. Schema

**Migration `0020_users_anchor_customer_id.sql`:**
```sql
ALTER TABLE users ADD COLUMN anchor_customer_id text;
```

Nullable — agents never get Anchor customers; a principal has no ID until household creation.

No index needed at this scale (looked up once per household creation, once per kyc webhook).

---

## 3. New Anchor types

Add to `apps/backend/src/integrations/anchor/types.ts`:

```ts
export interface AnchorCreateCustomerRequest {
  fullName: string;
  phoneNumber: string;
  nin: string;
  bvn: string;
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

Also add `'kyc.approved' | 'kyc.rejected'` to the existing `AnchorWebhookEventType` union (they're already there — verify, don't re-add).

---

## 4. Anchor adapter — `createCustomer`

Add to `AnchorAdapter` in `apps/backend/src/integrations/anchor/adapter.ts`:

```ts
async createCustomer(
  input: AnchorCreateCustomerRequest,
  idempotencyKey: string,
): Promise<AnchorCreateCustomerResponse> {
  return this.execIdempotent('anchor.customer', idempotencyKey, () =>
    this.client.post<AnchorCreateCustomerResponse>('/customers', input, { idempotencyKey }),
  );
}
```

Same pattern as `provisionVirtualAccount` and `requestKycUpgrade`. The `execIdempotent` wrapper caches the response in `idempotency_keys`, making retries safe.

---

## 5. Users repo — new write methods

Add to `apps/backend/src/modules/identity/users.repo.ts`:

```ts
async setAnchorCustomerId(db: DbOrTx, userId: string, anchorCustomerId: string): Promise<void>
async setKycTier(db: DbOrTx, userId: string, tier: '1' | '2' | '3'): Promise<void>
```

Both are simple `UPDATE users SET ... WHERE id = $1`. `setKycTier` may already exist — check before adding.

Also update `findByPhone` and `findById` return types to include `anchorCustomerId: string | null`.

Add a new query used by the webhook handler:

```ts
async findByAnchorCustomerId(db: DbOrTx, anchorCustomerId: string): Promise<User | null>
```

---

## 6. `POST /households` revised flow

Replace the `placeholderAnchorAccountForHousehold` call with this sequence. All Anchor calls happen inside the DB transaction (same as `nipOutService.send`):

```
0. Fetch user row BEFORE transaction: usersRepo.findById(db, a.userId)
   → gives us user.anchorCustomerId, user.nin, user.bvn, user.phone

1. Insert household row → get hh.id

2. Determine anchorCustomerId:
   a. If user.anchorCustomerId already set → use it (re-entrancy guard)
   b. If null → call anchorAdapter.createCustomer(
        {
          phoneNumber: user.phone,
          nin: user.nin,
          bvn: user.bvn,
          // fullName: Anchor derives from BVN/NIN — confirm with Anchor docs;
          //   if required, use user.phone as provisional value
        },
        idempotencyKey: `anchor.customer.${a.userId}`
      ) → get anchorCustomerId
      then usersRepo.setAnchorCustomerId(txDb, a.userId, anchorCustomerId)

3. anchorAdapter.provisionVirtualAccount(
     { customerId: anchorCustomerId, label: hh.name },
     idempotencyKey: `anchor.va.${hh.id}`
   ) → get { accountNumber, bankCode, id }

4. masterWalletsRepo.provision(txDb, {
     householdId: hh.id,
     anchorVirtualAccount: accountNumber,
     anchorBankCode: bankCode,
     anchorAccountId: id,
   })

5. Return 201 with household + masterWallet
```

**`fullName` contract:** Verify against Anchor sandbox docs whether `fullName` is required or optional (BVN/NIN verification may populate it server-side). If required, use `user.phone` as a provisional value; if Anchor rejects it, a `displayName` field can be added to the signup flow in a follow-up.

**Error handling:** `AnchorHttpError` from steps 2b or 3 propagates out of the DB transaction, rolling it back. No household row is committed. Return `503` to the client. The idempotency cache on both Anchor calls means retrying (same `userId`/`hh.id`) replays safely.

**Cleanup:** Delete `apps/backend/src/lib/placeholder-anchor.ts` and `apps/backend/tests/lib/placeholder-anchor.test.ts`. The only import site is `routes/households.ts`.

---

## 7. Webhook KYC handlers

In `apps/backend/src/routes/webhooks.ts`, replace the ack-only `kyc.*` branch:

```ts
} else if (event.type === 'kyc.approved') {
  const data = event.data as AnchorKycApprovedData;
  const anchorTier = data.newKycLevel;           // 'TIER_2' | 'TIER_3'
  const ourTier = anchorTier === 'TIER_3' ? '3' : '2';  // map
  const user = await usersRepo.findByAnchorCustomerId(db, data.customerId);
  if (user) {
    await usersRepo.setKycTier(db, user.id, ourTier);
  } else {
    logger.warn({ customerId: data.customerId }, 'kyc.approved: no matching user');
  }
} else if (event.type === 'kyc.rejected') {
  const data = event.data as AnchorKycRejectedData;
  logger.warn({ customerId: data.customerId, reason: data.reason }, 'kyc.rejected');
  // No state change — principal stays at current tier; retry/escalation is a future plan.
}
```

Always ack (return `200`) even on lookup failures — never let a webhook error cause Anchor to retry indefinitely.

---

## 8. Test strategy

### 8a — Mocked integration tests (run in `pnpm test`)

**`tests/routes/households.test.ts`** — extend with a `mockFetch` helper and use `vi.mock('../../../src/integrations/anchor', ...)` to replace `anchorAdapterSingleton` with a test double. The mock returns canned `AnchorCreateCustomerResponse` and `AnchorVirtualAccount` objects per test. New cases:

| Case | Setup | Expected |
|------|-------|----------|
| Happy path | mock returns customer + VA | 201, real `anchorVirtualAccount` in response |
| `createCustomer` Anchor 500 | mock throws `AnchorHttpError(500)` | 503, no household row |
| `provisionVirtualAccount` Anchor 500 | step 2 succeeds, step 4 throws | 503, no household row, `anchorCustomerId` not persisted |
| Re-entrant (anchorCustomerId already set) | seed user with existing `anchorCustomerId` | 201, createCustomer not called |
| Duplicate household | existing household for principal | 409, no Anchor calls |

**`tests/routes/webhooks.test.ts`** — add:

| Case | Setup | Expected |
|------|-------|----------|
| `kyc.approved` TIER_2 | seed user with `anchorCustomerId`, fire event | `users.kyc_tier = '2'` |
| `kyc.approved` TIER_3 | same | `users.kyc_tier = '3'` |
| `kyc.rejected` | seed user | 200 ack, tier unchanged |
| `kyc.approved` unknown customerId | no matching user | 200 ack, warn logged |

### 8b — Sandbox end-to-end tests (`pnpm test:sandbox`)

**Location:** `apps/backend/tests/sandbox/`

**New script** in `apps/backend/package.json`:
```json
"test:sandbox": "vitest run tests/sandbox/"
```

**Gate:** Each describe block opens with:
```ts
if (!process.env.ANCHOR_API_KEY) {
  test.skip('ANCHOR_API_KEY not set — skipping sandbox tests');
}
```

**Helper:** `tests/sandbox/helpers/anchor-sim.ts` — posts synthetic webhook payloads to `http://localhost:3000/webhooks/anchor` with a valid HMAC signature (using `ANCHOR_WEBHOOK_SECRET`). Lets sandbox tests exercise the full webhook handler rather than calling services directly.

**`tests/sandbox/anchor-e2e.test.ts`** — full payment loop:

1. Register a principal (OTP bypass in sandbox)
2. `POST /households` → Anchor creates customer + provisions real VA
3. Confirm `users.anchor_customer_id` set, `master_wallets.anchor_virtual_account` is a real NUBAN
4. Simulate `virtual_account.credited` webhook via `anchor-sim` → verify ledger topup posting
5. `POST /transactions/intent` + `POST /transactions/:id/send` (NIP-out to Anchor's sandbox destination account)
6. Simulate `transfer.completed` webhook → verify `transactions.status = 'settled'`, posting pair balanced
7. Simulate `kyc.approved TIER_2` webhook → verify `users.kyc_tier = '2'`

Sandbox tests run against a **local dev server** (`pnpm dev` in background) pointing at the real Anchor sandbox (`ANCHOR_API_BASE_URL=https://api.sandbox.getanchor.co`). They use the same real Postgres DB as normal tests (Docker Compose).

---

## 9. Files produced

**Created:**
- `apps/backend/src/db/migrations/0020_users_anchor_customer_id.sql`
- `apps/backend/src/db/migrations/meta/0020_snapshot.json` *(drizzle-kit generated)*
- `apps/backend/tests/sandbox/anchor-e2e.test.ts`
- `apps/backend/tests/sandbox/helpers/anchor-sim.ts`

**Modified:**
- `apps/backend/src/db/schema/identity.ts` — add `anchorCustomerId` column to `users`
- `apps/backend/src/integrations/anchor/types.ts` — add `AnchorCreateCustomerRequest/Response`, `AnchorKycApprovedData`, `AnchorKycRejectedData`
- `apps/backend/src/integrations/anchor/adapter.ts` — add `createCustomer()`
- `apps/backend/src/modules/identity/users.repo.ts` — add `setAnchorCustomerId`, `setKycTier`, `findByAnchorCustomerId`; extend return types
- `apps/backend/src/routes/households.ts` — replace placeholder with real Anchor calls
- `apps/backend/src/routes/webhooks.ts` — wire `kyc.approved`/`kyc.rejected` handlers
- `apps/backend/tests/routes/households.test.ts` — add Anchor-aware test cases
- `apps/backend/tests/routes/webhooks.test.ts` — add KYC webhook test cases
- `apps/backend/package.json` — add `test:sandbox` script

**Deleted:**
- `apps/backend/src/lib/placeholder-anchor.ts`
- `apps/backend/tests/lib/placeholder-anchor.test.ts`

---

## 10. Out of scope

- Tier 3 KYC upgrade (document upload flow) — separate plan
- Real Termii SMS go-live — separate checklist item (see memory)
- Anchor customer creation for agents — agents never provision wallets; no `anchorCustomerId` needed
- Anchor customer management endpoints (update, suspend) — future plan
