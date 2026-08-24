# Marketplace SP4b — Retailer Portal & Retailer-Facing Auth Implementation Plan

> **Scope note.** SP4a shipped the retailer onboarding backend driven by an **ops admin key**
> (`x-admin-api-key`). Retailers themselves still have no way to sign in, and
> `catalogService` / `dealsService` / `redeemService` — written in SP1/SP2 — have **no HTTP routes
> at all**. So "build the portal UI" is three layers, and the UI is the last of them.

## Decisions taken at the Phase-2 gate

Spec §7 deferred two things to this gate. Both are now settled.

**1. Platform: a separate Next.js app (`apps/retailer-portal`).**
The spec's recommended candidate was Expo-web/PWA reusing `@amana/ui`, and there is now hard
evidence it would have worked — the investor-demo work drove both Expo apps end to end in
Chromium (auth, money movement, rules, VAS) through platform twins, with native code untouched.
The call went the other way deliberately: the portal is the one surface expected to grow
data-dense (orders, redemptions, earnings history), it is the only surface with a plausible
public/SEO future (storefronts), and it is the only one with no app-store path to protect. The
cost is accepted and stated plainly: **a second component system**, a second design language to
keep in visual sync with `@amana/ui`, and a second deploy target.

**2. Retailer auth: phone OTP, as a third JWT actor kind.**
Consistent with how every other human signs into Amana, and Termii is already wired. No new
credential type, no password reset surface, no new abuse channel beyond one more OTP route.

## Two product decisions this forces into the open

**Suspension and already-sold vouchers.** `docs/runbook/retailer-onboarding.md` records that
suspension does not stop redemption of vouchers already sold. That was theoretical while no
retailer could log in; it is real the moment they can. **Decision: keep it, deliberately.** A
buyer who has already paid must be able to obtain the service they bought — stranding them to
punish the retailer inverts who bears the cost. Suspension therefore blocks *new* supply
(publishing items, running deals, appearing to buyers) but never blocks the redemption of a
voucher already sold, and those redemptions still settle to payout. The portal states this on the
suspended banner so it is not a surprise.

**Pre-SP4 retailers are `approved` by default.** `retailers.onboardingStatus` defaults to
`'approved'` because SP2 created retailers live-approved. Any portal gate keyed on `approved`
would therefore wave those rows through without KYB. The gate keys on **`anchorBusinessCustomerId
IS NOT NULL`** for anything that moves money to a payout account, so a legacy row must still pass
KYB before it can be paid — status alone is not sufficient authority.

## Prerequisites

- `docker compose up -d`, migrations applied to the dev **and** test DBs (tests do not migrate).
- Branch from `origin/main` (verified 0/0 at `2b01ebf`).

## File Structure

```
apps/backend/src/
  db/schema/marketplace.ts            # + ownerUserId, contactPhone on retailers
  db/migrations/                      # 00xx retailer owner + contact phone
  middleware/jwt-auth.ts              # third actor kind: 'retailer'
  modules/marketplace/
    retailer-auth.service.ts          # NEW  OTP login → retailer-scoped session
    retailer-access.service.ts        # NEW  ownership assertions (service layer)
    earnings.service.ts               # NEW  settlement history from the ledger
  routes/
    retailer-auth.ts                  # NEW  /retailer/auth/otp/{request,verify}
    retailer-portal.ts                # NEW  /retailer/* — profile, KYB, catalog, deals,
                                      #      redeem, redemptions, earnings
packages/
  types/src/marketplace.ts            # wire types for the portal
  api-client/src/retailer-api.ts      # NEW  typed SDK the portal consumes
apps/retailer-portal/                 # NEW  Next.js app
```

## Tasks

### Task 1 — Retailer identity (migration + repo)

`retailers` has no owner and no contact phone, so nothing can scope a session to a retailer.
Add `owner_user_id uuid REFERENCES users(id)` (nullable: SP2/SP4a rows predate it, and ops can
still create a retailer before its owner exists) and `contact_phone text`. Unique index on
`owner_user_id` where not null — one owner login per retailer in v1 (multi-staff roles are
deferred by the spec). Repo gains `findByOwnerUserId` and `attachOwner`.

