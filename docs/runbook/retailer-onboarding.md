# Retailer onboarding & Business KYB (SP4a — backend)

> **Auth changed (sub-plan A1 Task 4).** These flows used to send a shared `x-admin-api-key`. That
> secret is **deleted** — one static credential held by everyone, naming nobody, which the audit log
> could only record as "an operator". Sign in at `/admin/auth/start` with your `amana-ng.com`
> Workspace account instead and send the session cookie:
>
> ```bash
> # -b/-c persist the session cookie across calls
> curl -sS -c admin.jar -L https://admin.amana-ng.com/admin/auth/start   # complete Google sign-in
> curl -sS -b admin.jar https://admin.amana-ng.com/vendors-admin/claim-queue
> ```
>
> You need the `ops` role. A signed-in colleague without it gets 403, not 401 — being staff is not
> the same as being allowed near this surface. Every write below now records **which operator** made
> it.


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
- **Only `approved` retailers transact — on the *inbound* side.** `purchaseService`,
  `catalogService`, and `dealsService` all refuse a retailer that is not `approved`, so suspending
  immediately stops new catalog items, new deals, and new purchases.

### Known gap: suspension does not stop redemption of vouchers already sold

`redeemService` does **not** check `onboardingStatus` (it never has — SP1 shipped before the status
was meaningful). A retailer suspended *after* buyers have bought vouchers can still scan those
vouchers and receive the NIP-out payout. Purchases require `approved`, so this only affects vouchers
sold while the retailer was live — but that is exactly the fraud case: approve → sell → get caught →
collect anyway.

**Decided in SP4b: the behaviour stays, deliberately, and is now stated to the retailer.**

A buyer who has already paid must be able to obtain the service they bought. Refusing the
redemption strands *them* — their funds sit in suspense until the voucher expires — in order to
punish the retailer, which puts the cost on the wrong party. So suspension blocks **new supply**
(publishing items, running deals, being found by buyers) and never blocks honouring a voucher
already sold. The portal says exactly this on its suspended banner, so a retailer does not have
to discover it by trying.

The fraud case in the paragraph above is real and is not closed by this decision. What bounds it:
suspension stops further sales immediately, so the exposure is capped at vouchers already in
buyers' hands, and expiry (below) still returns anything unredeemed.

One thing SP4b **did** close: a retailer whose KYB was *rejected* can no longer redeem at all.
That case is indistinguishable by status — `kyb.rejected` lands in `suspended`, exactly like an
ops suspension — and `anchorBusinessCustomerId` cannot separate them either, because it is written
when KYB is **submitted**, before Anchor rules on it. `retailers.approved_at` (migration `0032`) is
stamped in the same statement as the transition to `approved`, and the portal's redeem route
requires it. Note the gate is on the **portal route**, not inside `redeemService` — the service's
behaviour is unchanged, so any other caller reaching it is unaffected.

Until the rest is decided:

- Treat `suspend` as *"stop new business"*, not *"stop all payouts."*
- To stop outstanding payouts on a suspended retailer today, the lever is expiry — vouchers refund
  their buyers automatically once past TTL (`VOUCHER_TTL_HOURS`, default 168h).
- Watch `GET /retailers?status=suspended` against redemption activity after any suspension.

### Why every guarded transition is a compare-and-set

`retailersRepo.transitionOnboardingStatus` moves a retailer only if it is *currently* in one of the
allowed predecessor statuses, in a single `UPDATE ... WHERE id = ? AND onboarding_status IN (...)`.
The read that precedes it exists only to produce a precise 404/409 — it is not the guard.

This closes a real race: a KYB **re-submit** in flight while a `kyb.approved` webhook lands would,
under read-then-write, pull an already-live retailer back to `kyb_pending`. Under the CAS the
re-submit's write matches no row and the caller gets a 409 instead. Same protection in reverse: a
late `kyb.rejected` cannot un-approve a live retailer.

---

## 2. Admin auth (Google Workspace session)

All `/retailers` routes are gated by `middleware/admin-session.ts` plus a permission check:

- A signed-in `amana-ng.com` Workspace account, carried as the `amana_admin_session` cookie.
- **`retailer.read`** to list and read, **`retailer.write`** to create, submit KYB, approve or
  suspend. A signed-in colleague without the role gets **403**, not 401 — being staff is not the
  same as being allowed near this surface.
- No credential = 401. A suspended admin's live cookie stops working at the next request, not at
  expiry.

**What changed, and why (sub-plan A1 Task 4).** This surface used to sit behind one shared
`ADMIN_API_KEY`. That key is **deleted, with no fallback** — a fallback is the original
vulnerability with extra steps. The old key bought four bad properties: rotating it locked out the
whole team at once, revocation was all-or-nothing, a key in a shell history was permanent access,
and — worst — the audit log could only record that *somebody* approved or suspended a business.
Every write here now records `actorAdminUserId`.

