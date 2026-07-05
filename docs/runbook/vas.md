# Digital VAS (bill payment)

How airtime, data, electricity, and cable-TV purchases move money and are controlled.
Read this before touching anything under `modules/vas`, or before reasoning about a
stuck/failed/refunded VAS purchase. Companion to [funds-model.md](./funds-model.md) —
VAS is a spend, so the envelope/limit model there still applies.

## What it is

A buyer (agent or principal) buys a digital bill from their wallet. Amana is a
**reseller**: Anchor's Bill Payment API fulfils the bill and pays Amana a **commission**
(airtime/data 2%, electricity ~1% cap ₦1,000, cable ~1.2% cap ₦1,500 — confirmed by
Anchor 2026-06-30, see `docs/business/PRICING.md`). There is **no separate VAS
aggregator** — Anchor serves VTU directly.

Unlike the in-person **marketplace redemption** (voucher/QR, retailer paid later), VAS is
**instant/Amana-run**: no retailer, no code, no expiry. The buyer picks a product, pays
face value, Anchor delivers, commission is booked.

## Money model (the ledger)

All amounts are **bigint kobo**. The buyer is charged **face value**; the commission is
the reseller discount **carved from that payment** — structurally identical to a
marketplace redemption settlement (`redemption-settlement.service`), NOT the ₦100 spend
fee.

> ⚠️ **There is NO ₦100 spend fee on VAS.** The ₦100 fee exists to clear the ₦50 NIP cost
> on a *vendor payout*; VAS has no NIP payout (Anchor fulfils directly), and Amana *earns*
> commission instead. Commission is the only VAS revenue — booked to the credit-normal
> `commission` ledger account, never the `fee` account.

Three ledger events, mirroring the NIP-out lifecycle:

| Event | Trigger | Legs (all balanced) |
|---|---|---|
| **Reserve** | `vasPurchaseService.create` | `debit source (sub/master) = amount`, `credit suspense = amount`. txn `kind='vas_purchase'`, status `in_flight`. |
| **Settle** | inline `COMPLETED`, or `bills.successful` webhook → `vasSettlementService.finalise` | `debit suspense = amount`, `credit external = amount − commission`, `credit commission = commission` (zero legs omitted). txn → `settled`. |
| **Refund** | sync throw / 200-`FAILED` / `bills.failed` webhook → `reversalService.reverse` | `debit suspense = amount`, `credit source = amount`. txn → `failed`. |

> ⚠️ **Failed VAS purchases REFUND the buyer** — the deliberate inversion of SP1's
> redemption rule ("payout failure never refunds"). A failed bill delivered nothing, so
> the buyer must get their money back. A failed *redemption* payout does not refund
> because the in-person service was already delivered.

The `vas_purchases` table holds the VAS detail (category, provider, recipient, commission,
prepaid electricity `token`, status `pending|successful|failed`) — the money lives in
`transactions`/`postings`. The two statuses move together at each transition.

Commission is **clamped to `[0, amount]`** and the carve `amount === external + commission`
is asserted explicitly before writing — a hostile/garbled Anchor `commissionKobo` can
never invert the carve or over-credit.

## Recipient control (the cash-out guard)

Airtime/data to an arbitrary number is a way to liquidate controlled funds (buy top-up,
resell). So `beneficiariesService.assertRecipientAllowed` gates every agent purchase:

- **Airtime/data** to the **agent's own registered phone** (`users.phone`) is always
  allowed.
- Any **other** recipient (phone, meter, smartcard) must be an **active, principal-approved
  `vas_beneficiaries` row** for that sub-wallet. `active` is a real boolean; the gate fails
  closed.
- **Electricity/cable** have **no own-recipient bypass** — the meter/smartcard must be an
  approved beneficiary.
- **Principal-direct** purchases (`subWalletId = null`) skip the allowlist (the principal
  owns the funds).
- Beneficiary add/remove is **principal-only** (`assertSubWalletAccess(..., {principalOnly:true})`).

Recipients are normalized (`normalizeRecipient`) to one canonical form before both the gate
check and the Anchor call, so formatting (`0801…` vs `+234801…`) can't spoof the allowlist
or make the gate and the paid number diverge.

## Spend limit

A VAS purchase is a spend: it counts in the sub-wallet limit window
(`postingsRepo.sumDebitsInWindow` counts `vas_purchase` debits with status
`in_flight`/`settled`). The reserve takes `pg_advisory_xact_lock(hashtext(subWalletId))`
and calls `wouldExceedSpendLimit` inside the tx, so concurrent reserves serialise and
over-limit → `LimitExceededError` (→ 409). **Over-limit does NOT convert to a bump** for
VAS (deferred; reject is the safe v1).

## Anchor contract & webhooks

Adapter methods (`integrations/anchor/adapter.ts`), **flat body convention** (kobo as a
string, mirroring `transfer` — NOT Anchor's public nested JSON:API):

- `GET /bills/billers?category=` · `GET /bills/billers/:id/products` · `GET /bills/customer-validation/:slug/:account` (electricity/cable) · `POST /bills` (`payBill`).

`payBill` returns `PENDING`/`INITIATED` (→ wait for webhook), `COMPLETED` (→ settle inline),
or `FAILED` (→ refund). Webhooks (`routes/webhooks.ts`, HMAC-verified + audit-deduped like
`transfer.*`):

- `bills.successful` → `vasSettlementService.finalise` (only if txn still `in_flight`).
- `bills.failed` → `reversalService.reverse` + mark vas row `failed`.
- `bills.initiated` → acknowledged, no ledger action.

### Concurrency safety

`vasSettlementService.finalise` and `reversalService.reverse` take
`SELECT … FOR UPDATE` on the txn row before the status check. VAS has **two settle
triggers** (inline `COMPLETED` + `bills.successful`) plus the refund path, so the row lock
is what stops a double webhook (or an inline-settle racing a webhook) from double-crediting
or settling-and-refunding the same hold (`postings` has no per-`(txn, account)` uniqueness
to catch a double-book). A reordered `bills.failed`-after-`bills.successful` is a safe
no-op (settled never flips to refunded).

## Deferred follow-ups

- **Category-lock does NOT yet gate VAS** — a category-locked sub-wallet can still buy
  airtime within limit to an approved recipient. VAS category/merchant **rule-fusion** is
  SP5b's job; the recipient allowlist is the interim cash-out guard.
- Over-limit → bump for VAS (currently rejects).
- Recon-sweep of stuck `PENDING` VAS bills (webhook is the primary path).
- Prepaid-token **display** (SP5b mobile — we persist the token, we don't render it).
- The Anchor flat wire contract + kobo unit are **inherited from `transfer`** and share the
  single open "live Anchor sandbox E2E" go-live gate — not independently verified.
