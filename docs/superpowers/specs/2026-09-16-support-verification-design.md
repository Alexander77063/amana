# Support Verification Design (A1 Task 6)

**Date:** 2026-09-16
**Status:** Approved
**Supersedes** the Task 6 section of
[`2026-08-28-sub-plan-a1-admin-portal-iam.md`](../plans/2026-08-28-sub-plan-a1-admin-portal-iam.md),
which describes a plain tap-to-approve. Number matching replaces it; see *Binding the approval to
the call*.

## Goal

A customer phones support. Support verifies **electronically that the caller controls the number
they claim**, and gets back one bit — verified, or nothing. Verification unlocks *helping*, not
*looking*: after it succeeds support sees masked, operational data and never sees who the customer
is.

This builds out the two permissions `support.verify` and `support.read`, which have existed in the
role matrix since Task 2 and which **nothing currently consumes**.

## Approach

One new backend module, one new table, a `/support` area in the admin portal, and an approve
surface in both Expo apps. Nothing existing is restructured. The two dispatch rails already exist:
`expo-push.provider.ts` and `termii-sms.provider.ts`.

---

## Who can be verified

Principals and agents — the wallet customers, the people whose spends get declined and who
therefore phone. Retailers are **out of scope**: a different relationship, with their own portal,
and a read model (catalog, redemptions, KYB, payouts) that would need its own masking rules. That
is its own task if evidence ever shows retailers phoning support.

---

## Binding the approval to the call

A push reading *"Are you speaking to Amana support? Approve"* can be tapped by a customer who is not
on a call. That makes it a fishing vector: a rogue or socially-engineered operator triggers
verifications and waits for someone conditioned to tap Approve. The audit log would then record a
legitimate-looking verification.

**Number matching closes it.** Approving requires hearing a number the operator reads aloud, which
requires actually being on the call.

**Number matching cannot work over SMS** — there is nothing to tap in a text message. The two rails
therefore get deliberately different mechanics, and this is a design decision rather than an
implementation detail:

| Rail | Mechanic | Attempts |
|---|---|---|
| **Push** | Server picks a 2-digit match number (10–99) plus two distinct decoys. The operator reads the match number aloud; the customer taps one of three. | **One.** A 1-in-3 guess must not be retryable, so a wrong tap denies immediately. |
| **SMS** | Server sends a 6-digit code. The customer reads it *to* the operator, who types it into the portal. | Three, then denied. |

### What the operator screen shows

**Both affordances at once** — the match number *and* a code field — with copy that never states
which rail was used:

> *"If they got a notification, read them **47** and ask them to tap it. If they got a text, ask them
> to read you the code."*

This is the least elegant part of the design and was accepted knowingly. The alternative — telling
the operator which rail was used — leaks whether the customer has the app installed and a live
device token. The customer says which they received, which is fine: they are on the phone. The
system never says.

Rail selection: push when the user has an active device token, otherwise SMS. Never both, so a
verification never costs an SMS it did not need.

---

## No-such-customer must be indistinguishable

`POST /admin/support/verifications` **always** returns `202` with a verification id and a match
number, and **always** writes a row. `user_id` is nullable.

If no user matches the number, nothing is dispatched and the row simply expires. Support sees
*waiting… expired* — which is exactly what a real customer who did not answer looks like.

This is the same reasoning as **PRE-LAUNCH GATE 3**: a staff-facing enumeration oracle is still an
enumeration oracle. An endpoint that answers "no such customer" tells any operator, or anyone who
compromises an operator, whether a given Nigerian phone number banks with Amana.

---

## Data model

### New table: `support_verifications`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | Cited by every subsequent support read |
| `admin_user_id` | uuid not null | The operator who asked. FK `admin_users` |
| `phone_e164` | text not null | The number the operator typed, as stated by the caller |
| `user_id` | uuid **null** | The resolved customer; null when no user matches |
| `status` | enum | `pending \| verified \| denied \| expired` |
| `rail` | enum | `push \| sms \| none` — `none` when nothing was dispatched |
| `match_number` | smallint null | Push rail only |
| `code_hash` | text null | SMS rail only. **Hashed, never plaintext** |
| `attempts` | smallint not null default 0 | Guards the SMS read-back |
| `created_at` | timestamptz not null | |
| `expires_at` | timestamptz not null | End of the pending window |
| `verified_at` | timestamptz null | |
| `session_expires_at` | timestamptz null | Set on verification |

