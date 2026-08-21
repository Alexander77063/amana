# Retailer onboarding & Business KYB (SP4a — backend)

Curated marketplace supply: a retailer does not self-serve onto the platform. Ops creates the
application, submits Business KYB to Anchor, and Anchor's verdict (or an explicit ops decision)
decides whether the retailer goes live.

**Scope:** this document covers the **backend** only. The retailer-facing **portal UI** and its
retailer-scoped auth are **SP4b, deferred** — which is why the surface below is ops-authenticated
with a shared key rather than a per-retailer login.

---

## 1. The state machine

```
                       submitKyb                kyb.approved
   (none) ──apply──▶ applied ─────────▶ kyb_pending ─────────────▶ approved
                        │                    │  │
                        │                    │  └── kyb.rejected ──┐
                        └────── approve ─────┘                     ▼
                                 (ops override)                suspended  ◀── suspend
                                                                              (from any status)
```

| Transition | Trigger | Legal from | Result |
|---|---|---|---|
| `apply` | `POST /retailers` | — | `applied` |
| `submitKyb` | `POST /retailers/:id/kyb` | `applied`, `kyb_pending` | `kyb_pending` + `anchor_business_customer_id` |
| `handleKybApproved` | `kyb.approved` webhook | `kyb_pending` | `approved` |
| `handleKybRejected` | `kyb.rejected` webhook | `kyb_pending` | `suspended` |
| `approve` | `POST /retailers/:id/approve` | `applied`, `kyb_pending` | `approved` (ops override, no KYB) |
| `suspend` | `POST /retailers/:id/suspend` | any | `suspended` |

Two rules the code enforces that matter operationally:

- **`suspended` is a one-way door for `approve`.** Un-suspending is not an ops button; a suspended
  retailer must be re-applied and go back through KYB. This is deliberate — `suspended` is where a
  KYB rejection lands, so a resurrect button would be a KYB bypass.
- **Only `approved` retailers transact.** `purchaseService` refuses a purchase whose retailer is not
  `approved`, and `catalogService` refuses to list items for one. Suspending is therefore a live kill
  switch, not just a label.

### Why every guarded transition is a compare-and-set

`retailersRepo.transitionOnboardingStatus` moves a retailer only if it is *currently* in one of the
allowed predecessor statuses, in a single `UPDATE ... WHERE id = ? AND onboarding_status IN (...)`.
The read that precedes it exists only to produce a precise 404/409 — it is not the guard.

This closes a real race: a KYB **re-submit** in flight while a `kyb.approved` webhook lands would,
under read-then-write, pull an already-live retailer back to `kyb_pending`. Under the CAS the
re-submit's write matches no row and the caller gets a 409 instead. Same protection in reverse: a
late `kyb.rejected` cannot un-approve a live retailer.

---

## 2. Admin auth (`x-admin-api-key`)

All `/retailers` routes are gated by `middleware/admin-auth.ts`:

- Header `x-admin-api-key`, compared against `ADMIN_API_KEY` in **constant time**.
- **Unset key = deny.** A missing or misconfigured `ADMIN_API_KEY` 401s every request; it never opens
  the surface. `env.ts` also boot-enforces the var in `NODE_ENV=production` (min 32 chars).
- The key is read from `process.env` per request (same contract as `ANCHOR_WEBHOOK_SECRET`), so it
  can be rotated without a code change and tests can set it between calls.

**Containment rule:** a shared ops key is *not an identity*. These routes touch retailer onboarding
state only. They must never reach a wallet, ledger, or transaction path, where authorization is by
user identity vs. ownership (`assertWalletAccess`) and a shared key would be an authorization hole.
Adding a money-moving endpoint under `adminAuth` is a design error, not a shortcut.

---

## 3. Endpoints

| Method | Path | Purpose | Notable responses |
|---|---|---|---|
| `POST` | `/retailers` | Create an application | `201` with the row; `400` malformed |
| `GET` | `/retailers?status=` | Review queue (default `applied`) | `400` unknown status |
| `GET` | `/retailers/:id` | Fetch one | `400` non-uuid id, `404` unknown |
| `POST` | `/retailers/:id/kyb` | Submit Business KYB to Anchor | `409` wrong status, `503` Anchor down |
| `POST` | `/retailers/:id/approve` | Ops override to live | `409` from `suspended` |
| `POST` | `/retailers/:id/suspend` | Kill switch | `404` unknown |

