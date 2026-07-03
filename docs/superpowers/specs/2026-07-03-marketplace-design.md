# Amana Marketplace — Design Spec

**Status:** Design agreed (brainstorm 2026-07-03); pre-implementation. Decomposed into sub-projects; sub-project 1 is the first to build.
**Date:** 2026-07-03
**Owner:** Alex
**Related:** `docs/business/embedded-distribution-strategy.md` (strategy of record — this is its "Layer 2 deals" + "curated marketplace" realised), `docs/brainstorm/locked-decisions.md` (esp. #14 vendor capture, #16 ad-hoc, #17 principal direct), `PRICING.md`.

> **Deliberate strategy override.** The embedded-distribution strategy explicitly sequences distribution as a *post-scale* lever (a rounding error next to the ~₦24.4M/yr core spend-fee engine at the ~1,100-account launch). Building the marketplace now is a conscious decision by the owner, made with that tradeoff surfaced. Amana is also pre-launch (open go-live items: Termii sender ID, OTP-bypass removal, live Anchor sandbox E2E). This spec is cheap; the build is not — the sub-project sequencing below exists so effort lands on the riskiest, highest-leverage slice first and nothing is wasted if priorities shift.

---

## 1. One line

A curated, controlled marketplace inside Amana: vetted retailers list services and offer discounts; users unlock those discounts **only by paying from their Amana wallet**; the wallet's control primitive (category-locks, limits, principal approval) governs who can buy what. Monetised by commission, optional funded campaigns, and — most importantly — the wallet volume the "pay-from-wallet" mandate drives.

## 2. v1 scope (locked in brainstorm)

| Decision | Locked value |
|---|---|
| Fulfillment in v1 | **Digital (Amana-run VAS)** + **in-person services (retailer-listed)**. No logistics. |
| Physical goods / delivery | **Deferred to v2 via a logistics partner** — explicit seam, not retrofit. |
| Money model | **Both, seller's choice:** retailer markdown (commission-only) *and* partner-funded campaigns. **Build markdown-commission first; partner-funded budget is a fast-follow** (needs a new ledger account). |
| Service payout timing | **On redemption**, immediate per-redemption (reserve → release). No held float, no escrow licence. |
| Redeem method | **QR scan primary + short code / USSD fallback.** |
| Retailer onboarding | **Curated: apply → Anchor Business KYB → Amana review → approve.** |
| Who can buy (v1) | **Both:** agents buy within category-locks + limits (over-limit → existing bump flow); principals buy freely; deals are principal-approved. |
| Retailer surface | New **Retailer portal** (platform = gated decision, see §7). |

## 3. Verified foundations — reuse vs net-new (checked against the codebase)

**Reuse (already in the code):**
- **Reservation ledger pattern** — `nip-out.service.ts` reserves via *debit source → credit `suspense`*; `settlement.service.ts` releases via *debit suspense → credit `external`*; `reversal.service.ts` unwinds via *debit suspense → credit source*. The voucher lifecycle is this pattern with a longer-lived hold.
- **Ledger account kinds** — `master, sub, suspense, fee, external` already exist (`schema/wallet.ts`); no new account kind needed for markdown-commission.
- **Balance** — `balanceService.accountBalanceForSubWallet` sums postings, so a reservation posting immediately reduces spendable balance (no double-spend, no separate "available" calc).
- **Cron sweep pattern** — `bump-ttl-sweep` / `recon-sweep` jobs give the template for the voucher-expiry sweep.
- **NIP-out payout** — `nipOutService.send` (with `actorUserId` authz) is the retailer payout rail.
- **Vendor account / sticker rail** (`modules/vendors`, `modules/sticker`) — seed of retailer bank-account resolution and merchant identity.
- **Notifications, rules engine, authz** (`assertWalletAccess`, `ForbiddenError`), idempotency layers.

**Net-new (do NOT assume these exist):**
- **VAS / bill-pay integration** — there is **no** airtime/data/bills module. Digital requires a new Anchor-VAS (or aggregator) integration + adapter methods + a commission-crediting flow. This is a *separable track*, not a freebie.
- **Anchor Business KYB** — adapter has only individual `createCustomer` + `requestKycUpgrade`. KYB is a new adapter method + webhook handling.
- **Voucher/redemption tables + expiry cron + voucher-cancel path.**
- **Marketplace module** (`modules/marketplace`): retailers, catalog, deals, redemptions.
- **Retailer portal app** (new surface) + **buyer marketplace screens** in both mobile apps.
- **New txn kinds / rule kind** (enum migrations).

## 4. Money model & revenue

Three revenue lines:
1. **Commission** — a % of each redeemed purchase, posted to the `fee` ledger account (Amana revenue). Small sellers join with zero budget.
2. **Optional campaign fee** — brands that fund a promo campaign (partner-funded deals; fast-follow).
3. **Wallet economics (the strategic core)** — every purchase must be paid from the Amana wallet, forcing top-up + spend volume through the existing engine. The marketplace's deeper job is to pull money into wallets.

**Open pricing item (TBD — dedicated pricing pass, do not block TDD on the number):** whether a marketplace redemption carries the standard ₦100 per-spend fee *on top of* commission (risks feeling like double-dipping on a discounted purchase), a reduced fee, or commission-only. Spec leaves `MARKETPLACE_SPEND_FEE_KOBO` as an explicit TBD constant.

## 5. The voucher / redemption lifecycle — exact double-entry legs

All amounts `bigint` kobo. `source` = the buyer's sub-wallet LA (agent) or master LA (principal direct, `sub_wallet_id IS NULL` per decision #17). `discounted` = price the buyer pays. `commission` = Amana's cut. `retailerNet = discounted − commission`.

**A. Purchase → reserve** (buyer taps Buy; rules/limits/category-lock checked first via the control fusion):
```
debit  source      discounted
credit suspense     discounted
```
→ `redemption.status = reserved`, mint `code` + `qr_token`, set `expires_at`. Buyer's spendable balance drops immediately. Money has **not** left the wallet.

**B. Redemption → release + payout + commission** (retailer confirms "Service delivered"):
```
debit  suspense    discounted
credit external      retailerNet     (NIP-out to retailer bank fires here)
credit fee            commission
```
Balanced (`discounted = retailerNet + commission`). `redemption.status = redeemed`. Standard NIP + EMTL (>₦10k) apply to the payout exactly like any spend; commission must be floored to cover them (pricing pass). Mirrors the existing settle+fee split.

**C. No-show / expiry / cancel → refund** (expiry-sweep cron, or buyer/retailer cancel before redeem):
```
debit  suspense    discounted
credit source        discounted
```
→ `redemption.status = expired | refunded`. Identical to the existing `reversal.service` legs. Single-use and fixed-amount are invariants (retailer cannot over-claim).

**D. Partner-funded deal (fast-follow, NOT v1-core).** Retailer receives the *full* price; a pre-deposited partner budget covers the gap. Needs a **new ledger account** (`partner_budget`, liability/prepaid) and legs that draw `fullPrice − discounted` from it at redemption. Deferred so the first slice stays tight.

**Idempotency:** redemption keyed `redeem:<redemptionId>`; purchase keyed `mkt:<redemptionId>`; reuse the `transactions.idempotency_key` UNIQUE + Anchor `execIdempotent` layers. Authz: buyer must own the source wallet (`assertWalletAccess`); retailer must own the voucher; these live in the service layer, never trusting the JWT role.

## 6. Redeem mechanics

- **Creation:** at checkout the backend writes a `redemptions` row and mints a short human code (e.g. `AMN-7QK2`) + a matching signed `qr_token`. Backend is source of truth.
- **Where it lives:** buyer's "My Vouchers" screen (QR + code + item + discounted price + expiry countdown + status).
- **Retailer redeem:** Retailer portal → **scan buyer QR (primary)** or **type the short code** → portal shows *buyer · item · amount* → "Service delivered" → triggers leg-set B. **USSD fallback** for feature-phone retailers (dial-in, enter code, confirm) — consistent with decision #14's USSD vendor rail.

## 7. Retailer portal

New surface. **Platform = a /ship Phase-2 architecture gate, NOT settled here.** Recommended candidate: **Expo-web / PWA reusing `@amana/ui` + `@amana/api-client`** (no app-store install; one component system). Caveat to weigh at the gate: `@amana/ui` ships as RN source Metro-transpiles; a data-table-heavy retailer dashboard on RN-web is a real call vs. a dedicated web app (e.g. Next). Decide at Phase 2.

**v1 areas:** Business profile + **Anchor Business KYB** (net-new) + payout bank account; Services storefront (item: name, price, photo, section, description, optional duration); Deals (markdown or funded campaign — window, items, optional budget); Redeem (QR/code/USSD); Orders & redemptions log; Payouts & earnings (settlement **history**, sourced from the ledger — no held balance).
**Deferred:** goods + inventory + delivery (v2 partner), rich analytics (v1 = counts), multi-staff roles (v1 = single owner login).

## 8. Buyer marketplace & the control fusion (the moat)

- **Contextual discovery** — a category-locked sub-wallet surfaces only what it may buy (consented intent from the category-lock signal Amana already owns; not surveillance, NDPR-friendly).
- **Agent view:** catalog filtered to the agent's category-locks; buy within the limit; over-limit → the **existing "request bump"** flow. Agents only ever see what they're already allowed to buy; deals are principal-approved.
- **Principal view:** full marketplace, sees funded deals, can **approve a merchant**.
- **The fusion:** **approving a merchant writes a rule.** "Principal approves Ada's Salon" → the relevant sub-wallet may now spend there at the deal price within its limit. The marketplace and the rule engine are one system — implemented as a **new rule kind** in `modules/rules` (e.g. `merchant`/`marketplace_category`), evaluated by the existing engine. This is the un-clonable piece.

**Guardrails (non-negotiable, from strategy doc):** offers principal-facing / principal-approved, never proactively upsold to agents; any sponsored placement labelled and never the worst-priced option; targeting contextual (category-lock) not cross-app tracking; distribution, not display advertising.

## 9. Data model additions (net-new; `modules/marketplace`)

- `retailers` — business profile, `anchor_business_customer_id`, KYB status, payout bank (code+account), onboarding status (`applied|kyb_pending|approved|suspended`), curated flag.
- `catalog_items` — `retailer_id`, name, price_kobo, photo, section, description, duration, status.
- `deals` — `retailer_id`, item scope, type (`markdown|campaign`), percent/amount, window (start/end), optional `budget_kobo`, status.
- `redemptions` — `transaction_id`, `buyer_user_id`, `retailer_id`, `catalog_item_id`, `deal_id?`, `gross_kobo`, `discounted_kobo`, `commission_kobo`, `code`, `qr_token`, `status (reserved|redeemed|expired|refunded)`, `expires_at`, `redeemed_at`.
- Merchant-approval as a **new rule kind** row in the rules tables (fusion), not a bespoke table, so the existing engine enforces it.
- Enum migrations: new `txn_kind` values (e.g. `marketplace_purchase`, `redemption`), new rule kind.

## 10. Decomposition & sequencing (each sub-project ships independently; own spec + plan + /ship)

1. **Voucher/redemption ledger core** *(build first — riskiest, everything depends on it)*. Backend only: `redemptions` table, purchase→reserve / redeem→release / expiry-refund services with the §5 legs, expiry-sweep cron, redemption API, markdown-commission money model, idempotency + authz + property tests. No UI.
2. **Retailer portal + Business KYB** — new Anchor KYB adapter method + webhooks; portal app (platform decided at Phase-2 gate); storefront/deals/redeem/payouts.
3. **Buyer marketplace + control fusion** — mobile discovery/sections/deal cards; the merchant-approval-writes-a-rule fusion; agent-within-locks purchasing.
4. **Catalog & deals service** — `catalog_items` + `deals` (markdown). *Partner-funded campaign + `partner_budget` ledger account = fast-follow after this.*
5. **Digital / VAS section** — net-new Anchor-VAS integration; separable track, can run in parallel.

## 11. Deferred seams (build v1 so these are not retrofits)

Physical goods + national delivery (v2 logistics partner); local shops/pickup; partner-funded budget ledger account; batched payout (only if float/escrow appetite changes — would need retailer-payable accounts + compliance); multi-staff retailer roles; rich analytics; the ₦100-fee-on-marketplace pricing decision.

## 12. Testing

Follow the repo's real-Postgres Vitest conventions (no DB mocking; `truncateAll` per test; factories; `fast-check` property tests for the ledger). Money code (sub-project 1) is TDD-first with a **security-reviewer** pass: assert balanced legs, single-use/fixed-amount invariants, no double-redeem under concurrency (FOR UPDATE on the voucher row), expiry-refund correctness, and authz (buyer owns source, retailer owns voucher, role claim never trusted).

## 13. Open questions / gates

- **Pricing:** marketplace redemption fee vs commission-only (§4). Dedicated pass.
- **Retailer portal platform** (§7): /ship Phase-2 architecture gate.
- **Commission rate & floor** so it covers NIP + EMTL on small redemptions.
- **VAS aggregator**: Anchor VAS coverage vs a second aggregator (confirm Anchor roadmap).
- **Concurrency** on voucher redemption (row lock) — decided: `SELECT ... FOR UPDATE` on the redemption row in the redeem transaction.
