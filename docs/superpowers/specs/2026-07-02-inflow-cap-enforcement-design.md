# Inflow-Cap Enforcement — Design Spec

**Status:** Design (ship Phase 1); ready for TDD build
**Date:** 2026-07-02
**Owner:** Alex
**Related:** `PRICING.md` Open Item #5 (₦6k cap, DECIDED), Fee Cover (`inflow_fee_absorbed_kobo`)

## Problem

Amana currently absorbs **100%** of Anchor's 0.5% (capped ₦500/load) inflow fee on every top-up
(`topupService.handle` records the full fee in `inflow_fee_absorbed_kobo` and credits the wallet the
full amount). `PRICING.md` decided a **₦6,000 per-wallet-per-calendar-month cap** on that absorption:
above it, the user pays the excess. It is pure whale insurance — set above a heavy shop's ~₦5,000/mo
gross, so it is invisible to every modeled persona and only bites funders > ~₦1.2M/mo.

## Decisions (confirmed)

- Cap: **₦6,000 / wallet / calendar month**.
- Month boundary: **Africa/Lagos (WAT)**.
- On a charge (rare): **notify the principal** (they received slightly less than they sent).
- Charge mechanic: **net from the credited top-up** — the wallet is credited `amount − charged`.

## Design

### Data model
- Add `inflow_fee_charged_kobo` (nullable `bigint`) to `transactions` — the portion of the Anchor
  inflow fee passed to the user on a top-up. Sibling to `inflow_fee_absorbed_kobo`.
- Rename `computeInflowFeeAbsorbedKobo` → **`computeInflowFeeKobo`** (it computes the *gross* Anchor
  fee to be split; "absorbed" is no longer accurate once a cap can split it).

### The split (in `topupService.handle`, `created` path, inside the existing DB transaction)
```
fee       = computeInflowFeeKobo(amount)                       // 0.5% capped ₦500
mtd       = SUM(inflow_fee_absorbed_kobo) for this wallet's    // Lagos calendar month, BEFORE this topup
            settled top-ups in the current Lagos month
remaining = max(0, 6_000_00 − mtd)                             // ₦6,000 in kobo = 600_000
absorbed  = min(fee, remaining)
charged   = fee − absorbed
credited  = amount − charged                                    // net credit to the wallet
```
- Store on the topup txn: `inflowFeeAbsorbedKobo = absorbed`, `inflowFeeChargedKobo = charged`.
  Keep `amountKobo = amount` (gross, what was received); the charge is a separate recorded line.
- **Ledger posting credits `credited`** (was `amount`): `debit master credited / credit external credited`.
  The `charged` portion of the inbound is the user's contribution to Anchor's fee (out of ledger).
- Fee Cover's "fees covered" total already sums `inflow_fee_absorbed_kobo`, so it stays correct
  (it now sums only the absorbed part).

### Month-to-date query (Lagos-aware)
`transactionsRepo.sumInflowFeesAbsorbedInLagosMonth(db, masterWalletId, now)`:
```sql
SELECT COALESCE(SUM(inflow_fee_absorbed_kobo), 0)::text AS s
FROM transactions
WHERE master_wallet_id = ${masterWalletId}
  AND kind = 'topup'
  AND created_at >= (date_trunc('month', ${now} AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')
```
Computed before the current top-up is inserted, so it excludes it.

### Idempotency
No new mechanism needed: `topupService.handle` already short-circuits on the existing
`topup:<nibssSessionId>` UNIQUE key before any split/charge, so a webhook retry cannot double-charge.

### Notification
When `charged > 0`, dispatch an `inflow_charge` notification to the principal (new notification kind
+ template) with the charged amount, so the funder understands the smaller credit. Best-effort
(never fails the top-up), matching the settlement/refund notification pattern.

## Non-goals
- Changing the absorb-100% behaviour for normal wallets (they never reach ₦6k → `charged = 0`,
  `credited = amount`, identical to today).
- Reserving/altering the outbound spend fee (separate).

## Assumption to confirm with Anchor (tracked open item)
The webhook `amountKobo` is treated as the **top-up value the wallet should receive under full
absorption** (i.e. Anchor's inflow fee is borne out-of-band, not netted from this figure). If Anchor
actually nets its fee from the credited amount, the gross/net baseline shifts — same open item as the
EMTL/inflow mechanics in `anchor-float-yield-request.md`. Does not block the build; confirm at go-live.

## Test plan
- **Unit (split):** pure split at boundaries — under cap (all absorbed, charged 0), exactly at cap,
  over cap (partial absorb + charge), already-over (all charged).
- **Integration (`topupService.handle`, real DB):**
  - Normal top-up under the monthly cap → `charged = 0`, wallet credited full `amount`, no notification.
  - A top-up that crosses ₦6k MTD → correct `absorbed`/`charged` split, wallet credited `amount − charged`,
    `inflow_fee_charged_kobo` set, principal notified.
  - MTD resets across the Lagos month boundary.
  - Idempotent on webhook retry (no double charge).
- Full backend suite + coverage gate green; security review of the money path.
