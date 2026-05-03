# @amana/backend

Amana TypeScript backend on Hono.

## Modules

- `modules/identity` — users, households, household members, KYC tier rules.
- `modules/wallet` — master + sub wallets, ledger accounts, transactions, postings, double-entry write helper.
- `modules/audit` — append-only audit log writer.
- `modules/sticker` — vendor sticker resolution stub (per Decision #14).
- `integrations/anchor` — BaaS adapter: typed client + circuit breaker + retry + idempotency cache + webhook verifier.

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
- An optional live smoke against Anchor's sandbox (skipped unless `ANCHOR_API_KEY` is set).