**Containment rule (unchanged):** staff authority is *not account ownership*. These routes touch
retailer onboarding state only. They must never reach a wallet, ledger, or transaction path, where
authorization is by user identity vs. ownership (`assertWalletAccess`).
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
curl -sX POST $API/retailers -b admin.jar -H 'content-type: application/json' \
  -d '{"businessName":"Ada Salon","payoutBankCode":"000014","payoutAccountNumber":"0123456789"}'

# 2. Work the queue
curl -s "$API/retailers?status=applied" -b admin.jar

# 3. Submit KYB (BVN of a director; rcNumber = CAC registration, optional)
curl -sX POST $API/retailers/$ID/kyb -b admin.jar -H 'content-type: application/json' \
  -d '{"bvn":"22222222222","rcNumber":"RC12345","email":"ada@salon.ng"}'

# 4. Wait for the kyb.approved webhook, or override
curl -sX POST $API/retailers/$ID/approve -b admin.jar
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

## 7. The retailer portal (SP4b)

**Platform: a separate Next.js app**, `apps/retailer-portal`, resolving the gate spec §7 left open.
The recommended candidate was Expo-web reusing `@amana/ui`, and there is evidence it would have
worked — the investor-demo work drove both Expo apps end to end in Chromium. It went the other way
because the portal is the surface expected to grow data-dense, is the only one with a plausible
public/SEO future, and is the only one with no app-store path to protect. The accepted cost is a
second component system: `@amana/api-client` is reused as-is, but `@amana/ui` ships React Native
source, so the design tokens and the naira formatter are duplicated once each, in
`app/globals.css` and `lib/api.ts`, flagged at both sites.

**Sign-in is phone OTP**, the same primitive as every other human login here, as a third JWT actor
kind (`retailer`). It is a peer of principal/agent rather than a flag on them: a retailer owner has
no household, wallet or sub-wallet, so every household route rejects one by default. `/auth/otp/*`
refuses a retailer and points at the portal, so the two front doors stay separate.

**There is no self-registration, and that is the point.** Ops create the business as before and
record `contact_phone`; the first successful OTP from that number creates the owner's user row and
claims the retailer. Claiming only ever matches rows with `owner_user_id IS NULL`, so a live
retailer cannot be taken over by someone re-registering its contact number.

A first sign-in also needs the owner's NIN. The server cannot know that until it has verified the
code — and verifying **consumes** it — so the portal offers the NIN field up front rather than
discovering the requirement and leaving the owner holding a spent OTP. Checking first would answer
"does this number have a retailer waiting?" for anyone who asks, with no code at all.

Both OTP endpoints are rate-limited alongside the household ones in `attachRateLimiters`.

Authorisation is by **ownership, in the service layer** (`retailer-access.service`), never the
`actor` claim — a forged role resolves to no owned retailer. Routes naming an id in the path check
ownership first and report "not yours" identically to "does not exist".

### Portal endpoints (`/retailer/*`, bearer auth)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/retailer/auth/otp/request` | Never reveals whether the phone belongs to a retailer |
| `POST` | `/retailer/auth/otp/verify` | `nin` required on first sign-in only |
| `GET` `PATCH` | `/retailer/me` | Profile; approval stays ops-only |
| `PUT` | `/retailer/me/payout` | Bank account; verified by Anchor at payout time |
| `POST` | `/retailer/me/kyb` | Submit only — a retailer can never approve itself |
| `GET` `POST` | `/retailer/items` | Publishing requires `approved` |
| `PATCH` | `/retailer/items/:id` | Taking an item off sale stays open to a suspended retailer |
| `GET` `POST` `PATCH` | `/retailer/deals` | `markdown` only; `ended` is terminal |
| `POST` | `/retailer/redeem` | Money. Requires `approved_at`; permitted while suspended |
| `GET` | `/retailer/redemptions` | Orders log, paginated |
| `GET` | `/retailer/earnings` | Settlement **history**, never a held balance (spec §7) |

Run it locally with `pnpm --filter @amana/retailer-portal dev` (port 3300) against a backend with
`CORS_ALLOWED_ORIGINS=http://localhost:3300`. `node tools/demo/probe-portal.mjs` drives the whole
thing in a browser and is the fastest way to check the two halves still agree.

## 8. Still deferred

- Retailer self-serve application — ops still create the row.
- **QR scanning and the USSD redeem fallback.** Redeem takes a keyed code today. USSD (spec §6) is
  a telco integration, not UI.
- **Multi-staff logins.** v1 is a single owner per retailer, enforced by a unique index on
  `owner_user_id`.
- **Funded-campaign deals.** `deal_type` has only `markdown`.
- **An admin route for `contact_phone`.** Ops can create a retailer but not yet set the number its
  owner will claim it with, so that field is currently written directly.
- **An un-suspend path.** `approve` deliberately refuses `suspended`, and there is no re-apply
  endpoint that clears the old row — a suspended retailer's catalog items still exist and still
  point at it. If ops needs to reinstate a retailer, that flow does not exist yet.
- **Rate limiting on the admin surface.** `/retailers` is not behind `attachRateLimiters`. A ≥32-char
  key makes brute force infeasible, but there is no lockout or per-IP throttle on a static
  credential.
