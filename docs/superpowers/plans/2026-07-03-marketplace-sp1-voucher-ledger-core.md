# Marketplace SP1 — Voucher/Redemption Ledger Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend voucher/redemption money core: a buyer reserves discounted funds from their wallet at purchase, the retailer redeems in-person to release a NIP payout, and unredeemed vouchers auto-refund on expiry — all on Amana's existing double-entry `suspense` ledger pattern.

**Architecture:** New `modules/marketplace` (services + repo) + `routes/marketplace.ts`. Reuses `ledgerService.writeDoubleEntry`, the `suspense`/`fee`/`external` ledger accounts, `nipOutService` for payout, and the cron pattern for expiry. No UI, no new infra.

**Tech Stack:** Hono, Drizzle, postgres-js, Zod, Vitest + fast-check, node-cron.

**Money legs (verified against `nip-out.service.ts` / `settlement.service.ts` / `reversal.service.ts`):**
- **Reserve** (purchase): `debit source (sub|master LA) = discounted`, `credit suspense = discounted`.
- **Release** (redeem): `debit suspense = discounted`, `credit external = retailerNet`, `credit fee = commission` (`discounted = retailerNet + commission`); fire NIP-out of `retailerNet`.
- **Refund** (expiry/cancel): `debit suspense = discounted`, `credit source = discounted`.

**Config constants (`modules/marketplace/config.ts`):** `MARKETPLACE_COMMISSION_BPS = 500` (5%, TBD pricing pass), `VOUCHER_TTL_HOURS = 168` (7d), `MARKETPLACE_SPEND_FEE_KOBO = 0n` (TBD). All overridable via env in `env.ts`.

---

### Task 1: Schema — `redemptions` table + enum values

