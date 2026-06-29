# Funds model — limits-only sub-wallets

How money is represented and controlled in Amana. Read this before reasoning about
a stuck/bumped/failed transaction, or before touching anything under
`modules/wallet`, `modules/rules`, or `modules/transactions`.

## Core principle: sub-wallets are envelopes, not balances

A **principal** funds one **master wallet** (a real Anchor virtual account holding
real money). Agents spend through **sub-wallets**. The locked decision (#7) is a
**limits-only** funds model:

- A sub-wallet does **not** hold a stored balance. It is a *spending envelope*:
  spending authority is defined entirely by its **limit rules** (daily / 30-day
  caps), category locks, time windows, etc.
- There is **no "fund the sub-wallet" flow.** Top-ups credit the **master**; a
  sub-wallet's ledger account is never credited in production. Allocating to an
  agent means *publishing rules*, not moving money.
- **Overdraft of real funds is enforced by Anchor at transfer time**, not by the
  ledger — see [Where overdraft is enforced](#where-overdraft-is-enforced).

> ⚠️ **The single most important gotcha:** no ledger account holds a
> "household available funds" figure, and **a sub-wallet's ledger-account balance
> is NOT its remaining allowance.** Under the envelope model, spend reservations
> *debit* the sub LA and nothing ever credits it, so `accountBalance(subLA)` is
> just the running total of what's been spent — never "what's left." Do not write
> code that treats it as available balance. (That exact mistake — an inert
> `amount > subWalletAvailableKobo` check in the limit evaluator — silently routed
> every within-limit first spend to a bump request, defeating the limits feature.)

## Ledger accounts

All money is **`bigint` kobo** (1 naira = 100 kobo); never floats
(`apps/backend/src/lib/kobo.ts`). Double-entry is enforced in two layers:
`ledgerService.writeDoubleEntry` (≥2 legs, `sum(debit) === sum(credit)`) and DB
CHECK constraints + append-only immutability triggers. Corrections are **reversing
entries, never UPDATE/DELETE**.

Each master wallet has these ledger-account `kind`s
(`db/schema/wallet.ts → ledgerAccountKindEnum`):

| kind       | normal side | meaning                                                        |
|------------|-------------|----------------------------------------------------------------|
| `master`   | debit       | funds the household holds (credited-to via top-ups)            |
| `sub`      | debit       | one per sub-wallet; accumulates that envelope's spend debits   |
| `suspense` | —           | holds in-flight spends between reservation and settlement      |
| `external` | credit      | the outside world (counterparty banks)                         |
| `fee`      | debit       | Amana's NIP fee revenue                                         |

`accountBalance(la) = SUM(debit_kobo) − SUM(credit_kobo)` (`postings.repo.ts`).

## Money flows (actual posting legs)

### Top-up (`transactionsService` / `topup.service.ts`)
Money arrives at the master's virtual account → `virtual_account.credited` webhook.

```
debit  master    amount      (we now hold more)
credit external   amount      (money came from outside)
```
Sub-wallets are **not** touched.

### Agent spend reservation (`nip-out.service.ts`, under a per-sub-wallet advisory lock)
```
debit  sub(subWalletId)   amount
credit suspense           amount
```

### Principal direct spend reservation (`subWalletId = null`)
```
debit  master    amount
credit suspense   amount
```

### Settlement on `transfer.completed` (`settlement.service.ts`)
The reserved spend leaves the building, and the fee is booked as a **separate**
`kind=fee` transaction (idempotency key `<txnId>-fee`):
```
# spend settles
debit  suspense   amount
credit external    amount
# fee (NIP_FEE_KOBO = ₦25)
credit master      fee
debit  fee         fee
```

### Failure → reversal on `transfer.failed` or synchronous Anchor rejection
`reversalService.reverse` writes the reversing legs and marks the txn `FAILED`. No
money moved.

## Spending control — two gates

Authority is bounded **only** by the active rule set's **limit rules**
(`kind: 'limit'`, `windowKind: 'daily' | 'monthly'`, `maxKobo`). `daily` = rolling
24h; `monthly` = rolling **30 days** (`spend-limit.ts`: `DAY_SECONDS` /
`MONTH_SECONDS`). Spend counted in the window =
`postingsRepo.sumDebitsInWindow` over `in_flight` + `settled` spends, by `sent_at`.

1. **Evaluate-time (`lifecycle.service.evaluate`)** — early signal. Runs the rule
   engine. Any failing rule → `require_bump` (the engine has **no deny verdict**:
   `Decision = allow | require_bump`). On `allow`, the txn goes `in_flight`.
2. **Send-time (`nip-out.service.send`)** — authoritative. Under
   `pg_advisory_xact_lock(hashtext(subWalletId))`, re-checks
   `wouldExceedSpendLimit`. This closes the concurrent evaluate→send race: two
   spends that each passed evaluation can't both reserve past the cap; the loser is
   converted to a bump. The `sent_at` atomic claim also blocks a duplicate send.

A breach becomes a **bump request** (principal approves once, or raises the limit),
never a hard rejection.

## Where overdraft is enforced

Not in the ledger (it has no "available" figure). The household cannot overspend
its **real** funds because **Anchor rejects an over-balance NIP**, and every
rejection path reverses locally → `FAILED`:

- synchronous `AnchorHttpError` (4xx, non-retryable) → caught in `send` → reverse;
- `200` with `status: 'FAILED'` → reverse;
- async `transfer.failed` webhook → `reversalService.reverse`.

No code path moves money Anchor does not hold. A separate balance pre-flight is
therefore unnecessary: a ledger-based one would be unsound (no account holds
"available"), an Anchor-balance one redundant with the transfer's own check.

## Operational notes

- **"Why was this within-limit spend bumped?"** Check the active rule set
  (`rules` / `rule_sets`) and the `audit_log` `txn.rule_eval` entry for
  `firstFailedReason`. Remember send-time re-checks the limit under a lock, so a
  spend that passed *evaluation* can still bump at *send* if another spend
  reserved first in the same window.
- **"Spend shows FAILED with an Anchor reason."** That's the overdraft / NIP
  rejection path — the household's real Anchor balance was insufficient or the
  counterparty rejected. The txn `error_message` carries Anchor's reason.
  (Follow-up on the backlog: map Anchor's insufficient-balance signature to a
  friendly "household needs to top up" message once observed in sandbox.)
- **Do not "fund" a sub-wallet** to fix a blocked agent — adjust its **limit
  rules**. There is no sub-wallet funding flow by design.

## Test-fixture caveat

`tests/.../lifecycle.service.test.ts → seedFundedSubWallet(fundSubLedger = true)`
can credit a sub LA for convenience, but that **diverges from production** (where
the sub LA is never funded). Tests that exercise the funds model must pass
`false` to model the real shape — see the "limits-only" regression test. A fixture
that funds the sub LA will mask envelope-model bugs.

## References

- `apps/backend/src/modules/rules/evaluators/limit.ts` — the limit evaluator
- `apps/backend/src/modules/transactions/spend-limit.ts` — send-time gate
- `apps/backend/src/modules/transactions/{nip-out,settlement,reversal,topup}.service.ts`
- `apps/backend/src/modules/wallet/{ledger,postings,ledger-accounts}.*`
- `docs/brainstorm/locked-decisions.md` (decision #7)
- `docs/business/PRICING.md` (₦100 per-spend fee model)
