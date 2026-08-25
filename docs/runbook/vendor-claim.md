# Vendor claim (SP-V2: claim rail — self-service + ops)

A shopkeeper whose bank account the passive registry (SP-V1) has already promoted proves
ownership of it and gets a human-typable code to display in-shop. Read
[`vendor-registry.md`](./vendor-registry.md) first — this rail only ever operates on a
vendor that is already `status = 'observed'` there. Companion to the design spec,
[`2026-08-25-vendor-registry-design.md`](../superpowers/specs/2026-08-25-vendor-registry-design.md)
§7 — the spec is the binding source for *why*; this is the *how* for an operator.

**Scope note:** this sub-plan mints and stores a code. It does not make one scannable —
`kind: 'vendor'` resolution, `GET /vendors/code/:code`, and the agent scan path are SP-V3.
Nothing below covers a payer looking a code up; it covers a vendor earning one.

## The claim flow

Two unauthenticated endpoints, mounted at `/vendor-claim` (`apps/backend/src/routes/vendor-claim.ts`).
Unauthenticated is deliberate: the claimant is a shopkeeper who has never used Amana and has
no account to sign into.

```bash
curl -X POST "$API/vendor-claim/request" \
  -H 'content-type: application/json' \
  -d '{"bankCode":"058","accountNumber":"0123456789","phone":"+2348012345678"}'
# -> 202 {"status":"pending_verification"}
```

```bash
curl -X POST "$API/vendor-claim/verify" \
  -H 'content-type: application/json' \
  -d '{"phone":"+2348012345678","code":"123456","category":"food"}'
```

`verify`'s `category` is optional (nullable, defaults to `null` — a claimant can claim
without asserting a category at all). Response by outcome
(`vendor-claim.ts`, `vendor-claim.service.ts`):

| `verify` outcome | HTTP | Body | Meaning |
|---|---|---|---|
| `claimed` | 200 | `{publicCode, displayName}` | Vendor moved `observed` → `claimed`. |
| `invalid_code` | 401 | `{error: 'invalid_code'}` | Wrong code, or a challenge minted for a different purpose (`wrong_purpose` folds into this — see Deferred follow-ups). |
| `too_many_attempts` | 401 | `{error: 'too_many_attempts'}` | `OTP_MAX_ATTEMPTS` exhausted on the challenge. |
| `no_attempt` | 404 | `{error: 'no_attempt'}` | No pending, unexpired claim attempt for this phone. |
| `ownership_unproved` | 409 | `{error: 'ownership_unproved', detail}` | OTP was correct; NIBSS phone lookup didn't confirm the account. See below. |
| `partner_down` | 503 | `{error: 'anchor_unavailable'}` | Anchor/NIBSS unreachable during the lookup. Retry later. |

A malformed body (bad phone regex, non-10-digit account number, oversized category) 400s
from `parseBody` before any of the above runs.

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
  `VENDOR_CLAIM_TTL_SECONDS` (default 900s / 15 min) elapses and the next registry sweep's
  `expireOverdue` marks it `expired`.
- **The claimant gets no signal that anyone will look at this.** The 409 body carries a
  machine `detail` (`mismatch` / `not_found` / `bad_input`) and nothing that reads as "an
  operator will follow up." There is no notification, no callback, nothing pushed to ops
  automatically — the row simply exists for someone to find via the queue (below), and only
  until it expires.
- **What an operator should tell the claimant:** they can call back within the TTL window
  (a fresh `/request` opens a new attempt and a new OTP once the old one is gone — a phone
  can only ever hold one pending attempt at a time), or, better, the operator should
  proactively work the queue and hand-approve rather than wait for the shopkeeper to notice
  nothing happened. Nothing about a silent 409 tells a claimant to call the operator; the
  operator has to be the one watching the queue.

**Ops cannot distinguish "failed automated proof" from "OTP never entered"** from the queue
alone: both leave the row at `status = 'pending'` with `ownership_proof = NULL`, since the
409 path never writes to the attempt. Working from the queue means either asking the
claimant what happened or checking application logs for a `vendor claim` warning near the
attempt's `createdAt` — the 409 itself leaves no audit-log trace (see below).

## Working the ops queue

```bash
curl "$API/vendors-admin/claim-queue" -H "x-admin-api-key: $ADMIN_API_KEY"
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
  -H "x-admin-api-key: $ADMIN_API_KEY" \
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
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"enforced": true}'

# Turn it OFF for one household — sticky opt-out, survives a future global flip to ON.
curl -X POST "$API/vendors-admin/households/<household-uuid>/enforcement" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"enforced": false}'

# Return to the global default (VENDOR_CATEGORY_ENFORCE_DEFAULT) — NOT the same as false.
curl -X POST "$API/vendors-admin/households/<household-uuid>/enforcement" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
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
  -H "x-admin-api-key: $ADMIN_API_KEY"
# -> 200 {"ok": true}
```

`setStatus` moves `vendors.status` to `'suspended'`. **What this actually does today:**

- **Blocks new claims immediately.** `vendorClaimService.request` only proceeds past its
  first check when `vendor.status === 'observed'`; a suspended vendor falls through to the
  same uniform `{accepted: true}` as an unknown account, with no OTP sent. `verify` re-reads
  the vendor and re-checks `status === 'observed'` before proving ownership, so an attempt
  opened just before a suspension still gets refused (`no_attempt`) at the verify step.
