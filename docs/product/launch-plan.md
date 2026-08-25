# Amana — launch plan

**Date:** 2026-08-25 · **Status:** pre-production, code feature-complete

[`go-live-checklist.md`](../runbook/go-live-checklist.md) answers *"is the environment ready?"*
This answers *"in what order, behind what gates, and what do we do when it goes wrong?"* — which
that checklist deliberately does not cover.

## The gate that actually matters

Today `fly.toml` runs `NODE_ENV=production` against **Anchor's sandbox**. That is the intended
posture: production infrastructure, no real money. Flipping `ANCHOR_API_BASE_URL` to Anchor's
production URL and swapping in a production key is the single irreversible act in this plan.

**Nothing in code prevents production-against-sandbox, by design.** That means the flip is a human
decision at a known moment, and everything below is sequenced around it.

## Stages

### Stage 0 — Internal, sandbox money (now)

Both Fly process groups up, migrations applied via `release_command`, cron running. The team uses it
end to end with sandbox money. Exit criterion: a full week with no unexplained ledger discrepancy
and the recon sweep clean.

### Stage 1 — Live integration verification (the one open gate)

Run `pnpm --filter @amana/backend test:sandbox` against a real Anchor sandbox key with the backend
running, and confirm the four webhook paths land: `transfer.completed`, `transfer.failed`,
`virtual_account.credited`, `kyc.approved`. **This is the only remaining technical gate** — every
other check is green.

Also required before any real user:

- Termii sender ID registered (unregistered messages are silently dropped — nobody can log in)
- `DEV_OTP_BYPASS_CODE` unset in production; the backend refuses to boot if it is set
- `ADMIN_API_KEY` set; unset means every ops route 401s, which fails closed and is correct

### Stage 2 — Ten households, real money, capped

Flip to Anchor production. Ten households the team knows personally, funded with small amounts.

**Caps for this stage:** wallet funding capped low enough that the worst case is an apology and a
manual refund, not a solvency event. The inflow cap (`₦6,000/wallet/month` absorbed) is already the
right shape; set the funding ceiling explicitly for the cohort rather than relying on it.

Watch daily: ledger balance property (postings sum to zero), stuck payouts, `bump_pending`
transactions that nobody actioned, and any `failed_retryable` redemption payout.

### Stage 3 — Fifty households + the first ten retailers

The first stage where the marketplace matters, and the first where a **retailer** is exposed to real
money. Retailers are onboarded by ops through KYB — there is no self-registration, deliberately.

Gate before entering: at least one full redemption cycle completed in stage 2 — voucher bought,
redeemed, payout settled, retailer paid — with the money traced end to end by hand.

### Stage 4 — Open beta

Only after a stage-3 cohort has run four weeks without a money incident.

## Rollback

Ranked by how much they cost, cheapest first.

| Situation | Action | Cost |
|---|---|---|
| Bad deploy | `fly deploy` the previous image | Seconds. Migrations are forward-only, so a rollback that crosses one is **not** safe — see below. |
| Anchor degraded | Circuit breaker already trips; transfers queue as `in_flight` | Users see delay, not loss. |
| A rule change locks people out | Republish the previous rule set version — versions are retained | Minutes. |
| Money moved wrongly | **Reversing entries only.** Postings are append-only and enforced by DB trigger | Manual, slow, correct. |
| Systemic | Flip `ANCHOR_API_BASE_URL` back to sandbox | Stops all real money immediately. Blunt and available. |

**Migrations are the sharp edge.** They run as the Fly `release_command` and are forward-only. A
rollback across a migration boundary needs a hand-written down-migration, so any release containing
one is a release you cannot cheaply undo. Treat those as their own gate.

## Who is told what

- **Users:** nothing until stage 3. Stages 0–2 are people who already know they are testing.
- **Anchor:** before stage 2. They should know real money is about to flow.
- **Retailers:** at onboarding, explicitly including that suspension does not stop redemption of
  vouchers already sold, and that payout follows redemption rather than sale.

## What is deliberately not automated

**No auto-merge, no auto-deploy on green CI.** A deploy is a human decision made with context that a
timer does not have. CI reporting green is information, not permission.
