# Vendor registry (SP-V1: passive registry + shadow mode)

A passive registry of merchant bank accounts, built from settled transactions, that gives
the rule engine an authoritative category answer to *compare against* — not yet to enforce
— the app-supplied one. Read this before touching anything under `modules/vendors`, before
querying `vendor_observations`/`vendors` directly, or before flipping
`households.vendor_category_enforced` for a household. Companion to the design spec,
[`2026-08-25-vendor-registry-design.md`](../superpowers/specs/2026-08-25-vendor-registry-design.md)
— the spec is the binding source for *why*; this is the *how* for an operator.

## What it is

Two tables, one job each:

- **`vendor_observations`** — the raw material. One row per `(bank_code, account_number,
  household_id)` triple (that's the primary key), written at settlement and incremented
  every time a household's agent or principal settles a payment to that account. Holds a
  running `settled_count`, a per-household `category_counts` jsonb tally (self-attested,
  e.g. `{"food": 12, "transport": 1}`), and first/last-seen timestamps.
  **This table is exposed by no route, and must not acquire one.** It is a payment graph
  over Nigerian bank accounts — who pays whom, how often — and the promotion threshold
  plus the retention sweep (below) are the only things standing between it and a directory
  of private individuals. Do not add a `GET` handler for it, admin-gated or otherwise,
  without revisiting spec §10 first.
- **`vendors`** — the registry proper. A row exists only once an account clears the
  promotion threshold (below). Holds `status` (`observed` / `claimed` / `suspended`),
  `category` + `categorySource` (`observed` / `claimed` / `ops`),
  `categoryHouseholdCount`, and (from SP-V2 on) `publicCode`. Any future read surface is
  built on this table; SP-V1 adds none.

## The sweep

One cron job, `vendor-registry-sweep`, schedule `17 * * * *` — hourly, at 17 minutes past
the hour, offset from the recon-sweep's every-fifth-minute cadence (which already covers
`:00`) so the two full-table scans don't stack. Entry point
`apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts`; logic in
`modules/vendors/vendor-registry.service.ts` → `sweep()`.

Three phases, run in this order, deliberately **not** wrapped in one transaction — each
phase is independently idempotent, so a crash between phases costs at most one hour before
the next pass re-derives everything from `vendor_observations`:

1. **Promote.** Any `(bank_code, account_number)` paid by `COUNT(*) >=
   VENDOR_REGISTRY_MIN_HOUSEHOLDS` distinct households in `vendor_observations` gets a
   `vendors` row (`onConflictDoNothing` on the account, so re-running the sweep promotes
   nothing twice and never rewrites the original `promotedHouseholdCount`).
2. **Categorise.** Every vendor whose `categorySource = 'observed'` gets its consensus
   recomputed from that account's observation rows (one household, one vote — see below).
   A `claimed` or `ops` category is never touched by this pass.
3. **Prune.** Observations with no activity in `VENDOR_OBSERVATION_RETENTION_DAYS`
   (default 180) are deleted — **unless** the account has already been promoted (see
   Retention, below).

**A vendor is never promoted and categorised in the same sweep.**
`VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS` (default 8) is set above
`VENDOR_REGISTRY_MIN_HOUSEHOLDS` (default 5) on purpose: being listed is a weaker claim
than being categorised. A freshly promoted vendor always starts with `category = NULL`
and only picks one up on a later pass, once an 8th household has voted.

## Env vars

All defined in `apps/backend/src/env.ts`. All have defaults; none require a code change to
retune, only an env update and a restart (the one exception — enforcement per household —
needs neither; see below).

| Var | Default | Raising it | Lowering it |
|---|---|---|---|
| `VENDOR_CATEGORY_ENFORCE_DEFAULT` | off — only the literal string `'true'` turns it on | Every household without an explicit `vendor_category_enforced` row starts enforcing the registry category instead of the app-supplied one | N/A — off is the floor |
| `VENDOR_REGISTRY_MIN_HOUSEHOLDS` | `5` | Fewer accounts get listed; each one is a stronger public-facing signal | More accounts get listed, including thinner-traffic ones, weakening the NDPR justification for treating a listed account as a public merchant |
| `VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS` | `8` | Fewer vendors get any category; the ones that do are backed by more votes | More vendors get categorised sooner, on thinner evidence |
| `VENDOR_REGISTRY_CONSENSUS_RATIO` | `0.6` | Category is set less often — needs a stronger majority, so ties and near-ties stay `NULL` | Category is set more easily, tolerating a weaker plurality |
| `VENDOR_OBSERVATION_RETENTION_DAYS` | `180` | Sub-threshold accounts are forgotten sooner (better privacy), but a slow-building legitimate vendor has less runway to reach 5 households before its history resets | Sub-threshold observations survive longer, giving borderline vendors more time to reach the threshold, at a privacy cost |
| `VENDOR_SENSITIVE_CATEGORIES` | `pharmacy,clinic,health,alcohol,gambling,religious,legal` | Removing a category from this list lets it be set by observed consensus — a decision that needs the D-V8 privacy reasoning re-applied, not a config tweak | Adding one moves it to claim-or-ops-only |

## Reading the shadow data

Every evaluation where the registry's answer differs from the app-supplied category, and
that difference would change the decision, is logged to `audit_log` with
`action = 'vendor.category_shadow'`. The query an operator actually runs:

```sql
SELECT payload_json ->> 'categorySource'   AS category_source,
       payload_json ->> 'registryCategory' AS registry_category,
       payload_json ->> 'appCategory'      AS app_category,
       COUNT(*)                            AS n
FROM audit_log
WHERE action = 'vendor.category_shadow'
  AND occurred_at > now() - interval '30 days'
GROUP BY 1, 2, 3
ORDER BY n DESC;
```

