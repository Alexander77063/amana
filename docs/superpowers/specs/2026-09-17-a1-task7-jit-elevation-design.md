# A1 Task 7 — JIT Elevation and Money Operations (Design)

**Date:** 2026-09-17
**Sub-plan:** A1 — Admin portal & IAM (final task)
**Status:** Approved for planning
**Supersedes:** nothing. Completes the intent recorded in `admin-iam.service.ts` at Task 6.

---

## 1. The problem, with evidence

Sub-plan A1 grants `money.operate` to `owner` alone and records, in code, that it is
deliberately not standing power:

> *"Money power is granted here but is NOT standing power: Task 7 puts it behind JIT elevation,
> so holding `owner` is permission to* request *it, with a reason and an expiry."*
> — `apps/backend/src/modules/admin/admin-iam.service.ts:44-46`

Today nothing money-related is operator-invokable at all: `reversal.service`, `refund.service`
and `reconciliation.service` are automated paths with no human entry point. So the permission
exists and does nothing. This task builds the surface it was reserved for.

The surface is not chosen for convenience — it targets a population the automation
**permanently abandons**:

| Fact | Evidence |
| --- | --- |
| A stuck `in_flight` spend has real customer money sitting in **suspense** — debited from the master ledger account, not yet delivered to the vendor | `nip-out.service.ts:106` writes `source → suspense` *before* Anchor is called |
| The reconciliation sweep **gives up for ever** on transfers Anchor has no record of | `reconciliation.service.ts:48` — `remote === null` → `unknown += 1; continue`. No later pass revisits them |
| `findTransferByReference` returning `null` is a **definitive 404**, never a failed call | `anchor/adapter.ts:132-137` — only `AnchorHttpError` with `status === 404` returns null; transport errors, 5xx and an open circuit breaker all `throw` |
| `finalise` and `reverse` are already idempotent under concurrency | `reversal.service.ts:25-33` takes `SELECT … FOR UPDATE`, returns on `failed`, throws on non-`in_flight`; `settlement.service.ts:47-49` mirrors it |

**The harm being fixed:** a customer's money is neither spendable nor delivered, and no
automated process will ever move it again. Only a human can end that state.

---

## 2. Non-goals

- **No new ledger arithmetic.** This task writes no postings of its own. It calls the same
  `settlementService.finalise` / `reversalService.reverse` the cron calls, so the manual and
  automated paths cannot drift where correctness matters most.
- **No second-approver flow.** Maker-checker via `admin_approvals` exists and is deliberately
  not used here (see Decision 2).
- **No refunds, no adjustments, no balance edits, no arbitrary ledger entries.** The only
  outcomes reachable are the two the automation itself would have applied.
- **Non-`spend` kinds are out of scope** — see §11.

---

## 3. Decisions

### Decision 1 — Scope is exactly one operation: resolve a stuck transaction

The portal gains no general "money tools" area. One operation, one shape, one audit trail.
A stuck transaction is the only money state today that is both harmful and unreachable by
automation, so it is the only one that earns a human entry point.

### Decision 2 — Self-elevation with a mandatory reason and expiry; no second person

Unsticking a transaction is a **correction**, not a disbursement: the money is already gone
from the customer's balance and the operation either completes what they asked for or gives it
back. Requiring a second human at 02:00 leaves the customer's money frozen for longer, which is
the harm we are fixing. Maker-checker is right for granting power and wrong for returning money.

The compensating controls, which are what make a single operator acceptable:

1. The operator supplies **authority and a reason; never the outcome** (Decision 3).
2. The only counterparty-unconfirmed action available is a **reverse** — money returning to the
   customer. There is no path by which one operator causes money to leave.
3. Every attempt is audited, including refusals.
4. Elevation is single-use and bound to one transaction (§4).

### Decision 3 — Re-query Anchor and apply what it says

The operator never types an outcome. The service re-queries Anchor and applies the answer:

