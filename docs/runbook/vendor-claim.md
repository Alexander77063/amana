# Vendor claim (SP-V2: claim rail — self-service + ops)

> **Auth changed (sub-plan A1 Task 4).** These flows used to send a shared `x-admin-api-key`. That
> secret is **deleted** — one static credential held by everyone, naming nobody, which the audit log
> could only record as "an operator". Sign in at `/admin/auth/start` with your `amana-ng.com`
> Workspace account instead and send the session cookie:
>
> ```bash
> # -b/-c persist the session cookie across calls
> curl -sS -c admin.jar -L https://admin.amana-ng.com/admin/auth/start   # complete Google sign-in
> curl -sS -b admin.jar https://admin.amana-ng.com/vendors-admin/claim-queue
> ```
>
> You need the `ops` role. A signed-in colleague without it gets 403, not 401 — being staff is not
> the same as being allowed near this surface. Every write below now records **which operator** made
> it.


A shopkeeper whose bank account the passive registry (SP-V1) has already promoted proves
ownership of it and gets a human-typable code to display in-shop. Read
[`vendor-registry.md`](./vendor-registry.md) first — this rail only ever operates on a
vendor that is already `status = 'observed'` there. Companion to the design spec,
[`2026-08-25-vendor-registry-design.md`](../superpowers/specs/2026-08-25-vendor-registry-design.md)
§7 — the spec is the binding source for *why*; this is the *how* for an operator.

**Scope note:** this sub-plan mints and stores a code. **SP-V3 has since shipped**, so a
minted code is now scannable: `kind: 'vendor'` resolution, `GET /vendors/code/:code`, the
public `GET /v/:code` landing page and the agent scan path all exist — see
[`vendor-registry.md` → "The Amana Vendor Code"](./vendor-registry.md). Nothing below covers
a payer looking a code up; this document still covers only a vendor earning one.

**Before any code is printed for a shop window**, read
[`vendor-registry.md` → "PRE-DISTRIBUTION GATE"](./vendor-registry.md): HSTS, HSTS preload
and the `pay.amana-ng.com` DNS record must all be in place first, and none of them is enforced by
code.

## The claim flow

Two unauthenticated endpoints, mounted at `/vendor-claim` (`apps/backend/src/routes/vendor-claim.ts`).
Unauthenticated is deliberate: the claimant is a shopkeeper who has never used Amana and has
no account to sign into.

**Step 1 takes a phone and nothing else** (GATE 3, closed 2026-08-27) and ALWAYS sends a code.
No account is named, so nothing about the registry can decide whether an SMS goes out.

```bash
curl -X POST "$API/vendor-claim/request" \
  -H 'content-type: application/json' \
  -d '{"phone":"+2348012345678"}'
# -> 202 {"status":"pending_verification"}
```

**Step 2 names the account**, behind proof of phone control — which is what lets every
account-dependent answer below speak plainly instead of being leaked by whether a text arrived.

```bash
curl -X POST "$API/vendor-claim/verify" \
  -H 'content-type: application/json' \
  -d '{"phone":"+2348012345678","code":"123456","bankCode":"058","accountNumber":"0123456789","category":"food"}'
```

`verify`'s `category` is optional (nullable, defaults to `null` — a claimant can claim
without asserting a category at all). Response by outcome
(`vendor-claim.ts`, `vendor-claim.service.ts`):

| `verify` outcome | HTTP | Body | Meaning |
|---|---|---|---|
| `claimed` | 200 | `{publicCode, displayName}` | Vendor moved `observed` → `claimed`. |
| `invalid_code` | 401 | `{error: 'invalid_code'}` | Wrong code, or a challenge minted for a different purpose (`wrong_purpose` folds into this — see Deferred follow-ups). |
| `too_many_attempts` | 401 | `{error: 'invalid_code'}` | `OTP_MAX_ATTEMPTS` exhausted on the challenge. **Byte-identical to `invalid_code` on the wire**, unlike `/auth/otp/verify` — see the note below for why the auth precedent stops applying here. |
| ~~`no_attempt`~~ | — | — | **Removed 2026-08-27** closing GATE 3. It was decided by a lookup that ran *before* the OTP was checked, which made it an oracle in its own right; with the account named at `/verify` there is no pre-OTP lookup left to fail, so the state cannot arise. A phone with no live challenge now takes the same `invalid_code` path as a wrong code. |
| `vendor_unavailable` | 409 | `{error: 'vendor_unavailable'}` | OTP was correct, but the vendor stopped being claimable in the meantime — suspended, already `claimed`, or the `claim` compare-and-set lost a race. Distinguishable because it is decided *behind* the verified OTP; see the note below. |
| `ownership_unproved` | 409 | `{error: 'ownership_unproved', detail}` | OTP was correct; NIBSS phone lookup didn't confirm the account. See below — and **[PRE-LAUNCH GATE 3](#pre-launch-gate-3-the-claim-rail-is-still-a-registry-oracle-for-a-caller-who-uses-their-own-phone)**, of which this response is the *more expensive* of two remaining residuals. |
| `partner_down` | 503 | `{error: 'anchor_unavailable'}` | Anchor/NIBSS unreachable during the lookup. Retry later. |