Hand-check the generated SQL: drizzle emits a bare `SET DATA TYPE` that fails on a populated
column — the same trap hand-edited in `0030`.

### Task 2 — Retailer auth

A third actor kind, `retailer`, in the JWT. `retailer-auth.service.ts` reuses the existing
`otp.service` (and therefore `DEV_OTP_BYPASS_CODE` in dev). Verify resolves the retailer **by
owner phone**, mints access/refresh with `actor: 'retailer'` and the `retailerId` claim.

`middleware/jwt-auth.ts` must keep treating the role claim as *authentication only*. Every
retailer-scoped read and write authorises through `retailer-access.service.assertRetailerAccess`
in the **service layer**, comparing the session's user against the retailer's owner — never the
`actor` claim, so a forged role still fails. `/auth/refresh` derives the actor from the user
record, as it already does.

Wire the two new OTP routes into `attachRateLimiters` in `server.ts` — this is abuse-prone auth
surface and would otherwise be the only unrated OTP path.

### Task 3 — Retailer-scoped profile, KYB and payout

Self-service equivalents of the SP4a admin routes, authorised by ownership:
`GET /retailer/me`, `PATCH /retailer/me` (business name, contact phone), `PUT /retailer/me/payout`
(bank code + account number), `POST /retailer/me/kyb` (submit → `kyb_pending`).

Reuse `retailerOnboardingService` and its atomic CAS `transitionOnboardingStatus` — the portal
must not grow a second, looser copy of the state machine. Approval stays ops-only: a retailer
may submit KYB, never approve itself.

### Task 4 — Catalog and deals CRUD

Expose the existing services, retailer-scoped. Items: create/update/list/deactivate
(name, price kobo, section, description, photo, optional duration). Deals: create/list/pause/end
(markdown type only — `dealTypeEnum` has just `markdown`; funded campaigns are v2).

Publishing gates on onboarding status: a `suspended` or `applied` retailer cannot add supply.

### Task 5 — Redeem, redemptions log, earnings

The money slice.

- `POST /retailer/redeem` — code or QR payload → `redeemService`, then settlement. This makes
  `redemptionSettlementService` caller-driven for the first time (today only `webhooks.ts`
  reaches it), so it needs the repo's three idempotency layers and the same row-lock discipline
  as the VAS settle path. Redemption is permitted for a suspended retailer, per the decision above.
- `GET /retailer/redemptions` — the orders log, paginated, newest first.
- `GET /retailer/earnings` — settlement **history from the ledger**, never a held balance
  (spec §7). `bigint` kobo throughout; format with `formatNaira`, never a local formatter.

### Task 6 — Types + api-client

Wire types in `@amana/types`; `RetailerApi` in `@amana/api-client` reusing `AmanaApiClient`'s
bearer auth and single-flight refresh. The portal consumes only this — no bespoke `fetch`.

### Task 7 — The Next.js portal

`apps/retailer-portal`, App Router, TypeScript, added to the pnpm workspace and Turbo pipeline.
Biome formats it like everything else (`biome check .` runs repo-wide in CI and will fail on
drift). Six areas: sign-in, profile + KYB, storefront, deals, redeem, orders, earnings.

Visual language mirrors `@amana/ui` tokens rather than importing it — this is the accepted cost
of the platform decision, so the tokens are copied once into a small theme module and the debt is
written down rather than left implicit.

### Task 8 — Tests, gates, docs

Backend coverage gate is **lines/statements 92, functions 90, branches 80**, backend-only, and a
large addition without tests fails CI. Route tests via `app.request()`, real Postgres, ownership
and cross-tenant denial covered explicitly (retailer A must not read retailer B). Security review
of the auth and money paths inline. `biome check .` repo-wide and all typechecks before the PR.
Docs: extend `docs/runbook/retailer-onboarding.md` with the portal, the auth flow, and both
product decisions above.

## Self-Review

- Authorization is by ownership in the service layer, never the JWT role claim (decisions #7/#17).
- Redeem is money movement: idempotent, row-locked, reversing entries only.
- No floats: `bigint` kobo end to end.
- USSD redeem fallback (spec §6) is a telco integration, not UI — explicitly out of scope.
- Buyer marketplace screens and partner-funded budgets remain out of scope (SP5b).