| Anchor says | Action |
| --- | --- |
| `COMPLETED` | `settlementService.finalise` — the money did arrive; complete the record |
| `FAILED` | `reversalService.reverse` — return the money |
| `PENDING` | **Refuse.** It is not stuck; the sweep owns it |
| no record (404) and older than the force threshold | `reversalService.reverse` **only** |
| no record (404) but younger than the threshold | **Refuse.** Too early to conclude absence |
| call throws (transport, 5xx, open breaker) | **Refuse, loudly.** An unreachable Anchor is never read as absence |

### Decision 4 — Elevation *unlocks* a held permission; it never grants one

This is the decision that keeps invariant 3 intact. `money.operate` stays owner-only.
Elevation does not add the permission to anyone's set — it opens a window in which an operator
who **already holds it** may use it. Therefore:

- `admin` cannot resolve a transaction, elevated or not. It does not hold `money.operate`.
- The `admin`/`owner` mutual exclusion continues to mean what it meant: nobody both grants
  roles and moves money.
- There is no privilege-escalation path to audit, because no privileges are ever escalated.

**Elevation is a second factor in time, not a role change.**

### Decision 5 — Each elevation is bound to one transaction id

A 15-minute window granting broad money power is a different and worse thing than a window
bound to the row being fixed. Binding to a transaction means:

- There is never a moment when an operator holds unscoped money power.
- The audit log answers *"why did you have money power"* with a transaction id, not prose.
- An elevation obtained for transaction A cannot be spent on transaction B.

Reading the stuck list requires `money.operate` but **no elevation** — reading is not
operating. The flow is: see the row → elevate for that row → resolve that row.

---

## 4. Data model

New table `admin_elevations`, migration `0050` (journal is 0-indexed; last existing is `0049`).
Generated with `drizzle-kit generate`, never hand-written, so the journal and snapshot stay
consistent.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `admin_user_id` | uuid not null → `admin_users.id` | who elevated |
| `transaction_id` | uuid not null → `transactions.id` | the single row this elevation authorises |
| `reason` | text not null | free text, non-blank, minimum length enforced in validation |
| `created_at` | timestamptz not null default now() | |
| `expires_at` | timestamptz not null | `created_at + MONEY_ELEVATION_SECONDS` |
| `consumed_at` | timestamptz nullable | set when an operation succeeds against it |

**Append-only**, following `admin_role_grants`: rows are never deleted and never updated except
the one-way `consumed_at` write. History is the point.

**Single-use.** `consumed_at` is set on the first successful operation. A second resolve on the
same transaction requires a *new* elevation with a *new* reason, so a 15-minute window cannot
be spent on a sequence of actions.

Index on `(transaction_id, admin_user_id)` for the liveness lookup.

A live elevation is: `consumed_at IS NULL AND expires_at > now()` for this
`(admin_user_id, transaction_id)` pair.

---

## 5. The operation

`moneyOpsService.resolveStuckTransaction(db, { actorAdminUserId, transactionId, now })`

1. `adminIamService.requirePermission(db, actorAdminUserId, 'money.operate')`.
2. Require a **live elevation** for this `(operator, transactionId)`. Absent or expired → refuse.
3. Load the transaction. Require `status === 'in_flight'`. Any other status → refuse: a settled,
   failed or reversed transaction is not stuck, and refusing is how we avoid becoming a way to
   re-open terminal states.
4. Require age `>= STUCK_TXN_MIN_AGE_SECONDS`. Younger transactions belong to the sweep.
5. `adapter.findTransferByReference(txn.idempotencyKey)` — the same reference the sweep uses.
6. Apply the Decision 3 table. `finalise` / `reverse` are called with the same argument shapes
   the sweep uses:
   - `settlementService.finalise(db, { transactionId, nibssSessionId: remote.nibssSessionId ?? null, settledAt: now })`
   - `reversalService.reverse(db, { transactionId, reason, failedAt: now })`
