# Amana — database schema

**Date:** 2026-08-25 · **Refreshed:** 2026-09-09 · **Source of truth:** `apps/backend/src/db/schema/*.ts` (Drizzle)
**Supersedes** [`BACKEND-SCHEMA.md`](../business/BACKEND-SCHEMA.md), which predates the VAS,
marketplace, sticker and recents schema files.

Current as of 2026-09-09: **40 tables, 40 enums, 49 migrations.** Where this document
and the code disagree, the code is right — but tell someone, because that means this drifted.

> **Refresh, 2026-09-09 — this document had drifted in exactly the way it warns about.**
> The 2026-08-25 version said *30 tables, 29 enums, 35 migrations*. Ten tables were missing:
> the five-table admin/IAM subsystem (sub-plan A1), the two consent logs, and the three vendor
> registry tables. That is the same failure this document was written to fix — it superseded
> `BACKEND-SCHEMA.md` for predating five schema files, and then came to predate ten itself,
> in fifteen days.
>
> **What was already right and is unchanged:** all three invariants, every table group below
> through "Observability & prefs", and the forward-only migration policy. Nothing was rewritten;
> the missing tables are appended in their own section, in this document's notation.

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

**Admin & IAM** (added 2026-08-28 → 09-09, sub-plan A1) — `admin_users`, `admin_sessions`,
`admin_auth_requests`, `admin_role_grants`, `admin_approvals`

**Consent** — `user_consents`, `vendor_consents`

**Vendor registry** — `vendors`, `vendor_observations`, `vendor_claim_attempts`

### Admin & IAM — three decisions the tables encode

**Staff are deliberately not rows in `users`.** `users` requires `phone` (unique), `nin` (NOT NULL)
and a `kyc_tier` — it models a Nigerian customer who has passed KYC. Putting staff there would mean
inventing a National Identity Number per employee, sitting in the same encrypted column as real
customers' NINs, purely to satisfy a NOT NULL. Staff have no wallet, no household and no NIN we are
entitled to hold, so they get their own table and `audit_log` grows a second actor column instead
(migration `0042`).

**`admin_users` has no role column.** Roles live in `admin_role_grants`, an append-only log of grant
*events* rather than a set of roles per admin — modelled directly on `vendor_consents`, for the same
reason. An incident review asks "what could this person do **at the time they did it**", and a
mutable set only knows the present. A revocation is a new row; nothing is ever UPDATEd or DELETEd.
A row in `admin_users` proves *who* someone is and nothing about what they may do, which is least
privilege expressed in the schema.

**`admin_approvals` gates only the direction that creates power.** Maker-checker covers role grants
and vendor claim approvals — the two actions that create authority, one over the system and one over
a bank account. Every *removal* is ungated: revoking a role, suspending a vendor and revoking a
merchant's consent all take one person, because requiring two would leave the dangerous state in
place while a second admin is found.

### Consent — append-only, for the same reason twice

`user_consents` and `vendor_consents` are both append-only logs, never mutable flags. The question a
dispute or a regulator actually asks is "what had this person agreed to **at the time**", and a
boolean only knows the present. `termsVersion` is recorded per grant, because a grant is only
meaningful against the terms it was given under.

### Vendor registry — the sensitive one

`vendors` is a payment graph over Nigerian bank accounts, built from `vendor_observations`. **It is
exposed by no route.** The promotion threshold and the retention sweep are what keep it defensible,
and `vendor_recents` cannot serve the purpose — `recentsService.touch` trims to the ten most recent
per sub-wallet on every write, so it destroys its own history by design.

`vendor_claim_attempts` holds one in-flight claim by a phone number against one registry vendor. It
exists because the OTP challenge is keyed by phone alone: something must remember *which* account
the phone claimed between request and verify, and it must not be the client — otherwise the verify
step could redirect a legitimately-earned OTP at a different vendor.

## Migrations

49, in `apps/backend/src/db/migrations/`, generated with `drizzle-kit` and applied in production by
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
