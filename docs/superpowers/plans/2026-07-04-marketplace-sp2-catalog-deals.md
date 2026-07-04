# Marketplace SP2 — Catalog & Deals — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:test-driven-development. Checkbox steps.

**Goal:** The retailer catalog data model + markdown deals + effective-price resolution. Backend only — no HTTP routes (retailer endpoints need SP4 auth; buyer discovery is SP5). Gives SP4/SP5 real retailers, service items, and priced deals to build on.

**Architecture:** New tables `retailers`, `catalog_items`, `deals` in `db/schema/marketplace.ts`; repos + a `catalog.service` and `deals.service` in `modules/marketplace/`. `dealsService.effectivePriceKobo(item, now)` returns the discounted price a buyer would pay (gross → discounted), which SP5's purchase flow will call. **No ledger code, no money movement** — pure catalog/pricing.

**Scope guard:** markdown deals only (partner-funded campaigns = fast-follow, needs the `partner_budget` LA). Retailers are created directly in `approved` state here (the curated apply→review→KYB onboarding is SP4). The `redemptions.retailerId/catalogItemId` text→FK swap is **deferred to SP5** (when the purchase route is mounted and references real items) — do NOT alter SP1's redemptions schema or tests.

---

### Task 1: Schema — `retailers`, `catalog_items`, `deals` (migration)
**Files:** `apps/backend/src/db/schema/marketplace.ts` (extend), migration via `drizzle-kit generate` (commit generated files).
- [ ] `retailerOnboardingStatusEnum = ['applied','kyb_pending','approved','suspended']`; `retailers` table: id, `businessName` text, `anchorBusinessCustomerId` text nullable (KYB in SP4), `payoutBankCode` text, `payoutAccountNumber` text, `onboardingStatus` (default 'approved' for SP2), `createdAt`.
- [ ] `catalogItemStatusEnum = ['active','inactive']`; `catalog_items` table: id, `retailerId` uuid FK→retailers restrict, `name` text, `priceKobo` bigint (gross list price), `section` text, `description` text nullable, `photoUrl` text nullable, `durationMinutes` integer nullable, `status` (default 'active'), `createdAt`.
- [ ] `dealTypeEnum = ['markdown']` (campaign later); `dealStatusEnum = ['active','paused','ended']`; `deals` table: id, `retailerId` uuid FK, `catalogItemId` uuid FK→catalog_items nullable (null = all the retailer's items), `type` default 'markdown', `discountBps` integer nullable, `discountKobo` bigint nullable (exactly one of the two set — enforce in service), `startsAt` timestamptz, `endsAt` timestamptz, `status` default 'active', `createdAt`.
- [ ] `drizzle-kit generate`; `db:migrate`; **git add generated `.sql` + meta**. typecheck exit 0. Commit.

### Task 2: Repos
**Files:** `retailers.repo.ts`, `catalog-items.repo.ts`, `deals.repo.ts` (+ barrel).
- [ ] `retailersRepo`: insert, findById, listApproved. `catalogItemsRepo`: insert, findById, listByRetailer, listBySection (active only). `dealsRepo`: insert, findActiveForItem(db, catalogItemId, retailerId, now) → deals where status active, window covers now, and (catalogItemId matches OR catalogItemId null for retailer-wide). All `DbOrTx` first arg. TDD each.

### Task 3: `catalog.service.ts`
- [ ] `catalogService.createItem(db, {retailerId, name, priceKobo, section, ...})` — validates retailer exists + approved, priceKobo > 0. `listBySection`, `listByRetailer`. TDD.

### Task 4: `deals.service.ts` + effective pricing
- [ ] `dealsService.createDeal(db, {retailerId, catalogItemId?, discountBps?|discountKobo?, startsAt, endsAt})` — validate exactly one discount form set, retailer/item exist, endsAt > startsAt, discount doesn't exceed price. 
- [ ] **`dealsService.effectivePriceKobo(db, catalogItemId, now)`**: load item; find best active deal (largest discount) via `dealsRepo.findActiveForItem`; apply markdown (`price - discountKobo` or `price - floor(price*bps/10000)`), floor at 0 (never negative); return `{ grossKobo, discountedKobo, dealId | null }`. If no active deal → discounted = gross, dealId null. This is the function SP5's purchase flow calls to get the price it charges. TDD: no-deal passthrough, bps markdown, fixed markdown, expired/paused deal ignored, best-of-multiple, never-negative.

### Task 5: finalize
- [ ] Full suite green, `test:coverage` thresholds hold (add tests if needed), biome + typecheck clean. Commit. (PR opened by conductor.)

## Notes
- Money is bigint kobo; discounts floor (never round up), never negative, never exceed price.
- No routes, no ledger, no redemptions changes. Real-Postgres Vitest per repo conventions.