`audit_log`'s timestamp column is `occurred_at`, not `created_at` (`db/schema/audit.ts`) —
check before adapting this query for a different action.

**Read `category_source` first, and weight the rows by it.** Only `claimed` and `ops` rows
describe a change that switching enforcement on would actually make — those are the two
sources D-V7 allows to be enforced at all. An `observed` row is the registry disagreeing
in a way it is **never** allowed to act on, however strong the consensus behind it (D-V7).
Counting `observed` rows as evidence for switching enforcement on overstates the case,
usually by a lot: SP-V1 ships no claim rail, so `category_source` is `observed` for every
row this query can return today. The honest read of SP-V1 shadow data is "the registry
logged N disagreements, none of them actionable yet" — useful for judging whether the
claim rail (SP-V2) is worth building, but zero evidence for flipping enforcement on
anywhere right now.

## Switching enforcement on for one household

The only supported way to start enforcing the registry category is per household, by
hand:

```sql
UPDATE households SET vendor_category_enforced = TRUE WHERE id = '<household-uuid>';
```

No deploy and no restart — the enforcement check that Task 10 wires into
`lifecycleService.evaluate` reads this column, and `VENDOR_CATEGORY_ENFORCE_DEFAULT`,
fresh on every transaction intent.

`households.vendor_category_enforced` is **three-state**, and the states are not
interchangeable:

| Value | Meaning |
|---|---|
| `TRUE` | This household enforces the registry category, regardless of `VENDOR_CATEGORY_ENFORCE_DEFAULT`. |
| `FALSE` | This household **never** enforces the registry category, regardless of `VENDOR_CATEGORY_ENFORCE_DEFAULT` — an explicit, sticky opt-out. |
| `NULL` (the default for every existing household) | **Inherit.** This household follows whatever `VENDOR_CATEGORY_ENFORCE_DEFAULT` says *today*, including if it changes later. |

Setting `FALSE` and setting `NULL` are different commitments, and mixing them up either
strands a household mid-rollout or silently re-exposes one that asked out.
`NULL` means "ride the global default" — the household is opted into the rollout and will
start enforcing the moment the global default flips on, with no further action. `FALSE`
means "not this household, ever, until someone explicitly changes it back" — an override
that survives a global flip. Use `FALSE` for a household that has asked out or is the
subject of a support case; leave a household at `NULL` (or never touch its row) to have it
ride the global rollout.

To switch a household back off:

```sql
UPDATE households SET vendor_category_enforced = FALSE WHERE id = '<household-uuid>';
```

and to hand it back to the global default (not the same thing as `FALSE`, per above):

```sql
UPDATE households SET vendor_category_enforced = NULL WHERE id = '<household-uuid>';
```

## Why observed categories never enforce

`vendorCategoryResolver.resolve` (`modules/vendors/vendor-category-resolver.service.ts`)
sets `enforceable: vendor.categorySource !== 'observed'` — an observed category is
returned for shadow logging only, and is never allowed to drive a decision, even for a
household with enforcement on and even at a 100% consensus ratio. This is D-V7, and it is
deliberate YAGNI: an inferred category is one aggregate guess assembled from self-attested
household data, and the shadow log above is precisely the mechanism built to tell us, with
real numbers, whether that guess is trustworthy enough to promote to authoritative.
Deciding now would mean deciding without the measurement this whole sub-project exists to
produce.

What would have to change: SP-V2 ships the claim rail, at which point
`category_source = 'claimed'` starts appearing in real volume and the shadow query above
stops returning only non-actionable rows. Revisiting D-V7 to let a sufficiently strong
observed consensus enforce is named as an open question in the spec (§14.4) — it is not
blocked architecturally, only by the absence, so far, of evidence.

## Retention

Sweep phase 3 deletes `vendor_observations` rows with `last_seen_at` older than
`VENDOR_OBSERVATION_RETENTION_DAYS` (default 180) — but only for accounts with no matching
`vendors` row. An account that never reaches the 5-household threshold is forgotten: the
ad-hoc tradesman from decision #16, paid by one or two households, ages out and leaves no
trace.

**A promoted vendor's observations are never pruned.** Once an account is in `vendors`,
its `vendor_observations` rows are read on every subsequent sweep by the categorisation
pass (phase 2) — deleting them would make a promoted vendor's category regress to `NULL`
the next time consensus needed recomputing. Promotion, in effect, exempts an account from
retention permanently. That is acceptable because a promoted vendor is, by construction of
the threshold, a public-facing merchant rather than one of the private individuals
retention exists to protect.

## Deferred follow-ups

- **No claim rail yet (SP-V2).** Until it ships, every registry category is
  `category_source = 'observed'`; the shadow query above will only ever show `observed`
  rows, and no household can meaningfully turn enforcement on without accepting an
  all-observed, never-enforced-anyway world. That is SP-V1's intended shape, not a bug.
- **No code, no scan path (SP-V3).** `vendors.publicCode` stays `NULL` for every row until
  SP-V2 mints one.
- **Randomised promotion threshold** (spec §10.2) — a defence against a membership-
  inference attack on promotion timing. Deliberately not built in v1 (the sybil cost is
  already high via KYC, there is no public vendor feed, and the payoff is negligible);
  revisit if a public directory, a real-time vendor feed, or cheap household creation ever
  ships.
- **`VENDOR_SENSITIVE_CATEGORIES`'s default list** is a starting guess (spec §14.3) —
  review it against the real category taxonomy before any claim rail lets a vendor request
  a sensitive category.
- **The 5 / 8 / 0.6 thresholds** are starting guesses (spec §14.2) — all three are env
  vars specifically so they can be tuned once shadow data exists, with no deploy beyond an
  env change.