Two new enums: `support_verification_status`, `support_verification_rail`.

### Why a new table rather than a kind on an existing one

Two existing tables look superficially close and are both wrong for this:

- **`phone_otp_challenges`** is *customer-initiated login*. It has no operator, and its lifecycle
  ends at authentication rather than opening a read session.
- **`one_shot_tokens`** is the bumps rail's single-use primitive. No operator identity, no session,
  no notion of an attempt budget.

`support_verifications` carries an **operator identity**, a **session window**, and an **attempt
budget**, and — the load-bearing reason — this row *is the audit anchor*. Every later support read
cites its id, which is what makes "which operator read this customer's transactions, under which
verified session" answerable at all.

### Windows

| Window | Value | Why |
|---|---|---|
| Pending | 3 minutes | Long enough to read a number aloud and have it tapped; short enough that an unanswered fishing attempt dies during the same call |
| Verified session | 15 minutes | From the sub-plan. Tunable |

**A new call is a new row.** Support cannot hold a session open and reuse it for the next caller —
the session is bound to the verification, and the verification is bound to one phone number and one
operator.

---

## What `support.read` unlocks

Only while a verified session is live, and only for the `user_id` on that verification.

| Visible | Absent |
|---|---|
| Masked account (`••••1234`) | Full account number |
| Wallet balances, sub-wallet limits | **BVN, NIN** — not masked, *absent from the response* |
| Transaction amounts, times, status | Full name, address, date of birth |
| Denial reasons, and which rule denied a spend | Anything from before this verification |

"Absent" is precise and deliberate: BVN and NIN are not returned masked, because a masked field
still tells the reader the value exists and how long it is, and because a masking bug leaks the
value while an omitted field cannot. The API shape does not contain them.

**Every read writes `audit_log`** with the operator's `admin_user_id` and the verification id.
Reading customer financial data is itself an event.

---

## Rate limiting — deliberately not the existing shape

The limiter keys on **(operator id, target phone)**. It must **not** key on IP.

The admin-portal runbook already records why: `/admin/auth/*` is one per-IP bucket for all staff,
because behind the same-origin proxy every request arrives from the portal machine. Reusing that
shape here would give every operator one shared bucket — and an endpoint that always answers
"verification sent" is, without a working limiter, an SMS-spend vector pointed at arbitrary Nigerian
phone numbers.

**Counted in the database, not in the existing `rateLimit` middleware.** That middleware keeps an
in-memory bucket store, which is right for a short login window and wrong here: a *daily* per-phone
cap that resets on every deploy is not a cap. `support_verifications` already holds one row per
start, with the operator and the phone on it, so the caps are a `count(*)` over a time window on a
table we are creating anyway — durable, exact, and auditable after the fact.

Two caps, both tunable by env var, with these defaults:

| Cap | Default | Guards against |
|---|---|---|
| Starts per operator | 20 per hour | An operator fishing for blind approvals at volume |
| Starts per target phone | 5 per day, across all operators | SMS spend pointed at one number, and harassment of one customer |

The per-phone cap is deliberately counted **across all operators**, so the limit cannot be walked
around by involving a second member of staff.

**Hitting a cap returns an explicit `429`, not the usual `202`** — and that is not a contradiction
of the no-oracle rule. The rule protects *whether a customer exists*; a rate-limit response reveals
only the request history of the operator or of the typed number, which is true regardless of whether
anyone banks with Amana. Swallowing it into a `202` would be actively harmful: support would sit
watching a verification that was never dispatched, conclude the customer is ignoring them, and blame
the customer for a limit staff hit. Both cap breaches are audited.

---

## Surfaces