7. On success, set `consumed_at`.
8. Audit — on **every** branch, including refusals.

**Which `reason` reaches `reverse`.** The `reason` argument on `reversalService.reverse` is the
*transaction's* failure reason and is not the operator's justification:

- on the `FAILED` branch it is Anchor's `remote.failureReason ?? null`, exactly as the sweep
  passes it, so a manually-resolved reversal is indistinguishable from an automatic one;
- on the force branch it is a fixed system string naming that path, because there is no
  counterparty reason to quote.

The operator's free-text justification lives on `admin_elevations.reason` and in the audit
payload. It is never written into the transaction record — the ledger records what happened to
the money, not who authorised the fixing of it.

**If the operation fails, the elevation stays live.** `consumed_at` is written only after a
settle or reverse succeeds. A transport failure, a crash between steps, or a refusal all leave
the elevation usable until it expires, so a retry does not demand a fresh justification for work
that never happened. The opposite rule — consume first — would convert every transient error
into a re-typed reason, and the single-use property exists to stop a window being spent on
*several* actions, not to punish a failed one.

**Concurrency needs no new machinery.** Two operators resolving the same row serialise on the
`SELECT … FOR UPDATE` inside `reverse`/`finalise`; the second sees a terminal status and
no-ops or throws. `transactions.idempotency_key` is UNIQUE, and the manual path reuses it rather
than minting a second reference.

### The force path, and its residual risk

When Anchor has no record after `STUCK_TXN_FORCE_REVERSE_AGE_SECONDS`, the conclusion is that
the transfer request never landed, and the money should go back.

**Stated plainly: if Anchor did process the transfer but its by-reference lookup cannot find
it, a force-reverse credits the customer for money that also left the account.** That is the
one genuine risk in this design. It is mitigated, not eliminated:

- a long threshold (24h default) rather than minutes;
- **reverse only** — this path can never settle, so the error can never be "paid a vendor twice";
- a distinct audit action, because this is the only place a human decides money moves without
  counterparty confirmation;
- a mandatory reason recorded against the transaction id.

---

## 6. API surfaces

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/admin/money/stuck` | `money.operate` | `in_flight` spends older than the min age. Read; no elevation |
| `POST` | `/admin/money/elevations` | `money.operate` | `{ transactionId, reason }` → `{ elevationId, expiresAt }` |
| `POST` | `/admin/money/transactions/:id/resolve` | `money.operate` + live elevation for `:id` | → `{ outcome: 'settled' \| 'reversed' }` |

Refusals carry a machine-readable `error` code — `elevation_required`, `elevation_expired`,
`not_stuck`, `too_early`, `anchor_unreachable`, `still_pending` — so the portal explains the
actual reason rather than a generic failure.

**One portal page** (`/money/stuck`): the list, an elevate dialog that will not submit without
a reason, and a resolve action. The page never offers a choice of outcome, because there isn't
one to offer — the copy states that Anchor decides and the operator authorises.

---

## 7. Audit

`auditRepo.append` with `actorKind: 'ops'`, `actorAdminUserId`, `subjectKind: 'transaction'`,
`subjectId: transactionId` (a uuid, which `audit_log.subject_id` requires).

| Action | When |
| --- | --- |
| `money.elevation_granted` | an elevation is created; payload carries the reason and expiry |
| `money.resolve_settled` | Anchor said `COMPLETED` and the transaction was finalised |
| `money.resolve_reversed` | Anchor said `FAILED` and the money was returned |
| `money.force_reversed` | no Anchor record past the threshold; **distinct on purpose** |
| `money.resolve_refused` | any refusal; payload carries the reason code |

Refusals are audited because "an owner tried to touch this transaction and was stopped" is
exactly the signal an auditor needs, and because an attacker probing the surface should leave
a trail.

---

## 8. Configuration

Added to `env.ts` alongside the Task 6 support values, same pattern:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MONEY_ELEVATION_SECONDS` | `900` | elevation lifetime (15 min) |
| `STUCK_TXN_MIN_AGE_SECONDS` | `900` | below this a transaction is not "stuck" |
| `STUCK_TXN_FORCE_REVERSE_AGE_SECONDS` | `86400` | minimum age before a no-record force-reverse |

