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
- `modules/transactions` — lifecycle (rule eval → bump or in_flight) + intent + nip-out + settlement + reversal + topup + reconciliation + **refund** (matches inbound credit to a recent settled spend by sender + amount within 14 days; re-credits source).
- `modules/notifications` — preferences matrix + device tokens + 6 templates (`bump_requested` / `bump_decided` / `txn_settled` / `txn_failed` / `anomaly_alert` / `refund_received`) + 3 providers (Expo Push / Termii SMS / in-app) + dispatcher with prefs-aware fan-out and dedupe.
- `modules/auth` — phone OTP (Termii SMS) + JWT access (HS256, 5 min TTL) + opaque refresh tokens (argon2id-hashed, 30 day TTL, rotation on refresh) + pairing tokens for agent onboarding.
- `integrations/anchor` — BaaS adapter: typed client + circuit breaker + retry + idempotency cache + webhook verifier.
- `integrations/termii` — SMS provider HTTP client.
- `cron/` — `node-cron` scheduler + jobs (recon-sweep every 5 min, bump-ttl-sweep every minute) + long-lived worker entrypoint.

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
- `POST /devices` + `DELETE /devices/:id` — Expo Push token registration / revocation
- `GET  /me/notifications` + `POST /me/notifications/:id/read` — in-app inbox
- `GET  /me/notification-preferences` + `PUT /me/notification-preferences` — per-(kind, channel) preferences with optional threshold
- `POST /auth/otp/request` — body: `{phone, purpose: 'login' | 'pair'}` → `{challengeId, expiresAt}` (sends SMS via Termii)
- `POST /auth/otp/verify` — body: `{phone, code, pairingCode?, nin?, bvn?}` → `{accessToken, refreshToken, ..., user}` (signs up principal or pairs agent)
- `POST /auth/refresh` — body: `{refreshToken, userId, role}` → rotated `{accessToken, refreshToken, ...}`
- `POST /auth/logout` — bearer required → revokes session
- `GET  /me` — bearer required → returns the authed user
- `POST /pairing` — bearer required (principal-only) → issues a pairing code for an agent to consume on `/auth/otp/verify`

All routes (except `/health` and `/webhooks/*`) require an `Authorization: Bearer <accessToken>` header obtained from `/auth/otp/verify` or `/auth/refresh`.

## Run locally

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend dev   # API server
pnpm --filter @amana/backend cron  # Cron worker (separate process)
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
- End-to-end route tests (intent → evaluate → bump → resume → send via mocked Anchor → webhook settle).
- Notification dispatch tests across all 6 kinds + 3 channels + dedupe.
- Refund recon tests covering the topup → refund route.
- Cron job tests verifying schedule + dispatch.
- Auth tests for OTP request/verify/rate-limit, JWT issuance/rotation/revocation, and pairing-token consume.
- An optional live smoke against Anchor's sandbox (skipped unless `ANCHOR_API_KEY` is set).

## Recon runner (one-off)

```bash
pnpm --filter @amana/backend exec tsx scripts/recon-runner.ts
```

Sweeps any `IN_FLIGHT > 5min` txn and reconciles via Anchor's transfer-status endpoint. The same logic also runs on a 5-minute cron via `pnpm cron`.
