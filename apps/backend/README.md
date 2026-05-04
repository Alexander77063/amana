# @amana/backend

Amana TypeScript backend on Hono.

## Modules

- `modules/identity` — users, households, household members, KYC tier rules.
- `modules/wallet` — master + sub wallets, ledger accounts, transactions, postings, double-entry write helper.
- `modules/audit` — append-only audit log + typed event constructors.
- `modules/sticker` — vendor sticker resolution stub (per Decision #14).
- `modules/rules` — pure-function rule engine + 5 evaluators + replay corpus + versioned rule sets.
- `modules/bumps` — Result-typed state machine + workflow service (create / decide / sweepExpired / consumeToken).
- `modules/anomaly` — 4 features (amount z-score / hour-of-day / vendor novelty / velocity) + weighted aggregator.
- `modules/vendors` — name enquiry / phone lookup / sticker lookup / NQR decoder / recents / unified resolver (per Decision #16).
- `modules/transactions` — lifecycle (rule eval → bump or in_flight) + intent + nip-out + settlement + reversal + topup + reconciliation.
- `integrations/anchor` — BaaS adapter: typed client + circuit breaker + retry + idempotency cache + webhook verifier.

## Public HTTP routes

- `GET  /health` — liveness check (returns version).
- `POST /webhooks/anchor` — Anchor webhook receiver (HMAC-verified, dispatches to settlement / reversal / topup).
- `GET  /vendors/name-enquiry?bankCode&accountNumber&subWalletId`
- `GET  /vendors/phone-lookup?phoneNumber&subWalletId`
- `GET  /vendors/sticker/:uuid?subWalletId`
- `POST /vendors/nqr-decode` — body: `{payload, subWalletId}`
- `GET  /vendors/recents?subWalletId`
- `POST /transactions/intent` — create a DRAFT spend
- `POST /transactions/:id/evaluate` — runs rule engine; returns allow or bump_pending
- `POST /transactions/:id/send` — calls Anchor.transfer (NIP-out)
- `POST /transactions/:id/resume-after-bump` — body: `{token}` (one-shot from bump approval)
- `POST /bumps/:id/decision` — body: `{decision: approve_once | approve_raise_limit | deny}` (principal-only)

All routes (except `/health` and `/webhooks/*`) require `x-actor-user-id` and `x-actor-role` headers as a placeholder for real auth (lands in Sub-plan 6).

## Run locally

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend dev
```

Visit http://localhost:3000/health → `{"status":"ok","version":"0.0.0"}`.

## Test

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend test
```

The test suite includes:
- Property-based tests for the ledger (Σ debits = Σ credits, idempotency replay).
- DB-trigger tests proving postings + audit_log are append-only.
- Mocked unit tests for the Anchor adapter (circuit breaker, retry, idempotency cache).
- Replay-corpus tests for the rule engine.
- End-to-end route test (intent → evaluate → bump → resume → send via mocked Anchor → webhook settle).
- An optional live smoke against Anchor's sandbox (skipped unless `ANCHOR_API_KEY` is set).

## Recon runner

```bash
pnpm --filter @amana/backend exec tsx scripts/recon-runner.ts
```

Sweeps any `IN_FLIGHT > 5min` txn and reconciles via Anchor's transfer-status endpoint.