A malformed body 400s from `parseBody` before any of the above runs: a bad phone regex, a
non-10-digit account number, or a `category` outside the closed spend vocabulary
(`SPEND_CATEGORIES` in `@amana/types` — `food`, `transport`, `school`, …, `other`). The
category is **not** free text on either rail. A claimed category *replaces* the app-supplied
one before the rule engine compares it (`lifecycle.service.ts`), so an unconstrained string
would let a vendor decide whether someone else's spending lock applies to them: under a
blocklist any non-colliding value passes, and under an allowlist `"Food"` or a trailing space
silently denies a legitimate spend. Same closed vocabulary, same reason, as the retailer
portal's item categories.

### `invalid_code` and `too_many_attempts` are one response — deliberately

Both collapse into a single `401 {"error": "invalid_code"}`.

**This used to be load-bearing and is now belt-and-braces**, which is worth understanding before
anyone "simplifies" it. Before GATE 3 closed, `verify` resolved the claim attempt *before* checking
the OTP, so an unauthenticated caller could submit a junk code and read the difference as "is this
bank account a promoted registry vendor?" — one request, no control of any phone. The account is now
named at `/verify` and consulted only after the code verifies, so that probe is gone at the source.
The collapse stays because it costs nothing and it is what stops a future edit that reintroduces an
early, account-shaped return from silently reopening the channel.

Two consequences worth knowing before you debug from a log:

- **`routes/auth.ts` is the precedent for collapsing `no_challenge` / `wrong_code` /
  `wrong_purpose`, and is NOT the precedent for `too_many_attempts`.** `/auth/otp/verify` keeps the
  exhausted-attempts answer distinguishable, and is right to: there it guards nothing but the
  caller's own challenge. Here it would report that this phone had a live `vendor_claim` challenge
  to exhaust — weaker than the old registry-membership bit, since the account is no longer consulted
  first, but free to withhold. What would otherwise mask it is a coincidence rather than a design:
  `OTP_MAX_ATTEMPTS` (5) happens to equal `RATE_LIMIT_OTP_PER_PHONE` (5), in an **in-memory,
  per-instance** limiter on a Fly app with `auto_start_machines = true`. A second machine, or either
  constant being tuned, reopens it. Do not re-split them.
- **`vendor_unavailable` is deliberately NOT collapsed into this.** The vendor no longer being
  `observed`, and the `claim` compare-and-set losing a race, both sit *behind* the verified OTP —
  the same gate that protects the retained `409 ownership_unproved` — so distinguishing them
  reintroduces no oracle for an unproven caller. Collapsing them was a real dead end: the
  claimant's code is already consumed, so they would read "invalid code" with no way forward.

**The timing channel closed with the same change.** These answers were byte-identical but never
time-identical: `no_attempt` returned after a single SELECT, while `invalid_code` had already paid
for `otpService.verifyCode` → `argon2.verify` (argon2id, ~64 MiB, t = 3 — `modules/auth/codes.ts`).
Two orders of magnitude, separating exactly the cases the collapse merged. Removing the pre-OTP
lookup put every unproven caller on the argon2-priced path, so there is no fast path left to
measure — and no dummy hash was needed to get there.

### Why `/request` always returns 202 — this is a rule, not a quirk

`/request` returns the **same** `202 {"status":"pending_verification"}`, byte-identical,
whether or not the submitted account is in the registry, whether or not a claim attempt was
already open, and even if an internal error occurred (`vendorClaimService.request` catches
everything and still resolves `{ accepted: true }`). No OTP is sent for an account the
registry doesn't hold, and the caller cannot tell.

**Do not "fix" this into a helpful 404 for "account not found."** A distinguishable
response is an oracle for exactly the fact the promotion threshold exists to keep private:
"has this account been paid by at least `VENDOR_REGISTRY_MIN_HOUSEHOLDS` Amana households."
An attacker who can distinguish "in registry, attempt opened" from "not in registry" can
walk arbitrary bank accounts against this endpoint and learn which ones are frequently paid
by Amana users — the payment-graph leak `vendor_observations` having no route at all is
built to prevent, reachable through a side door.