---

## 9. Testing strategy

Integration-first against the real Postgres, per the repo's conventions. A fake Anchor adapter
drives each branch. Tests must assert **ledger postings**, not just status strings — the point
of the feature is where the money ends up.

Required cases:

1. `COMPLETED` → transaction settles; suspense is cleared; postings asserted.
2. `FAILED` → transaction reverses; the customer's balance is restored; postings asserted.
3. `PENDING` → refused; **no postings written**.
4. No record, past the force threshold → reverses; `money.force_reversed` audited.
5. No record, below the threshold → refused.
6. Adapter **throws** → refused, and specifically **not** force-reversed. This is the test that
   proves an Anchor outage cannot be laundered into a reversal.
7. Resolving twice → second call is a no-op or a clean refusal; **postings written exactly once**.
8. No elevation → refused.
9. Expired elevation → refused.
10. Consumed elevation → refused.
11. Elevation for transaction A used against transaction B → refused.
12. An `admin` (holding `iam.write`, lacking `money.operate`) with an elevation row present →
    refused. Invariant 3 asserted, not assumed.
13. A non-`in_flight` transaction (`settled`, `failed`, `reversed`) → refused for each.
14. `admin_elevations` added to `TABLES_TO_TRUNCATE` in `tests/helpers/test-db.ts` — a Task 6
    lesson: a table missing from the truncate list leaks rows and corrupts later tests.
15. Adapter throws → the elevation is **still live** afterwards and a retry succeeds without a
    new reason. Pairs with case 6: the failure path must not burn the operator's authorisation.
16. A successful resolve → the elevation is consumed, and a second resolve attempt against the
    same transaction is refused with `elevation_required`.
17. The operator's free-text justification appears on `admin_elevations.reason` and in the audit
    payload, and **does not** appear on the reversal transaction record.

---

## 10. Documentation, in the same commit

- `docs/technical/database-schema.md` — `admin_elevations`; bump the table-count claim (the CI
  drift guard in `tools/docs/validate_schema_doc.py` will fail the build otherwise).
- `docs/business/RRD.md` — new IAM requirements for elevation and stuck-transaction resolution.
- `docs/APP-FLOW.md` — the operator flow, including every refusal path.
- `docs/UI-UX-DESIGN-BRIEF.md` — the stuck-transaction page and the elevate dialog.
- `docs/runbook/admin-portal.md` — **the operational runbook an owner reads at 02:00**, including
  what the force path risks and when not to use it.
- `docs/superpowers/plans/` sub-plan A1 close-out — Task 7 done; sub-plan A1 complete.
- `docs/product/README.md` — statuses and dates made true.

---

## 11. Named follow-ups, deliberately not in this task

**Stuck non-`spend` transactions are not covered.** `reconciliation.service.ts` filters
`kind: 'spend'`, so a stuck **top-up, VAS purchase or marketplace order** is never swept at all
— arguably a worse gap than the one this task closes, since nothing automated even looks.

It is excluded because each kind has a different counterparty leg: a top-up is an *inbound*
credit from Anchor, and a VAS purchase has a third-party fulfilment leg whose completion Anchor
cannot speak to. "Re-query Anchor and apply the answer" is not a correct rule for either, so
folding them in would mean shipping an operation whose core decision table is wrong for two of
its three inputs.

Recommended as the next piece of work after A1 closes, starting with extending the sweep before
building any manual surface for them.

---

## 12. Open questions

None. All three design decisions are settled, and the invariant-3 interaction is resolved by
Decision 4.
