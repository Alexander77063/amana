# Marketplace SP5b — Buyer screens & the control fusion Implementation Plan

## Task 1 comes first, and it is a security fix to shipped code

`modules/marketplace/purchase.service.ts` enforces the **spend limit** (SP5a, under
`pg_advisory_xact_lock`) and **never calls the rule engine**. On `main` today a parent can lock a
sub-wallet to `transport, school` and the agent can buy a voucher for anything in the catalogue.
Category locks and time windows do not apply to marketplace purchases at all.

This is the identical shape to the VAS hole found while recording the demo — bank transfer held,
VAS purchase 201 — and it is fixed the same way.

**It must be proved before it is fixed.** `tools/demo/probe-marketplace.mjs` locks a sub-wallet to
`transport`, buys a catalogue item in another category, and asserts the 201. Run it against
unmodified code first. If it does NOT reproduce, stop and re-read `createFromCatalog`: something
enforces category that the grep missed, and everything below changes.

The fix and the fusion land in **separate commits**. One is a security fix to shipped behaviour and
is cherry-pickable; the other is a new feature.

### Which rules apply, and why not `limit`

Follow the VAS precedent (`assertVasRulesAllow`) exactly: evaluate `category`, `time_window` and
the new `merchant`, and leave `limit` alone. The limit is already enforced inside the advisory
lock, and evaluating it a second time *outside* that lock reintroduces the evaluate→reserve race
the lock exists to close.

### Reject, not bump — and why that differs from spec §8

§8 says an agent going over should hit "the existing request-bump flow". That is not reachable
here: `bump_pending` is produced by `lifecycle.service.evaluate`, and the marketplace purchase path
does not go through it — `purchase.service` creates the reserve transaction directly, and
`resumeAfterBump` has no way back into it. So an out-of-rule purchase **rejects** with
`RuleDeniedError` → 409 `rule_denied`, consistent with SP5a's deliberate reject-not-bump for
over-limit.

Making marketplace purchases bumpable means wiring `marketplace_purchase` into the bump workflow
and giving `resumeAfterBump` a path that re-enters `createFromCatalog`. That is a real piece of
work, not a flag, and is **deferred with the reason recorded** rather than silently skipped.

## Task 2 — `merchant` rule kind (the fusion)

`ALTER TYPE rule_kind ADD VALUE 'merchant'` — it is a pgEnum, and the new value cannot be *used* in
the same transaction that adds it.

`TxnIntent` gains a nullable `retailerId`; a bank transfer has no retailer. It is a shared type, so
this touches every evaluator's call path. The replay runner needs no change — its whitelist is for
bigint fields only, and this is a uuid string.

`evaluators/merchant.ts`: an approved-merchant list. The engine's `evalRule` switch is exhaustive,
so adding the union member makes TypeScript flag it — **do not add a `default` case to silence
that**, it is the compiler doing the job.

## Task 3 — Approving a merchant writes a rule

The single most dangerous operation in this feature. `publishNewVersion` **supersedes the current
rule set and takes the whole rule array**, so approval must read the active set, merge the merchant
rule into it, and republish everything. Getting this wrong silently drops the parent's limits and
category locks — the exact opposite of what approval is for. `EditRulesScreen` already publishes
the whole set for this reason; follow it.

Principal-only, by household ownership, in the service layer.

## Task 4 — Buyer browse endpoints

There is no browse endpoint at all today; `catalogService.listBySection` was written in SP2 and
never exposed.

- `GET /marketplace/sections` — sections with at least one active item.
- `GET /marketplace/items?section=` — items with **`effectivePriceKobo`**, never the gross
  `priceKobo`. A buyer screen that renders the list price shows a number they will not be charged.
- Both filtered for an agent to what their **active rule set** already allows. This is a §8
  guardrail, not a preference: "agents only ever see what they're already allowed to buy". Deriving
  the filter from the same rule set that enforces means display and authorisation cannot disagree.

## Task 5 — The screens

Agent app: browse (pre-filtered), item detail at the effective price, buy, My Vouchers with the
code to show a retailer. Principal app: the same, plus approve-a-merchant.

Guardrails from §8, which are product constraints and not styling: offers are principal-facing and
principal-approved, never proactively upsold to an agent; any sponsored placement is labelled and
is never the worst-priced option; targeting is contextual (the category lock the parent already
set), never cross-app tracking.

## Task 6 — Gates

Coverage headroom is 1.89pp over the gate; this adds an evaluator, routes, a purchase-path change
and screens. Budget tests per task, not at the end. `biome check .` repo-wide, every workspace
typechecked, and the probe re-run to show the hole is closed.

## Self-review

- No floats: bigint kobo throughout; buyer prices come from `effectivePriceKobo`.
- Authorisation by ownership in the service layer, never the `actor` claim.
- The limit stays under the advisory lock; nothing re-evaluates it outside.
- Merchant approval republishes the **whole** rule set.