The uniform *response* is only half of the non-oracle property; the code path is not
flattened, it's the timing that's flattened. An account hit is one SELECT; an in-flight
attempt is a SELECT plus an INSERT; a fresh accepted attempt used to also await an outbound
Termii SMS round trip — until that timing gap became a side channel that leaked the same
bit the uniform body was built to hide. That's why the OTP send is dispatched with
`runInBackground` on the connection pool rather than awaited (`vendor-claim.service.ts`,
`request`): the response leaves the handler at the same point in the control flow whether
or not an SMS goes out behind it. **Do not "fix" this either** — awaiting that send to
"simplify" the flow reopens the same oracle from the timing side, not the body side.

## The two proofs, and why neither alone is sufficient

1. **OTP** (`otpService.verifyCode`, `allowedPurposes: ['vendor_claim']`) proves the
   claimant currently controls the *phone number* they submitted. It proves nothing about
   the *bank account* — anyone who knows a promoted vendor's account number (printed on shop
   POS stickers) can submit their own phone and pass this step.
2. **Phone-lookup match** (`vendorOwnershipService.proveByPhoneLookup`,
   `vendor-ownership.service.ts`) asks NIBSS which account is *primarily* linked to that
   phone number, and checks that it is the exact account being claimed (bank code **and**
   account number — a 10-digit account number is not unique across banks, so account number
   alone would accept a different person's account at a different institution). This proves
   the phone and the account share a BVN. It proves nothing about who currently holds the
   phone — that's step 1's job.

`verify` runs them in that order — OTP first, ownership second — because ownership is a
paid Anchor call and must not run until phone control is already established. Together they
establish "the person holding this phone is BVN-linked to this account"; either alone is a
different, weaker claim, which is why `vendorsRepo.claim`'s state transition only fires once
both have passed.

## What a claimant sees when the automated proof fails

A `409 ownership_unproved` is an **expected**, not exceptional, outcome — a business
account not linked to the claimant's BVN-registered phone happens routinely (staff phones,
a director's personal line, a recently changed number). When it happens:

- The claimant's OTP attempt is **consumed** (`otpChallengesRepo.markConsumed` runs inside
  `otpService.verifyCode` before the ownership check even starts) — they cannot retry
  `verify` with the same code.
- The claim attempt row stays `pending` in `vendor_claim_attempts` — `verify` never writes
  to it on this path. It will sit there, visible to nothing but the ops queue, until
  `VENDOR_CLAIM_TTL_SECONDS` (default 900s / 15 min) elapses — after which it is marked
  `expired` by whichever comes first: the next `/request` for that vendor, which releases
  lapsed rows inline (`vendorClaimsRepo.openAttempt`), or the hourly registry sweep's
  `expireOverdue`.
- **The claimant gets no signal that anyone will look at this.** The 409 body carries a
  machine `detail` (`mismatch` / `not_found` / `bad_input`) and nothing that reads as "an
  operator will follow up." There is no notification, no callback, nothing pushed to ops
  automatically — the row simply exists for someone to find via the queue (below), and only
  until it expires.
- **The claimant can retry immediately, from the same phone.** A repeat `/request` for the
  same vendor from the **same** phone re-opens the attempt already on file — it re-dates
  `expires_at` and sends a **fresh OTP** — so the claimant can go straight back through
  `/verify` (and, if the bank record has since been corrected, complete the claim). No new
  attempt row is created; there is still only ever one pending attempt per (vendor, phone). This is
  what `VENDOR_CLAIM_TTL_SECONDS` (15 min) being longer than `OTP_TTL_SECONDS` (5 min) is
  *for*: several codes may be spent inside one claim window.
  **The re-dating is no longer capped** (GATE 2, closed 2026-08-27). It used to refuse rows
  older than `VENDOR_CLAIM_MAX_HOLD_SECONDS`, which meant a claimant who had been at this for
  an hour stopped receiving codes entirely — the uniform 202 with nothing behind it — and the
  advice here was "don't debug it, hand-approve". That ceiling existed only to bound a squat on
  the exclusive slot; with no exclusive slot it was pure cost to the honest owner, so it is gone.
  A repeat request now always renews and always re-sends.
  **From a different phone it now opens that phone's OWN attempt** and sends it its own code.
  Both are live at once; whoever proves phone control at `/verify` wins, and the claim closes the
  other. Previously this was a silent no-op — the "land-grab guard" — which is precisely what
  let an attacker who had proved nothing lock the real owner out.
- **What an operator should tell the claimant:** they can call back and retry as above — but
  better, the operator should proactively work the queue and hand-approve rather than wait
  for the shopkeeper to notice nothing happened. Nothing about a silent 409 tells a claimant
  to call the operator; the operator has to be the one watching the queue.

**Ops cannot distinguish "failed automated proof" from "OTP never entered"** from the queue
alone: both leave the row at `status = 'pending'` with `ownership_proof = NULL`, since the
409 path never writes to the attempt. Working from the queue means either asking the
claimant what happened or checking application logs for a `vendor claim` warning near the
attempt's `createdAt` — the 409 itself leaves no audit-log trace (see below).