**Files:**
- Create: `apps/backend/src/db/schema/marketplace.ts`
- Modify: `apps/backend/src/db/schema/index.ts` (barrel export), `apps/backend/src/db/schema/transactions.ts` (add `txn_kind` values `marketplace_purchase`, `redemption`)
- Migration: generated via `drizzle-kit generate` (do NOT hand-write; **commit the generated SQL + meta immediately** — see the PR #25 lesson)

- [ ] **Step 1:** Define `redemptionStatusEnum = ['reserved','redeemed','expired','refunded']` and the `redemptions` table: `id`, `transactionId` (FK transactions, the reserve txn), `buyerUserId` (FK users), `masterWalletId`, `subWalletId` (nullable — principal direct), `retailerId` (text for SP1; FK to retailers in SP4), `catalogItemId` (text placeholder for SP1), `dealId` (nullable text), `grossKobo`, `discountedKobo`, `commissionKobo` (all `bigint`), `code` (text, unique), `qrToken` (text, unique), `status` (enum, default `reserved`), `expiresAt` (timestamptz), `redeemedAt` (nullable), `createdAt`.
- [ ] **Step 2:** Add `marketplace_purchase` and `redemption` to `txnKindEnum` in `transactions.ts`.
- [ ] **Step 3:** Run `pnpm --filter @amana/backend exec drizzle-kit generate`; apply with `db:migrate`; **git add the new migration `.sql` + `meta/*_snapshot.json` + `meta/_journal.json`**.
- [ ] **Step 4:** `pnpm --filter @amana/backend typecheck` — expect clean.
- [ ] **Step 5:** Commit `feat(marketplace): redemptions schema + txn kinds`.

### Task 2: `redemptions.repo.ts`

**Files:** Create `apps/backend/src/modules/marketplace/redemptions.repo.ts`; Test `apps/backend/tests/modules/marketplace/redemptions.repo.test.ts`

- [ ] **Step 1 (failing test):** insert a redemption, `findByCodeForUpdate(code)` returns it; assert `SELECT ... FOR UPDATE` locking by asserting a second concurrent tx blocks (use two `db.transaction`s).
- [ ] **Step 2:** run test → fails (no repo).
- [ ] **Step 3:** implement `insert`, `findById`, `findByCodeForUpdate` (uses `.for('update')`), `findByBuyer`, `markRedeemed(id, at)`, `markStatus(id, status)`, `findExpiredReserved(now)`. First arg `db: DbOrTx`.
- [ ] **Step 4:** run test → passes.
- [ ] **Step 5:** commit.

### Task 3: `config.ts` + code/token minting

**Files:** Create `apps/backend/src/modules/marketplace/config.ts`, `apps/backend/src/modules/marketplace/codes.ts`; Test `.../codes.test.ts`

- [ ] **Step 1 (failing test):** `mintCode()` returns `AMN-XXXX` (Crockford base32, no ambiguous chars), `mintQrToken()` returns a signed opaque token; both unique across 10k draws.
- [ ] **Step 2:** fails.
- [ ] **Step 3:** implement using `crypto.randomBytes`; QR token = HMAC(redemptionId) with `FIELD_ENCRYPTION_KEY`-derived secret so it can't be forged.
- [ ] **Step 4:** passes.
- [ ] **Step 5:** commit.

### Task 4: `purchase.service.ts` — reserve (legs A)

**Files:** Create `apps/backend/src/modules/marketplace/purchase.service.ts`; Test `.../purchase.service.test.ts`

- [ ] **Step 1 (failing tests):** (a) reserve debits source, credits suspense, sub-wallet spendable balance drops by `discounted`; (b) creates `redemptions` row `status=reserved` with code/qr/expiry; (c) same `idempotencyKey` twice → one reservation; (d) authz: a non-owner `actorUserId` → `ForbiddenError`; (e) insufficient balance → typed error, no postings; (f) rules/limit check invoked for agent source (category-lock + limit; over-limit surfaces the bump path, not a hard fail).
- [ ] **Step 2:** fail.
- [ ] **Step 3:** implement `purchaseService.create(db, { actorUserId, subWalletId|null, retailerId, catalogItemId, grossKobo, discountedKobo, idempotencyKey })`: authz via `assertWalletAccess`; compute `commissionKobo = discounted * BPS / 10000`; open tx → create `marketplace_purchase` txn (idempotency UNIQUE) → `writeDoubleEntry` legs A → insert redemption (mint code/qr, `expiresAt = now + TTL`). Reuse the rules-engine entry the existing spend path uses for agent sources.
- [ ] **Step 4:** pass.
- [ ] **Step 5:** commit.

### Task 5: `redeem.service.ts` — release + payout (legs B)

**Files:** Create `apps/backend/src/modules/marketplace/redeem.service.ts`; Test `.../redeem.service.test.ts`

- [ ] **Step 1 (failing tests):** (a) redeem debits suspense, credits external `retailerNet` + fee `commission`, balanced; (b) fires `nipOutService.send` with `retailerNet` to the retailer account; (c) voucher → `redeemed`, `redeemedAt` set; (d) double-redeem blocked (second call → typed `AlreadyRedeemed`, no extra postings) — assert under two concurrent txns via `findByCodeForUpdate`; (e) redeem of expired voucher → rejected; (f) authz: retailer must own the voucher; (g) idempotency key `redeem:<id>`.
- [ ] **Step 2:** fail.
- [ ] **Step 3:** implement `redeemService.redeem(db, { retailerId, code|qrToken, idempotencyKey })`: tx → `findByCodeForUpdate` (row lock) → assert `status=reserved` & not expired & retailer owns → create `redemption` txn → `writeDoubleEntry` legs B → `nipOutService.send(retailerNet)` → `markRedeemed`. NIP + EMTL handled by the existing payout path.
- [ ] **Step 4:** pass.
- [ ] **Step 5:** commit.

### Task 6: `expiry.service.ts` + cron sweep (legs C)

**Files:** Create `apps/backend/src/modules/marketplace/expiry.service.ts`, `apps/backend/src/cron/jobs/voucher-expiry-sweep.job.ts`; Modify `apps/backend/bin/cron.ts`; Tests `.../expiry.service.test.ts`

- [ ] **Step 1 (failing tests):** (a) `sweepExpired` refunds each expired `reserved` voucher: debit suspense, credit source; balance restored; status→`expired`; (b) already-redeemed vouchers untouched; (c) idempotent re-run does nothing; (d) explicit `cancel(id, actor)` before expiry refunds + status→`refunded` with authz.
- [ ] **Step 2:** fail.
- [ ] **Step 3:** implement `expiryService.sweepExpired(db, now)` + `cancel`; register `voucher-expiry-sweep.job` (every minute, mirrors `bump-ttl-sweep`) in `cron.ts`.
- [ ] **Step 4:** pass.
- [ ] **Step 5:** commit.

### Task 7: routes + validation

**Files:** Create `apps/backend/src/routes/marketplace.ts`; Modify `apps/backend/src/server.ts` (mount); Zod schemas in `packages/validation` or local; Test `apps/backend/tests/routes/marketplace.test.ts`

- [ ] **Step 1 (failing tests):** `POST /marketplace/purchase` (buyer JWT) → 201 + voucher; `POST /marketplace/redeem` (retailer principal for SP1) → 200; `GET /marketplace/vouchers` → buyer's list; malformed body → 400 via `parseBody`; UUIDs validated; authz enforced (403 on cross-owner).
- [ ] **Step 2:** fail.
- [ ] **Step 3:** implement thin handlers calling the services with `actorUserId` from JWT; validate via `lib/validate.ts`.
- [ ] **Step 4:** pass.
- [ ] **Step 5:** commit.

### Task 8: property tests — ledger invariants

**Files:** Create `apps/backend/tests/modules/marketplace/ledger.property.test.ts`

- [ ] **Step 1:** `fast-check`: for random `gross/discounted/commission` (0 < discounted ≤ gross, commission ≤ discounted): after reserve→redeem, sum of all postings per txn balances; master-wallet conservation holds; after reserve→expiry, source balance returns to pre-purchase exactly.
- [ ] **Step 2:** run → passes (or reveals a bug → fix root cause).
- [ ] **Step 3:** commit.

### Task 9: coverage + finalize

- [ ] **Step 1:** `pnpm --filter @amana/backend test` — all green.
- [ ] **Step 2:** `pnpm --filter @amana/backend test:coverage` — thresholds hold (add tests if the new module drags it).
- [ ] **Step 3:** `pnpm exec biome check --write .` + `typecheck`.
- [ ] **Step 4:** security-reviewer subagent pass on the new module (authz, double-spend, balance integrity, idempotency, input validation).
- [ ] **Step 5:** open PR `feat(marketplace): voucher/redemption ledger core (SP1)`.

## Self-review notes
- Legs balance in all three flows (verified). Reserve holds funds in `suspense` inside the master wallet → no external float → no escrow claim broken.
- `retailerId`/`catalogItemId` are text placeholders in SP1; SP4 swaps them to FKs (migration).
- The ₦100-vs-commission fee decision is deferred; `MARKETPLACE_SPEND_FEE_KOBO=0` keeps TDD unblocked.
- Concurrency: `findByCodeForUpdate` row-lock prevents double-redeem; property test + concurrent-tx test cover it.