- **Does NOT currently stop an already-`claimed` vendor's category from being enforced.**
  `vendorCategoryResolver.resolve` (`vendor-category-resolver.service.ts`) looks the vendor
  up by `(bankCode, accountNumber)` alone and returns `{category, categorySource,
  enforceable}` with no read of `status` at all; `lifecycleService.evaluate`
  (`modules/transactions/lifecycle.service.ts`) consumes exactly that shape and likewise
  never checks `status`. So suspending a vendor that was already `claimed` (or ops-approved)
  **does not by itself pull its category out of enforcement** — if you need that, clear or
  reassign the category separately (`POST /vendors-admin/vendors/:id/category` with
  `category: null`, which sets `categorySource = 'ops'`) alongside the suspend, or check
  whether that gap has closed before relying on suspend alone for this purpose.
- **Makes its code resolve `410` for every payer — this is SP-V3, not live yet.**
  `GET /vendors/code/:code` doesn't exist in this sub-plan; suspension is future-proofed for
  it (a suspended vendor keeping its `publicCode` is what lets SP-V3 distinguish "this code
  was real and is now dead" from "this code never existed"), but nothing currently serves
  that lookup.

**There is no unsuspend route** — only `vendorsRepo.setStatus`, called from this one route
with a hardcoded `'suspended'`. To reverse a suspension, go to SQL directly, and set it back
to `'claimed'` (**not** `'observed'` — that would make the account claimable again by
anyone, discarding the existing `publicCode` and `claimedByPhone`):

```sql
UPDATE vendors SET status = 'claimed' WHERE id = '<vendor-uuid>';
```

## Env vars and rate limits

All defined in `apps/backend/src/env.ts`.

| Var | Default | What it controls |
|---|---|---|
| `VENDOR_CLAIM_TTL_SECONDS` | `900` (15 min) | How long a claim attempt stays `pending` before the registry sweep expires it. Deliberately longer than `OTP_TTL_SECONDS` (5 min) — a shopkeeper mid-service is not standing at their phone, so the *claim* window outlives the *code* window; a claimant may need a fresh `/request` for a new code within the same claim attempt window. |
| `RATE_LIMIT_ENABLED` | on (only the literal string `'false'` turns it off) | Gates all rate limiting repo-wide, including the two below. |
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

### PRE-LAUNCH GATE 1: cross-purpose OTP cancellation

`otpService.requestCode` calls `otpChallengesRepo.invalidateActiveForPhone` (
`otp-challenges.repo.ts`), which invalidates **every** unconsumed OTP challenge for a phone
— regardless of purpose — before minting a new one. `otpChallengesRepo.findActiveByPhone`
has the same gap: it looks a challenge up by phone alone, with no purpose filter either.

The purpose binding shipped ahead of this sub-plan (`allowedPurposes` in `verifyCode`)
stops a `vendor_claim` OTP from *completing* a `login`, and vice versa. It does **not** stop
a claim *request* from *cancelling* an in-flight login OTP. Concretely: anyone who knows a
promoted vendor's account number — printed on shop POS stickers, not secret — can submit
`{phone: <victim's phone>, bankCode, accountNumber}` to `/vendor-claim/request` and silently
invalidate whatever login OTP the victim currently has pending, without needing to know or
guess it.

**This must be closed before the claim rail goes live**, not deferred indefinitely. The
complete fix touches both functions named above: `invalidateActiveForPhone` needs a
`purpose` parameter so it only cancels challenges of the same purpose, and
`findActiveByPhone` needs the same scoping so `verifyCode` can't accidentally pick up a
challenge from a different purpose either. Currently this is bounded only by the per-phone
and per-IP rate limiters on `/vendor-claim/request` (above) — a real mitigation against
volume, not against a single targeted cancellation.

### PRE-LAUNCH GATE 2: the attacker-arrives-first race

`vendorClaimService.request` refuses to open a second attempt when the calling phone
already has one `pending` on a *different* vendor (the `findPendingByPhone` check ahead of
`openAttempt`). This closes the interleaving where an attacker's request arrives while a
legitimate claimant's attempt is already open — the attacker's request is silently
swallowed into the same uniform `202`.

It **cannot** stop an attacker who calls `/request` *first*: nothing about phone-number
ownership is checked at `/request` time (that only happens at `/verify`, via OTP), so an
attacker submitting a victim's phone number against a vendor they don't own opens a real
pending attempt and consumes the one-attempt-per-phone slot, stranding the legitimate
claimant until it expires (`VENDOR_CLAIM_TTL_SECONDS`, 15 min) or the attacker's own
`/verify` attempt fails on OTP (they don't control the victim's phone, so it will). Also
bounded only by rate limits, same as Gate 1.

### Other

- **No unsuspend route** (see "Suspending a vendor" above) — SQL only, by design so far;
  revisit if this becomes routine enough to warrant an endpoint and its own audit trail.
- **`setOpsCategory` has no CAS guard at all** (unlike `setObservedCategory`, which only
  overwrites `observed`) — an operator's category write always wins, including over a
  vendor's own `claimed` answer about itself. Correct for a tool gated by `adminAuth`;
  would be dangerous behind anything weaker.
- **Suspend doesn't pull an already-enforced category out of enforcement** — see
  "Suspending a vendor" above. If this gap needs closing before SP-V3 ships the scan path,
  it's a one-line status check in either `vendorCategoryResolver.resolve` or
  `lifecycleService.evaluate`.