## Working the ops queue

```bash
curl "$API/vendors-admin/claim-queue" -b admin.jar
# -> 200 { "attempts": [ { id, vendorId, phone, status, ownershipProof, expiresAt, verifiedAt, createdAt }, ... ] }
```

`listPendingForOps` (`vendor-claims.repo.ts`) returns up to **200** unexpired `pending`
rows, newest first. Two things to know before treating this as a worklist:

- **Rows are thin.** `vendor_claim_attempts` carries `vendorId`, not the bank code, account
  number, or display name a human needs to recognise the business. Join to `vendors` for
  anything operationally useful:

  ```sql
  SELECT a.id, a.phone, a.created_at, a.expires_at,
         v.display_name, v.bank_code, v.account_number, v.status
  FROM vendor_claim_attempts a
  JOIN vendors v ON v.id = a.vendor_id
  WHERE a.status = 'pending' AND a.expires_at > now()
  ORDER BY a.created_at DESC;
  ```
- **The phone is raw here, fingerprinted everywhere else.** The queue returns the claimant's
  actual phone number; `audit_log` only ever stores `phoneFingerprint(phone)` (`***1234:` +
  8 hex chars of a SHA-256 digest, `vendor-claim.service.ts`). You cannot search the audit
  log by the phone number shown in the queue — only by its fingerprint, computed the same
  way (`phoneFingerprint`, exported for this reason).

### Approving by hand

```bash
curl -X POST "$API/vendors-admin/vendors/<vendor-uuid>/approve-claim" \
  -b admin.jar \
  -H 'content-type: application/json' \
  -d '{"phone":"+2348012345678","category":"food"}'
# -> 200 {"publicCode": "AMNV-...-...", "displayName": "..."}
```

This is the escape hatch for the 409 dead end above — a real business whose phone genuinely
isn't the one NIBSS has on file for its account. Approving:

- Mints a code and claims the vendor **without** re-running either proof — the operator's
  judgement stands in for both.
- Records `ownership_proof` as **`'ops'`**, never `'phone_lookup'`. This is deliberate and
  permanent: the two trust levels (an operator's say-so vs. a NIBSS-confirmed BVN match)
  must stay distinguishable in the data forever after, because they are not the same
  guarantee.
- Writes an `audit_log` entry in the **same transaction** as the claim
  (`actorKind: 'ops'`, action `vendor.claim_approved_by_ops`, payload includes the
  fingerprinted phone, the minted code, the category, and `ownershipProof: 'ops'`) — an
  approval with no record, or a record for an approval that rolled back, are both wrong.
- If a matching queue row exists (`findPendingByPhone` on the phone you pass, and that
  row's `vendorId` equals the vendor you're approving), it's marked `verified` in the same
  transaction and drops off the queue. **Use the exact phone number shown in the queue
  row** — approving with a different phone number (e.g. one told to you over the phone
  by the shopkeeper, if it differs from what they originally submitted) claims the vendor
  but leaves the original queue row `pending` until it expires on its own.

Two failure shapes an operator will hit:

- **`409 {"error": "not_claimable"}`** — the vendor is not currently `status = 'observed'`.
  Either it was already claimed (by this rail or a prior ops approval) or it's suspended.
  Check `vendors.status` before re-trying.
- **Approving a vendor with no matching queue row at all** succeeds anyway — `approve-claim`
  doesn't require a prior `/request`. This is intentional: an operator can claim a vendor on
  a business's behalf entirely out-of-band (a phone call, a support ticket), not only to
  resolve a stuck queue entry.

**This is a powerful action.** `approve-claim` assigns a business identity on an operator's
say-so alone. The admin key that reaches this route is, from this sub-plan on, a credential
that can mint a vendor's public identity — treat `ADMIN_API_KEY` accordingly (rotation,
access logging, whatever your ops-key handling already does for the retailer surface it's
shared with).

### The queue-depth trigger for SP-V2b (micro-deposit verification)

Micro-deposit verification — an independent, phone-lookup-free way to prove account
ownership — was deliberately deferred from this sub-plan. Hand-approval is meant to be the
**exception**, covering the genuine phone/BVN mismatch case; it is not meant to become the
normal path.

**Treat it as routine, not exceptional, once either holds over a rolling 30 days:**
- More than **20%** of completed claims (`claimed` count, `ownershipProof = 'ops'` vs.
  `'phone_lookup'`) went through ops approval, or
- **More than 15 approvals in a single week**, regardless of ratio (a small vendor
  population with a high ops ratio is still a signal, even if the absolute count looks
  small next to a big denominator).

