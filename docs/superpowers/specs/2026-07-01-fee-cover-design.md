# Fee Cover — Design Spec

**Status:** Design approved (brainstorm), ready for implementation plan
**Date:** 2026-07-01
**Owner:** Alex
**Related:** `docs/business/PRICING.md` §3 "Funding-fee models considered", Open Item #5 (inflow cap)

## Problem / context

Amana absorbs Anchor's **0.5% inflow fee (capped ₦500/load)** so that top-ups are free to the
user — a real, recurring cost we bear (decision A in `PRICING.md`). Today that generosity is
**invisible**: `apps/backend/src/modules/transactions/topup.service.ts` records only the credited
amount and posts a plain double-entry; the inflow fee is **not computed or stored anywhere**. Users
never see the fee we cover, so they don't value it.

**Fee Cover** turns that silent cost into a visible, defensible benefit: a lifetime running total,
per principal, of the bank funding fees Amana has covered on their behalf — surfaced both at the
moment of each top-up and as a home-screen hero card. It doubles as a marketing selling point
("Top-ups always free — we cover the bank's funding fee").

## Goals

- Compute and persist, per top-up, the exact inflow fee Amana absorbed.
- Expose a **lifetime cumulative** "fees covered" total for a principal's master wallet.
- Surface it in the Principal app: a per-top-up confirmation line + a home hero card.
- Use it as a product selling point (onboarding, app-store, landing copy).

## Non-goals (out of scope)

- **₦6k/mo inflow-absorption cap enforcement** (charging the user the excess). This spec always
  absorbs 100%. The cap is a follow-on that will add a sibling `inflowFeeChargedKobo` field and
  split the fee between absorbed/charged. Fee Cover is deliberately the accounting substrate for it.
- Agent-app surfacing (the principal is the funder; agents don't top up).
- Comparative "vs other apps" savings claims (speculative; rejected in favour of the defensible
  "what we actually absorbed" number).

## Design

### 1. Data model & fee computation

- Add nullable `inflowFeeAbsorbedKobo` (`bigint`, kobo) to the **`transactions`** table, set only on
  `kind = 'topup'` rows (Drizzle migration via the `drizzle-migration` skill).
- In `topup.service.handle`, inside the existing DB transaction that books the top-up, compute:

  ```
  feeAbsorbed = min( round(amountKobo * 5, 1000), 50_000n )   // 0.5% capped at ₦500, in kobo
  ```

  where `round(n, d)` is integer round-half-up = `(n + d/2) / d` on `bigint`, via a `lib/kobo.ts`
  helper — **no floats**. Store it on the topup transaction (`transactionsRepo`). The half-up
  rounding is a placeholder until Anchor's actual rounding is confirmed (see Open Questions); a
  single helper keeps it swappable.
- Point-in-time correctness: the fee is stored as computed at top-up time, so a future rate/cap
  change never rewrites historical totals.

### 2. Backend API surface

- New repo method `transactionsRepo.sumInflowFeesAbsorbed(db, masterWalletId): Promise<Kobo>` —
  `SUM(inflow_fee_absorbed_kobo)` over that wallet's `topup` transactions (coalesce null → 0).
- Add `feesCoveredKobo` to the principal **wallet-summary** response. Authorize via
  `wallet-access.service` (`assertWalletAccess`) against the actor's ownership — **not** the JWT
  `role` claim (money-auth rule in CLAUDE.md). Principal-only.
- Include `inflowFeeAbsorbedKobo` on the top-up transaction DTO returned by the api-client so the
  confirmation screen can render the per-load line.

### 3. Principal-app UI (`@amana/ui` + `apps/principal`)

- **Home hero card** (`@amana/ui` component, theme tokens): headline `₦4,820 in bank fees covered`,
  subtitle *"Amana covers the bank's funding fee, so every naira you load lands."* Tappable → a
  lightweight "Your Amana benefits" detail screen. `accessibilityRole="button"`,
  `accessibilityLabel` includes the formatted amount.
- **Per-top-up line**: on the top-up success screen, `Bank fee covered: ₦50 ✓`.
- Amounts formatted with `formatNaira`. Product name: **Fee Cover** (internal); user-facing copy
  uses plain language and needs no glossary.

### 4. Privacy & authorization

- The number is derived solely from the principal's own top-ups — no cross-user data, no external
  tracking. Authorization is ownership-based (service layer), consistent with every money route.

### 5. Anchor integration note

Whether Anchor **nets** its 0.5% from the credited amount or **invoices** it separately is an
integration detail to confirm (same class as the EMTL-mechanics question in
`anchor-float-yield-request.md`). Either way Amana bears the fee and the user is charged ₦0, and the
displayed "covered" figure is the notional 0.5%-capped-₦500. Does not block the build; confirm before
go-live so the stored figure matches Anchor's actual charge.

## Testing plan

- **Backend (vitest, real Postgres):**
  - Top-up stores the correct `inflowFeeAbsorbedKobo` at boundaries: small load (< cap), load at the
    ₦500 cap, load just under/over the cap, ₦0-edge.
  - `fast-check` property test on the fee formula: `0 ≤ fee ≤ min(₦500, amount)`, integer kobo, never
    negative, monotonic in amount up to the cap.
  - `sumInflowFeesAbsorbed` returns the lifetime total across multiple top-ups (and 0 for none).
  - Wallet-summary returns `feesCoveredKobo`; **principal-only** (403 for a non-owner / agent).
- **UI (vitest + react-test-renderer):** hero card renders the formatted naira and accessibility
  labels; top-up success screen shows the covered line. Follow existing `@amana/ui` test harness.

## Marketing / selling-point placement

- Onboarding screen: *"Top-ups always free — we cover the bank's funding fee."*
- App-store bullet + landing section, same line.
- The in-app hero card is the promise made tangible after first use.

## Follow-ons

- **₦6k/mo cap enforcement** — add `inflowFeeChargedKobo`; when a wallet's month-to-date absorbed
  fees reach ₦6,000, route the incremental 0.5% to the user's top-up debit. Fee Cover's per-top-up
  field is the substrate; "covered" then sums only the absorbed portion.

## Open questions

1. Anchor's exact inflow-fee rounding and whether it's netted vs invoiced (see §5).
2. Detail screen scope — just the lifetime total, or a short history of covered fees? (Default:
   lifetime total + last few top-ups.)