### Admin portal — `/support`

One input, one button. Then the verification card: the match number, a code field, live status, and
a countdown. Then the read panels. Following the Task 5 convention, every panel names what it is
**not** showing, so an operator never wonders whether a field is missing or merely empty.

### Principal and agent apps

A modal raised by the push, with an inbox entry as the fallback path when the push is tapped late or
dismissed. Three number buttons. The copy carries the warning that makes number matching work:

> *"Only approve if you called Amana support and they read you this number."*

---

## Known limits — stated here rather than discovered later

- **The audit trail this creates is not readable in the portal.** `audit.read` exists in the matrix
  and `auditor` holds it, but no endpoint consumes it. Task 6 makes this more conspicuous by
  generating exactly the records someone would want to read. Until that endpoint exists, "which
  operator read this customer's data" is answerable only by querying Postgres directly.
- **The CI schema guard will fail the build on the migration commit.** `validate_schema_doc.py`
  (live on `main` since `de50b3a`) will see 41 tables, 42 enums and 50 migrations against a document
  claiming 40/40/49. That is the guard working. It means the `database-schema.md` edit rides in the
  **same commit** as the migration, not after it.
- **Neither deployed environment can exercise the push rail today.** Production `amana-api`
  crash-loops on missing `ANCHOR_API_KEY` / `ANCHOR_WEBHOOK_SECRET`, and its Supabase project no
  longer resolves. Staging cannot boot current `main` either: six secrets are still `Staged` and
  never deployed, and `GOOGLE_OAUTH_*` — boot-required since Task 4 — is absent. Separately, on
  staging `ANCHOR_API_KEY` and `TERMII_API_KEY` share a digest, meaning the same value is in both;
  that is almost certainly a bad paste and should be fixed before staging is trusted. None of this
  blocks Task 6, but it decides how the push rail gets verified — see below.

---

## Verification strategy

| Layer | How |
|---|---|
| Backend | Integration-first against real Postgres, per repo convention — `app.request()` against the real Hono app, `truncateAll()` between tests |
| Rails | Provider doubles for push and SMS; assert dispatch shape, never the network |
| Admin portal | The Task 5 browser probe pattern — mint a real session, walk the screens |
| Push, end to end | **Expo Go against a LAN backend on a real device** (`EXPO_PUBLIC_BACKEND_URL=http://<lan-ip>:3000`), not Fly, for the environment reasons above |

---

## Sequencing

Each step is independently shippable, and each carries its own documentation.

1. Table, migration, verification service, both dispatch rails — with the `database-schema.md` edit
   in the same commit.
2. Support reads, audit binding, rate limiter.
3. Admin portal `/support` screens.
4. Principal app approve surface.
5. Agent app approve surface.

Backend and portal are fully testable today against local Postgres; the mobile steps come last
because they are the ones that need a device.

---

## Documents this falsifies, which move with the code

| Document | What changes |
|---|---|
| [`2026-08-28-sub-plan-a1-admin-portal-iam.md`](../plans/2026-08-28-sub-plan-a1-admin-portal-iam.md) | Task 6 describes plain tap-to-approve; number matching supersedes it |
| [`RRD.md`](../../business/RRD.md) §1.15 | IAM-21 onward — Task 5 stopped at IAM-20 |
| [`APP-FLOW.md`](../../business/APP-FLOW.md) §9 | The support arc: call → verify → the little that is visible |
| [`database-schema.md`](../../product/database-schema.md) | One table, two enums, one migration. **Guard-enforced** |
| [`UI-UX-DESIGN-BRIEF.md`](../../business/UI-UX-DESIGN-BRIEF.md) §10 | The portal support screens |
| [`runbook/admin-portal.md`](../../runbook/admin-portal.md) | Known limits, and what the `support` role renders |

---

## Out of scope

- Retailers as verifiable callers.
- An audit-log **reading** surface. It is a real gap, named above, and it is not this task.
- `money.operate` and JIT elevation — Task 7, deliberately last.
- Any change to how customers authenticate to their own apps.
