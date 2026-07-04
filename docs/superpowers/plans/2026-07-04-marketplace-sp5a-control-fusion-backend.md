# Marketplace SP5a — Control-Fusion Backend — Implementation Plan

> REQUIRED: superpowers:test-driven-development. Money code — needs a security-reviewer pass.

**Goal:** Make the marketplace purchase path production-safe and usable: enforce sub-wallet spend limits on a purchase (closing security-review HIGH-2), count marketplace holds in the limit window, price purchases from the real catalog (SP2 `effectivePriceKobo`), swap the redemption placeholder ids to real FKs, and **safely re-mount** the `/marketplace` HTTP routes. Backend only (mobile UI = SP5b; retailer-auth redeem route = SP4).

**Why:** SP1 deferred limit/rule enforcement to SP5 and unmounted the routes because reserving funds with no limit is unsafe to expose. This wires it in.

---

### Task 1: Count marketplace holds in the spend-limit window
**Files:** `apps/backend/src/modules/wallet/postings.repo.ts` (`sumDebitsInWindow`), test.
- The limit gate (`spend-limit.ts` → `wouldExceedSpendLimit` → `postingsRepo.sumDebitsInWindow`) currently counts only `t.kind='spend'` with `sent_at`. A marketplace reserve is `kind='marketplace_purchase'`, no `sent_at`. Extend the window sum to ALSO count active `marketplace_purchase` debits, windowed by `coalesce(sent_at, created_at)`, and only for txns whose status is not the refunded/reversed terminal (a hold that expired and refunded should stop counting — join to check the redemption/txn isn't reversed, OR simplest-safe: count marketplace_purchase debits whose txn has no matching reversal). Keep the existing spend semantics unchanged (regression: existing spend-limit tests stay green).
- [ ] TDD: a sub-wallet with a daily limit; a marketplace hold counts toward it; an expired-refunded hold does not.

### Task 2: Enforce the limit in `purchaseService.create`
**Files:** `apps/backend/src/modules/marketplace/purchase.service.ts`, test.
- At the SP5 seam (line ~102), for an agent source (`subWalletId` set), inside the tx take `pg_advisory_xact_lock(hashtext(subWalletId))` (mirror `nip-out.service.ts:86`) and call `wouldExceedSpendLimit(tx, subWalletId, discountedKobo, now)`. Over-limit → throw a typed `LimitExceededError` (add to `lib/errors.ts`, mapped to 409/403 in `error-handler.ts`). No overspend, no silent hold. (Over-limit → bump flow for marketplace is a deferred enhancement — reject is safe for SP5a.)
- Principal-direct purchases (`subWalletId null`) skip the limit (principal owns the funds, decision #17).
- [ ] TDD: agent over daily limit → LimitExceededError, no txn/redemption/postings; under limit → reserves; principal-direct ignores limit.

### Task 3: Redemptions placeholder ids → real FKs (migration)
**Files:** `db/schema/marketplace.ts`, migration, update purchase tests to seed real retailers/items.
- Change `redemptions.retailerId`/`catalogItemId` from text to `uuid` FK → `retailers.id` / `catalog_items.id` (restrict). Migration via drizzle-kit (commit generated files). Update SP1 purchase/redeem/settlement/expiry tests to create a real retailer + catalog item (via SP2 repos) instead of text placeholders.
- [ ] Full suite green after the swap.

### Task 4: `purchaseService.createFromCatalog` (real pricing entry)
**Files:** `purchase.service.ts`, test.
- `createFromCatalog(db, { actorUserId, masterWalletId, subWalletId?, catalogItemId, idempotencyKey, now? })`: load the item; resolve `{ grossKobo, discountedKobo, dealId }` via `dealsService.effectivePriceKobo(db, catalogItemId, now)`; resolve the retailer's payout bank from `retailersRepo.findById(item.retailerId)`; then run the existing reserve+limit logic. This is what the route calls — the raw `create(amounts...)` stays for tests/internal use.
- [ ] TDD: prices from the active deal; no deal → gross; over-limit rejected.

### Task 5: Re-mount routes (safely)
**Files:** `apps/backend/src/routes/marketplace.ts` (recreate), `server.ts` (mount), route test.
- `POST /marketplace/purchase` (buyer JWT) → `createFromCatalog` (body: `{ subWalletId?, catalogItemId, idempotencyKey }`), 201 voucher. `GET /marketplace/vouchers` → buyer's list. Validate via `parseBody`/Zod, UUIDs via `z.string().uuid()`. Map `LimitExceededError`→409, `ForbiddenError`→403. **Redeem route stays deferred to SP4** (retailer auth). 
- [ ] TDD: over-limit purchase → 409; under-limit → 201; cross-owner sub-wallet → 403; malformed → 400.

### Task 6: finalize
- [ ] Full suite + `test:coverage` green; biome + typecheck clean; **security-reviewer** pass on the purchase/limit path; PR.

## Notes
- bigint kobo; advisory lock closes the concurrent evaluate→reserve race exactly as nip-out.
- Category-lock / merchant-approval-writes-a-rule fusion is a further step (SP5b or follow-up) — SP5a is the money-safety limit gate + real pricing + safe exposure.