Either threshold crossing is the trigger to build SP-V2b. Like the SP-V1 registry
thresholds (`vendor-registry.md`'s 5/8/0.6), these two numbers are starting judgements, not
measurements — there is no shadow data yet for the claim rail's own approval rate. Revisit
them once real volume exists; the point of naming a number now is only to keep the decision
from being made by vibes when queue-clearing starts feeling routine.

## The enforcement switch

Cross-reference: **[`vendor-registry.md` → "Reading the shadow data" and "Switching
enforcement on for one household"](./vendor-registry.md#reading-the-shadow-data)** for what
the three states mean, why `observed` categories are never enforceable regardless of this
switch, and — critically — **read that household's shadow-data query before touching
this.** Nobody flips enforcement on for a household without first looking at what it will
actually change for that household. This section only adds the API surface; the reasoning
lives there.

SP-V2 adds a route so this no longer requires direct SQL:

```bash
# Turn it ON for one household — this household enforces regardless of the global default.
curl -X POST "$API/vendors-admin/households/<household-uuid>/enforcement" \
  -b admin.jar \
  -H 'content-type: application/json' \
  -d '{"enforced": true}'

# Turn it OFF for one household — sticky opt-out, survives a future global flip to ON.
curl -X POST "$API/vendors-admin/households/<household-uuid>/enforcement" \
  -b admin.jar \
  -H 'content-type: application/json' \
  -d '{"enforced": false}'

# Return to the global default (VENDOR_CATEGORY_ENFORCE_DEFAULT) — NOT the same as false.
curl -X POST "$API/vendors-admin/households/<household-uuid>/enforcement" \
  -b admin.jar \
  -H 'content-type: application/json' \
  -d '{"enforced": null}'
```

`false` and `null` are different commitments (`vendor-registry.md` covers this in full):
`false` means "never for this household, until someone explicitly changes it back"; `null`
means "ride the global default, including if it changes later." Sending the wrong one
either strands a household mid-rollout or silently re-exposes one that asked out.

An unknown household id returns `404 {"error": "not_found"}`.

## Suspending a vendor

```bash
curl -X POST "$API/vendors-admin/vendors/<vendor-uuid>/suspend" \
  -b admin.jar
# -> 200 {"ok": true}
```

`setStatus` moves `vendors.status` to `'suspended'`. **What this actually does today:**

- **Blocks new claims immediately.** `vendorClaimService.request` only proceeds past its
  first check when `vendor.status === 'observed'`; a suspended vendor falls through to the
  same uniform `{accepted: true}` as an unknown account, with no OTP sent. `verify` re-reads
  the vendor and re-checks `status === 'observed'` before proving ownership, so an attempt
  opened just before a suspension still gets refused at the verify step — as
  `409 {"error": "vendor_unavailable"}`, not the collapsed `401`. That check sits *behind* the
  verified OTP, so answering it plainly leaks nothing, and the claimant is no longer told
  "invalid code" for what is really a suspension. It still does not say *why*: a suspension
  and a lost claim race look the same from outside. The attempt row and the audit log are what
  distinguish them when a claimant reports this.
- **Revokes enforcement immediately for an already-`claimed` vendor.**
  `vendorCategoryResolver.resolve` (`vendor-category-resolver.service.ts`) reads `status`
  alongside `categorySource`: `enforceable` is `vendor.categorySource !== 'observed' &&
  vendor.status !== 'suspended'`. `lifecycleService.evaluate`
  (`modules/transactions/lifecycle.service.ts`) consumes exactly that flag, so the moment a
  `claimed` (or ops-approved) vendor is suspended, its category can no longer drive a rule
  outcome for any subsequent spend — this is the documented remedy for a vendor that
  self-asserted a permissive category to evade a household's category lock, and it now
  actually performs the revocation rather than only recording that ops noticed.
  **The category is still visible, on purpose:** `resolve` keeps returning the row (not
  `null`) for a suspended vendor, so `lifecycleService`'s shadow-mode divergence logging
  (`vendor.category_shadow`) keeps recording what the registry believed even after
  suspension — a suspended vendor's continued traffic against its old category is precisely
  what an operator watching the queue wants to keep seeing. Suspension strips the
  *authority* to decide, not the *signal*.
- **Makes its code resolve `410` for every payer, on both surfaces, immediately.** SP-V3
  shipped this: `GET /vendors/code/:code` returns `410 {"error":"VENDOR_SUSPENDED"}`
  (`vendorCodeLookupService`) and the public page `GET /v/:code` returns a `410` "no longer
  active" page (`routes/vendor-page.ts`). A suspended vendor keeps its `publicCode`, which is
  exactly what lets both surfaces distinguish "this code was real and is now dead" from "this
  code never existed" — the latter is a `404` on both. **Immediately** is literal: the page
  sends `Cache-Control: no-store`, precisely so a suspension is not defeated by a cached copy
  still advertising a live business.

**There is no unsuspend route** — only `vendorsRepo.setStatus`, called from this one route
with a hardcoded `'suspended'`. To reverse a suspension, go to SQL directly, and set it back
to `'claimed'` (**not** `'observed'` — that would make the account claimable again by
anyone, discarding the existing `publicCode` and `claimedByPhone`):

```sql
UPDATE vendors SET status = 'claimed' WHERE id = '<vendor-uuid>';
```

## What ops actions leave in the audit log

Every mutating route on `/vendors-admin` writes an `audit_log` row **in the same transaction
as its state change**, and only when a row actually changed — a `404` leaves no trace,
because nothing happened. A shared `ADMIN_API_KEY` names no human, so this row is the only
record that any of it happened at all; that is why the write and the record cannot be
separated. No raw phone number ever reaches a payload (`approve-claim` stores
`phoneFingerprint(phone)`, the others store no phone at all).

| Action | `actorKind` | Subject | Payload |
|---|---|---|---|
| `vendor.claim_approved_by_ops` | `ops` | `vendor` / vendor id | `claimantPhone` (fingerprinted), `publicCode`, `category`, `ownershipProof: 'ops'` |
| `vendor.category_set_by_ops` | `ops` | `vendor` / vendor id | `category`, `previousCategory`, `previousCategorySource` |
| `vendor.suspended_by_ops` | `ops` | `vendor` / vendor id | `previousStatus`, `previousCategorySource` |
| `vendor.enforcement_set_by_ops` | `ops` | **`household`** / household id | `enforced`, `previousEnforced` |

Two things to read carefully:

- **`vendor.enforcement_set_by_ops`'s subject is the household, not a vendor** — the switch
  is scoped to one household and affects every vendor it ever pays. It keeps the `vendor.*`
  action namespace so the whole registry rail stays queryable as one thing
  (`SELECT * FROM audit_log WHERE action LIKE 'vendor.%'`), but you will not find it by
  vendor id.
- **`enforced` is recorded even when it is `null`.** `null` ("inherit
  `VENDOR_CATEGORY_ENFORCE_DEFAULT`") and `false` ("never for this household") are different
  commitments, so the key is always present rather than conditionally omitted.

`vendor.category_set_by_ops`'s `previousCategory` / `previousCategorySource` are the **only**
surviving record that a `claimed` category ever existed: `setOpsCategory` has no CAS guard
and overwrites a business's own answer about itself in place (see Deferred follow-ups).

## Env vars and rate limits

All defined in `apps/backend/src/env.ts`.

| Var | Default | What it controls |
|---|---|---|
| `VENDOR_CLAIM_TTL_SECONDS` | `900` (15 min) | How long a claim attempt stays `pending` before it can be expired. Deliberately longer than `OTP_TTL_SECONDS` (5 min) — a shopkeeper mid-service is not standing at their phone, so the *claim* window outlives the *code* window, and a repeat `/request` from the same phone re-dates the existing attempt and issues a fresh code inside it (`vendorClaimsRepo.openAttempt`'s same-phone recovery). A lapsed `pending` row is released by the next `/request` for that vendor, inline, and by the hourly registry sweep (`17 * * * *`) otherwise — so a row can still outlive its `expires_at` on a vendor nobody calls `/request` on again, but a waiting claimant no longer pays the ~59 min sweep lag. `findPendingByPhone` filters on `expires_at` so a stale row is invisible to `/verify` regardless, and the same-phone recovery deliberately does **not** filter on it so a stale-but-unswept row is still recoverable. |
| ~~`VENDOR_CLAIM_MAX_HOLD_SECONDS`~~ | — | **Removed 2026-08-27** closing PRE-LAUNCH GATE 2. It bounded how long one unproven caller could squat a vendor's single pending slot; a pending attempt is no longer exclusive, so there is nothing to bound. Setting it now is ignored. |
| `RATE_LIMIT_ENABLED` | on (only the literal string `'false'` turns it off) | Gates all rate limiting repo-wide, including the two below. **`loadEnv` refuses to boot in production when it is `false`** — one var otherwise disables the OTP surfaces (an SMS bill and a phone-enumeration oracle), this claim rail, the public vendor page's only protection for Postgres, and the per-account bound on paid Anchor calls, all at once. It is a dev/test escape hatch, not an ops switch. |
| `RATE_LIMIT_OTP_PER_PHONE` | `5` per `RATE_LIMIT_WINDOW_SECONDS` | Applied to **both** `/vendor-claim/request` and `/vendor-claim/verify`, keyed by the `phone` field in the request body. |
| `RATE_LIMIT_OTP_PER_IP` | `20` per `RATE_LIMIT_WINDOW_SECONDS` | Applied to both endpoints, keyed by client IP. |
| `RATE_LIMIT_WINDOW_SECONDS` | `900` (15 min) | The fixed window both limiters above use. |

Both rate limiters are registered per-endpoint in `server.ts`'s `attachRateLimiters` (see
the `for (const path of ['/vendor-claim/request', '/vendor-claim/verify'])` loop) — same
reasoning as the retailer portal's OTP endpoints, plus one more stated in that file's own
comment: "an unrated `/request` is a way to walk the registry," i.e. the rate limiter is
part of what makes the 202 non-oracle property above actually hold in practice, not just in
the response body.

## Deferred follow-ups

### ~~PRE-LAUNCH GATE 1~~: cross-purpose OTP cancellation — **CLOSED 2026-08-27**

Closed in the same PR that ships the rail, deliberately: there is no feature flag on
`/vendor-claim/*`, so merging the rail *is* launching it, and a gate that only a runbook enforces
is not a gate.

**What the hole was.** `otpService.requestCode` called `invalidateActiveForPhone`, which consumed
**every** unconsumed challenge for a phone regardless of purpose. The purpose binding (
`allowedPurposes` in `verifyCode`) stops a `vendor_claim` OTP *completing* a `login`; it did
nothing about a claim request *cancelling* one. So anyone who knew a promoted vendor's account
number — printed on shop POS stickers, not secret — could POST
`{phone: <victim's phone>, bankCode, accountNumber}` to the unauthenticated `/vendor-claim/request`
and silently destroy whatever login OTP that victim was waiting on. Rate limits bound the volume of
that, never a single targeted cancellation.

**What closing it actually required — three changes, not the two this section used to predict:**

| Change | Why |
|---|---|
| `invalidateActiveForPhone(db, phone, **purpose**, now)` | Only supersede challenges of the same purpose. The parameter is **required**, not optional, so a future caller cannot reopen the hole by omitting it. |
| `findActiveByPhone(db, phone, now, **preferPurposes**)` | Scoping the invalidate is what makes two live challenges for one phone possible at all — so an unordered `limit 1` could now hand `verifyCode` a `vendor_claim` row while the user submits a correct `login` code. Orders by "purpose the caller accepts" first, newest second. |
| **Migration `0038`** — unique index `(phone)` → `(phone, purpose)` | The one this section missed. `phone_otp_challenges_by_phone_pending` allowed only ONE unconsumed challenge per phone, so scoping the invalidate alone would have converted the cancellation bug into a unique-violation 500 on `/vendor-claim/request`. The index is *widened*, so no existing row can violate it. |

**`findActiveByPhone` prefers, it does not filter.** When the only live challenge is another
purpose, it is still returned, so `verifyCode` answers `wrong_purpose` exactly as before and the
wire shape documented above is unchanged. Filtering would have answered `no_challenge` instead.

Covered by `otpService cross-purpose isolation` in `tests/modules/auth/otp.service.test.ts`: a
claim request leaves a pending login verifiable and vice versa, the right challenge is selected
when both are live, a lone wrong-purpose challenge still reports `wrong_purpose`, and a repeat
request of the *same* purpose still supersedes its predecessor.

### ~~PRE-LAUNCH GATE 2~~: the attacker-arrives-first race — **CLOSED 2026-08-27**

**What the hole was.** A `pending` row was an EXCLUSIVE slot — the partial unique index was on
`vendor_id` alone — and `/request` handed it out with no proof of anything. Nothing there
establishes that the caller controls the phone they submitted; it is a string in a request body. So
anyone who knew a promoted vendor's account number (printed on shop POS stickers, not secret) could
open a real pending attempt on that vendor with any phone number at all and consume its only slot.
A second, cross-vendor guard made it worse: an attempt open on vendor V under phone P also blocked P
from starting a claim on any *other* vendor W. Both guards were as available to the attacker as to
the owner, and the uniform 202 meant the owner could not tell they had been locked out.

**How it was closed: exclusivity now waits for proof.**

| Change | Effect |
|---|---|
| Migration `0039` — unique index `(vendor_id)` → `(vendor_id, phone)` where pending | Several phones may hold their own live attempt on one vendor. Nobody's request excludes anybody. Still unique per (vendor, phone), so a repeat from the same phone renews its own row rather than piling up duplicates. |
| Cross-vendor guard removed from `vendorClaimService.request` | One phone may be mid-claim on several vendors. `findPendingByPhone` is newest-first, and since Gate 1 scoped OTP invalidation by purpose *while still superseding within a purpose*, a phone has exactly one live `vendor_claim` code — the one its most recent request minted. Newest-first is precisely the attempt that code belongs to. |
| `rejectOtherPendingForVendor`, inside the claim transaction | The verified claimant wins; every other pending attempt on that vendor is closed in the same write. Without it a claimed vendor would leave strangers' attempts `pending` — phantom ops-queue rows, and rows a later `/verify` could still resolve. |
| `VENDOR_CLAIM_MAX_HOLD_SECONDS` **removed** | It existed solely to bound how long one unproven caller could squat the exclusive slot. With no slot there is nothing to bound. Deliberately deleted rather than left as a no-op: a knob that reads like a security control but controls nothing is worse than no knob. |

**The attacker now holds nothing.** They can still open an attempt against any promoted vendor with
any phone string — that is Gate 3's SMS channel, untouched — but the attempt excludes no one, blocks
no other vendor, and expires without ever having cost the real owner a thing. Whoever receives the
OTP wins.

**A trap this also removed.** The old ceiling refused to renew a row past it that had not yet
lapsed, returned null, and so sent the CALLER — including the honest owner whose own row it was —
the uniform 202 with no code. This runbook flagged that window as the one case where a squat
genuinely stranded a victim, and it opened ~60–75 minutes in, i.e. exactly when someone who had been
struggling for an hour called in. There is no ceiling now, so an owner's repeat request always
renews and always re-sends.

**What did NOT change.** The uniform 202 is byte-identical as before, on every path. `approve-claim`
still requires no pending row, so ops can always claim a vendor for the real business. And the
per-phone and per-IP rate limiters on `/request` are still the only bound on request volume.

### ~~PRE-LAUNCH GATE 3~~: the registry-membership oracle — **CLOSED 2026-08-27**

**What the hole was.** The cheapest channel needed no `/verify` call at all. `/request` sent the OTP
to the **caller-supplied** phone, and only when the account resolved to a promoted, unclaimed
vendor. So an attacker submitted their **own** number against someone else's bank account and
watched their handset: one request, no Anchor call. The uniform 202 could not hide it, because the
SMS is not part of the HTTP response. An arriving code was an unambiguous yes to "at least
`VENDOR_REGISTRY_MIN_HOUSEHOLDS` Amana households have paid this account and nobody has claimed it"
— the payment-graph aggregate the promotion threshold exists to keep private.

**How it was closed: the account moved to `/verify`.**

`/request` now takes a phone and nothing else and always sends a code, so no registry fact can
influence whether a text goes out. The account is named at `/verify`, which sits behind a verified
OTP.

**This is not the fix this section used to propose.** That was "prove ownership at `/request` and
send a code only on a NIBSS match", and its cost was stated here as the reason to defer: an honest
owner whose NIBSS-linked phone does not match the account — staff phone, a director's personal
line, a recently changed number, all *expected* rather than exceptional — would get **silence**
instead of a `409` telling them to contact support. Reordering achieves the same thing about the
SMS while keeping that `409`, because the caller is past proof by the time the account is judged.

| Also removed by the reorder | Why it mattered |
|---|---|
| The `no_attempt` result kind | It was decided by a SELECT **before** the OTP was checked, so it was a status channel on its own. Nothing can produce it now: there is no pre-OTP lookup left to fail. |
| The timing channel beside it | `no_attempt` answered after one SELECT while `invalid_code` had already paid for `argon2.verify` (argon2id, 64 MiB, t=3). Byte-identical was never time-identical. Every unproven caller now takes the argon2-priced path. |
| Attempt rows created by unproven callers | A row is written only after the OTP verifies, so the ops queue no longer fills with land-grabs — and GATE 2's race cannot return through this endpoint at all. |

**The residual, stated plainly.** A caller who really does control a phone can still tell
`vendor_unavailable` from `ownership_unproved` and probe registry membership one account at a time.
That is the dearer of the two channels this section always described: it costs an OTP round trip per
probe and is bounded by the per-phone limiter, where the SMS channel cost one unauthenticated
request. Collapsing the two would close it — and would take the actionable answer away from the
honest owner whose bank record simply does not match, which is the trade this gate refused once
already. Left open deliberately; revisit if sandbox data shows the mismatch is rarer than assumed.

**On SMS volume.** `/request` now sends a code to any phone string a caller supplies. That is not a
new capability on the platform: `/auth/otp/request` has always done exactly this, under the same
per-phone and per-IP limiters.

**Not implementable, recorded so nobody re-proposes it:** sending the OTP to the phone on file for
the account. Anchor's NIBSS lookup runs phone → account only (`AnchorPhoneLookupRequest` takes
`phoneNumber`; `GET /nibss/phone-lookup?phoneNumber=…`, `integrations/anchor/adapter.ts`). There is
no account → phone direction to call.

### Other

- **No unsuspend route** (see "Suspending a vendor" above) — SQL only, by design so far;
  revisit if this becomes routine enough to warrant an endpoint and its own audit trail.
- **`setOpsCategory` has no CAS guard at all** (unlike `setObservedCategory`, which only
  overwrites `observed`) — an operator's category write always wins, including over a
  vendor's own `claimed` answer about itself. Correct for a tool gated by `adminAuth`;
  would be dangerous behind anything weaker.
