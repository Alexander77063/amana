# Amana — database schema

**Date:** 2026-08-25 · **Source of truth:** `apps/backend/src/db/schema/*.ts` (Drizzle)
**Supersedes** [`BACKEND-SCHEMA.md`](../business/BACKEND-SCHEMA.md), which predates the VAS,
marketplace, sticker and recents schema files.

Generated from the schema as it stands: **30 tables, 29 enums, 35 migrations.** Where this document
and the code disagree, the code is right — but tell someone, because that means this drifted.

## The three invariants that matter more than the tables

**1. All money is `bigint` kobo.** Never a float, never a JS `number`. `Kobo` is a branded type
(`lib/kobo.ts`), totals cross the wire as strings, and any total large enough to exceed
`Number.MAX_SAFE_INTEGER` is a bug waiting rather than a hypothetical.

**2. Double entry is enforced twice, on purpose.** In the application, `ledgerService.writeDoubleEntry`
refuses anything where `sum(debit) !== sum(credit)`. In the database, `postings` carries CHECK
constraints (`debit >= 0`, `credit >= 0`, exactly one side non-zero) **and append-only triggers**
(migration `0005`). `audit_log` is immutable the same way (`0007`).

**Corrections are reversing entries. Never an UPDATE, never a DELETE.** The trigger will stop you,
and that is the point.

**3. A sub-wallet holds no money.** It is a spending *envelope* — decision #7, the limits-only funds
model. Top-ups credit the **master**; spends debit the master. A sub ledger account's balance is
therefore ~0 by construction, which is why the app shows *spend against limit* and not a balance.
Reporting that zero as a balance was a real bug, fixed in SP4b.

## Tables by domain

**Identity & auth** — `users`, `households`, `household_members`, `auth_sessions`, `pairing_tokens`,
`one_shot_tokens`, `device_tokens`, `user_quiet_hours`

`users.role` is `principal | agent | retailer`. The third is a **peer, not a flag**: a retailer owner
has no household, wallet or sub-wallet, so every household route rejects one by default rather than
by remembering to. BVN and NIN are encrypted at rest (`FIELD_ENCRYPTION_KEY`).

**Money** — `master_wallets`, `sub_wallets`, `ledger_accounts`, `postings`, `transactions`,
`idempotency_keys`

`transactions.kind` spans `topup | spend | redemption | marketplace_purchase | vas_purchase | …`.
`transactions.idempotency_key` is UNIQUE — one of the three idempotency layers (the others: Anchor
calls cached by scope+key, and inbound webhooks deduped on event id via `audit_log` *before*
dispatch).

**Control** — `rules`, `rule_sets`, `bump_requests`

`rule_kind` has six values: `limit`, `category`, `time_window`, `allowlist`, `anomaly_threshold`,
`merchant`. Rule sets are **versioned and superseded, never edited** — publishing a new version
supersedes the old one, which is why anything that adds a rule must republish the *whole* set. Get
that wrong and approving a merchant silently deletes the parent's limits.

**Marketplace** — `retailers`, `catalog_items`, `deals`, `redemptions`

`catalog_items` carries **both** `section` and `category`, and they are not the same thing:
`section` is the retailer's own free-text merchandising label ("hair", "kitchen"); `category` is
from the closed `SPEND_CATEGORIES` vocabulary and is **what a parent's category lock is matched
against**. Comparing a lock against retailer-typed free text would deny legitimate items and permit
blocked ones depending on what someone happened to type.

`retailers.approved_at` exists because `suspended` is ambiguous on its own: a `kyb.rejected` webhook
suspends a retailer that was *never* approved, while ops suspending a live one produces the
identical status. `anchor_business_customer_id` cannot separate them either — it is written when KYB
is **submitted**, before Anchor rules on it. Only `approved_at` distinguishes "was live, now
suspended" (must still honour sold vouchers) from "never passed KYB" (must not).

`redemptions` references transactions, retailers and catalog items with `ON DELETE RESTRICT`,
because a sold voucher must still be able to name what was bought.

**VAS** — `vas_purchases`
**Vendors & misc** — `vendor_stickers`, `vendor_recents`, `vas_beneficiaries`
**Observability & prefs** — `audit_log` (immutable), `notifications`,
`notification_preferences`, `subwallet_snooze`, `phone_otp_challenges`

## Migrations

35, in `apps/backend/src/db/migrations/`, generated with `drizzle-kit` and applied in production by
the Fly `release_command`. **Forward-only** — a rollback across a migration boundary needs a
hand-written down-migration, which makes any release containing one a release you cannot cheaply
undo.

**Tests do not run migrations.** Apply them to the test database first; `global-setup.ts` only
checks reachability. Two known drizzle-kit sharp edges, both hit in practice:

- A type change emits a bare `SET DATA TYPE` that fails on a populated column — migration `0030`
  was hand-edited to add `USING "<col>"::uuid`.
- `ALTER TYPE … ADD VALUE` (migration `0034`, adding `merchant`) cannot **use** the new value in the
  same transaction that adds it.

## Keeping this current

Regenerate the inventory with:

```bash
node -e "
const fs=require('fs'), dir='apps/backend/src/db/schema', names=new Set();
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.ts')))
  for (const m of fs.readFileSync(dir+'/'+f,'utf8').matchAll(/pgTable\(\s*'([a-z_]+)'/g))
    names.add(m[1]);
console.log(names.size, [...names].sort().join(' '));
"
```

Deliberately not a grep. Eight tables are declared with the name on the line *after* `pgTable(`,
so a single-line grep undercounts by eight — which is exactly what the first draft of this document
did — and a `-A1` grep over-counts by picking up column names from the following line. Both were
tried here; only the multiline regex gives 30.

If the count no longer matches, this document is stale — say so rather than trusting it.