`POST /:id/kyb` calls `anchorAdapter.createBusinessCustomer` keyed **`kyb:<retailerId>`**, so a retry
or a double-submit resolves to the same Anchor business customer instead of creating a second one.
An Anchor outage maps to `503 anchor_unavailable` and leaves the retailer in its prior status — the
submit is safely retryable, and the retailer is never stranded in `kyb_pending` with no Anchor id.

### Typical ops run

```bash
KEY=$ADMIN_API_KEY; API=https://amana-api.fly.dev

# 1. Create the application
curl -sX POST $API/retailers -H "x-admin-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"businessName":"Ada Salon","payoutBankCode":"000014","payoutAccountNumber":"0123456789"}'

# 2. Work the queue
curl -s "$API/retailers?status=applied" -H "x-admin-api-key: $KEY"

# 3. Submit KYB (BVN of a director; rcNumber = CAC registration, optional)
curl -sX POST $API/retailers/$ID/kyb -H "x-admin-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"bvn":"22222222222","rcNumber":"RC12345","email":"ada@salon.ng"}'

# 4. Wait for the kyb.approved webhook, or override
curl -sX POST $API/retailers/$ID/approve -H "x-admin-api-key: $KEY"
```

---

## 4. The `kyb.*` webhook flow

`kyb.approved` / `kyb.rejected` arrive on the same signed endpoint as every other Anchor event
(`POST /webhooks/anchor`, HMAC-verified with `ANCHOR_WEBHOOK_SECRET`, audit-logged before dispatch,
deduped on event id). Payload shape:

```json
{ "id": "evt_x", "type": "kyb.approved", "createdAt": "...", "data": { "businessCustomerId": "biz_1" } }
{ "id": "evt_y", "type": "kyb.rejected", "createdAt": "...", "data": { "businessCustomerId": "biz_1", "reason": "RC mismatch" } }
```

The retailer is resolved by `anchor_business_customer_id`, which carries a **UNIQUE** constraint —
two retailers sharing one Anchor business customer would make that lookup ambiguous. Postgres treats
NULLs as distinct, so retailers that have not submitted KYB are unaffected.

Like every Anchor webhook, these **always return 200**. Both handlers are idempotent: a re-delivered
event finds the retailer already out of `kyb_pending`, the CAS no-ops, and the endpoint still acks
rather than inviting an infinite Anchor retry loop. An unmatched `businessCustomerId` logs a warning
and acks — retrying would never resolve it.

A **late `kyb.rejected`** against an already-approved retailer is logged at `warn`
(`kyb.rejected: ignored, retailer no longer kyb_pending`) and changes nothing. That line means Anchor
and our state disagree and is worth investigating; use `POST /:id/suspend` if the rejection should in
fact take effect.

---

## 5. `redemptions` foreign keys (migration `0030`)

SP1 shipped `redemptions.{retailer_id, catalog_item_id, deal_id}` as `text` placeholders. SP4
converts them to real `uuid` columns with `ON DELETE RESTRICT` FKs to `retailers`, `catalog_items`,
and `deals`.

- `drizzle-kit` emits a bare `SET DATA TYPE uuid`, which **fails** — Postgres has no assignment cast
  from `text` to `uuid`. The migration is hand-edited to add `USING "<col>"::uuid`.
- The cast is total for existing data: every redemption row was written by `purchaseService` from
  real catalog uuids. A row holding a non-uuid aborts the migration loudly, which is correct — it
  would mean a redemption pointing at nothing, and silently dropping it would destroy financial
  history.
- `RESTRICT` is deliberate: a retailer or catalog item with redemptions against it is financial
  history and must not be deletable out from under them.

Tests that insert redemptions directly (bypassing `purchaseService`) must now reference real rows.
`tests/helpers/marketplace-seed.ts` provides `seedRetailerAndItem` and the idempotent
`ensureRetailerAndItem` — the latter re-seeds after the repeated `truncateAll()` calls inside
property-test loops.

---

## 6. Anchor sandbox notes

`createBusinessCustomer` posts the flat internal contract to `/business-customers` — not Anchor's
nested JSON:API shape — mirroring `createCustomer`. It is cached under its own idempotency scope
(`anchor.business_customer`) so a key reused across the personal and business surfaces can never
return the other's cached response.

There is no mock path: sandbox vs production is purely environmental (`ANCHOR_API_BASE_URL`). The
real wire shape of `/business-customers` is only exercised by the gated live E2E suite
(`pnpm --filter @amana/backend test:sandbox`), the same as every other adapter method.

---

## 7. Still deferred (SP4b)

- Retailer **portal** app + the Expo-web/PWA vs Next platform decision.
- Retailer-scoped auth (a retailer logging in to see its own catalog, deals, and redemptions).
- Retailer self-serve application — today ops creates the row.
