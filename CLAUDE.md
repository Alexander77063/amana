# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Amana — a phone-to-phone controlled-spend wallet for Nigeria. A **principal** funds a master wallet and issues sub-wallets to N **agents** with real-time limits, category locks, time windows, and remote-or-present authorization. Phone-to-phone is between principal and agent; vendors are paid via standard NIP bank transfer. Two segments, one primitive: households (parents/kids, staff) and small businesses (owners/riders/staff).

Monorepo: pnpm workspaces (`pnpm@10.33.2`, Node `>=20`) + Turborepo. Three apps (`apps/backend`, `apps/principal`, `apps/agent`) and four shared packages (`packages/{types,api-client,ui,validation}`). Biome for format/lint (single quotes, 2-space, 100-col). Backend tests are Vitest against a **real Postgres** (PostGIS) — no DB mocking.

## Commands

Run from repo root unless noted. Root scripts delegate to Turbo.

```bash
pnpm install
docker compose up -d                              # Postgres (PostGIS) on :5432 — required for backend tests
pnpm --filter @amana/backend db:migrate           # apply migrations after pulling
pnpm --filter @amana/backend dev                  # backend on :3000 (tsx watch)
pnpm --filter @amana/principal start              # Expo (also: agent)

# Tests
pnpm test                                          # all (turbo)
pnpm --filter @amana/backend test                  # vitest run
pnpm --filter @amana/backend exec vitest run tests/routes/auth.test.ts   # single file
pnpm --filter @amana/backend test:sandbox          # live Anchor E2E (gated; needs ANCHOR_API_KEY + running backend)

# Quality
pnpm exec biome check .          # lint
pnpm exec biome check --write .  # autofix
pnpm --filter @amana/backend typecheck

# Money/infra ops
pnpm --filter @amana/backend cron        # run cron worker locally (tsx bin/cron.ts)
pnpm --filter @amana/backend db:studio   # drizzle studio
```

Migrations are generated with `drizzle-kit generate` (there is a `drizzle-migration` skill for the full workflow), applied locally via `db:migrate`, and in production via the Fly `release_command` (`node bin/migrate.mjs`). **Tests do not run migrations** — apply them to the test DB first; `global-setup.ts` only checks reachability.

Mobile builds go through **EAS** (`pnpm exec eas build`), not the `build` script (which is a stub). Skills exist for `eas-build`, `fly-deploy`, `drizzle-migration`.

## Backend structure — read this before adding code

The module layout differs from a typical "service/repo/routes-per-module" pattern. Don't assume; follow what's here:

- **HTTP routes are centralized in `apps/backend/src/routes/`** (one file per resource: `auth.ts`, `households.ts`, `transactions.ts`, `bumps.ts`, `webhooks.ts`, …), mounted in `src/server.ts` via `createServer()` (Hono). Routes do **not** live inside module folders.
- **`apps/backend/src/modules/<domain>/`** holds business logic only, in flat dot-namespaced files: `*.service.ts`, `*.repo.ts`, plus an `index.ts` barrel. Modules: `anomaly, audit, auth, bumps, identity, media, notifications, rules, sticker, transactions, vendors, wallet`.
- Larger modules split further: `wallet/` has `ledger.service.ts` + `balance.service.ts` and per-table repos; `transactions/` has **no repo** and many services (`lifecycle, settlement, reversal, refund, topup, reconciliation, nip-out`, …); `rules/` has `engine.ts` + `evaluators/` + `replay/`; `notifications/` has `providers/` + `templates/`.
- **Dependency-injection convention:** repos and services take the `db` handle (or an open transaction) as their **first argument** (`tx as DbOrTx` cast). This is what makes services composable inside a single DB transaction — preserve it.

## Money & the ledger (the core invariant)

All money is **`bigint` kobo** (1 naira = 100 kobo). Branded `Kobo` type and conversion helpers live in `apps/backend/src/lib/kobo.ts` (`fromNairaString` rejects negatives / >2 decimals, `toNairaString`, `formatNaira`). **Never introduce floats into monetary math.**

Double-entry is enforced in **two layers** — respect both:
1. **Application:** `modules/wallet/ledger.service.ts` → `ledgerService.writeDoubleEntry(db, txnId, legs)` requires ≥2 legs and throws unless `sum(debit) === sum(credit)` (bigint), inserting all postings in one transaction.
2. **Database:** `postings` has CHECK constraints (`debit>=0`, `credit>=0`, exactly one side non-zero) and **append-only immutability triggers** (`0005_postings_immutable.sql`). `audit_log` is likewise immutable (`0007_audit_immutable.sql`). Corrections are made with **reversing entries, never UPDATE/DELETE.**

Schema lives in `apps/backend/src/db/schema/*` (key tables: `master_wallets`, `sub_wallets`, `ledger_accounts`, `transactions`, `postings`, plus `auth`, `identity`, `bumps`, `rules`, `notifications`, `idempotency`, `audit`). Migrations in `src/db/migrations/` (drizzle-kit, `out` configured in `drizzle.config.ts`).

## Anchor (Nigerian BaaS) & idempotency

Integration code is `apps/backend/src/integrations/anchor/`. There is **no mock/sandbox code path** — the placeholder provisioner was deleted; sandbox vs production is purely environmental (`ANCHOR_API_BASE_URL` defaults to `https://api.sandbox.getanchor.co`, `ANCHOR_API_KEY`). `routes/households.ts` POST `/households` does **real** `createCustomer` + `provisionVirtualAccount` in a DB transaction (re-entrant: skips `createCustomer` if `user.anchorCustomerId` exists), mapping `AnchorHttpError` → HTTP 503 `anchor_unavailable`.

`AnchorAdapter` (`adapter.ts`) wraps all mutations in `execIdempotent` (caches responses in `idempotency_keys` keyed by `key`+`scope`), a circuit breaker, and exponential-backoff retry (5xx/network only).

**Idempotency is layered** — when touching money flows, know all three: (a) outbound Anchor calls cached by scope+key; (b) `transactions.idempotency_key` is UNIQUE; (c) inbound webhooks dedupe on event id via `audit_log` before dispatch.

**Webhook → ledger flow** (`routes/webhooks.ts`, signature verified with `ANCHOR_WEBHOOK_SECRET`): `transfer.completed`→`settlementService.finalise`; `transfer.failed`→`reversalService.reverse`; `virtual_account.credited`→`topupService.handle` (key `topup:<nibssSessionId>`); `kyc.approved`→bump `kycTier`. Webhooks **always return 200** (errors logged, not surfaced, to stop Anchor retries) but audit-log the event *before* dispatching.

## Auth & pairing

Roles are `principal` and `agent` (JWT `actor`, checked in `middleware/jwt-auth.ts`; many household/wallet routes are principal-only). Login is **phone OTP** via Termii (`auth/otp.service.ts`); `DEV_OTP_BYPASS_CODE` (6 digits) bypasses Termii in dev. HS256 JWT: short access token (`JWT_ACCESS_TTL_SECONDS`, 5 min) + long refresh (`JWT_REFRESH_TTL_SECONDS`, 30 days).

A principal owns a household; to add an agent the principal issues a **pairing code** (`auth/pairing.service.ts` `issue`, TTL `PAIRING_TOKEN_TTL_SECONDS` = 24h) which the agent **consumes** in a transaction (mark token consumed + upsert agent as active `household_member`).

**Rate limiting** (`middleware/rate-limit.ts`) guards the abuse-prone auth surface: an in-memory, per-instance fixed-window limiter wired in `server.ts` (`attachRateLimiters`) onto `/auth/otp/request` (per-phone + per-IP), `/auth/otp/verify`, `/auth/refresh`, and `/pairing*`. The factory takes explicit numeric config (env `RATE_LIMIT_*`, gate-able with `RATE_LIMIT_ENABLED=false`); it stays **enabled in tests** with `resetRateLimitStore()` called inside `truncateAll()`. On breach: 429 + `Retry-After` + `{ error: 'rate_limited' }`. The store is intentionally pluggable for a future Redis backend.

**Route input validation:** validate every mutating route through `lib/validate.ts` (`parseBody`/`parseQuery`/`parseParams`, each returning a 400 `Response` on failure) — never raw `c.req.json()` (it 500s on non-JSON). Validate path/query UUIDs with `z.string().uuid()` so malformed ids return 400, not a Postgres 500.

**Money-movement authorization (critical):** `jwtAuth` only authenticates — it does **not** authorize resource ownership. Every route that touches a wallet/txn/bump/sub-wallet must authorize the actor against the resource via `modules/wallet/wallet-access.service` (`assertWalletAccess` for master/sub targets, `assertSubWalletAccess` for sub-wallet-scoped reads). Authorization is by **user identity vs. ownership, never the JWT `role` claim** (so it holds even against a forged role): sub-wallet spend → owning agent only; `subWalletId: null` direct spend → household principal only (decisions #7, #17). These checks live in the **service layer** (`txnIntentService.create`, `lifecycleService.evaluate`, `nipOutService.send` all take `actorUserId`) so no caller can bypass them. They throw `ForbiddenError` (`lib/errors.ts`) → mapped to **403** by `middleware/error-handler.ts` (no Sentry noise). `/auth/refresh` derives `role` from the user record, never the request body.

## Cron

`node-cron` worker, separate from the web process. Jobs in `apps/backend/src/cron/jobs/`: `recon-sweep` (every 5 min → `reconciliationService.sweep`) and `bump-ttl-sweep` (every minute → `bumpWorkflowService.sweepExpired`). Entrypoint `bin/cron.ts`. On Fly this is its own always-on process group (`node dist/cron.js`), distinct from the health-checked `app` web process.

## Testing conventions

`apps/backend/vitest.config.ts`: `pool: forks` + `singleFork: true` (serialized — all tests share one process to avoid DB connection/lock contention), `testTimeout`/`hookTimeout` both 30s, `include: tests/**/*.test.ts`. Route tests call `app.request()` against the real Hono app.

Helpers (`apps/backend/tests/helpers/`): `truncateAll()` in `test-db.ts` clears tables via `DELETE` inside a tx with `SET LOCAL session_replication_role = replica` (deliberately not `TRUNCATE`, to avoid lock deadlocks with fire-and-forget notification writes) — call it in `beforeEach`. `factories.ts` builds typed fixtures (phones, BVN/NIN, kobo, idempotency keys); `bearer.ts` mints auth headers. Property tests use `fast-check`.

The live Anchor E2E suite (`tests/sandbox/anchor-e2e.test.ts`, `pnpm test:sandbox`) is `skipIf(!ANCHOR_API_KEY)` and hits a running backend at `BACKEND_URL` (default `localhost:3000`).

**Coverage gate:** `pnpm --filter @amana/backend test:coverage` (v8 provider, `include: src/**/*.ts`) enforces thresholds in `vitest.config.ts` (lines/statements 92, functions 90, branches 80 — set just below the measured ~94/92/81). CI runs it as a dedicated step; keep it backend-only (never repo-wide, or the mobile packages drag it under).

**Mobile/UI component tests** run under Vitest with `react-test-renderer` in `environment: 'node'`. `packages/ui/test/` holds the shared harness: `react-native.mock.tsx` (+ `safe-area`/`svg` mocks) aliased in each package's `vitest.config.ts`, plus a `render()` helper and `byRole`/`byLabel`/`textContent` queries. **Gotcha:** alias `react` (and `react/jsx-*`) to the **hoisted root** `../../node_modules/react` so the component and `react-test-renderer` share one React instance (pnpm otherwise splits it → null hooks dispatcher); inline hook-using deps like `react-hook-form` so they resolve the same copy. Apps (`apps/{principal,agent}`) reuse the ui mocks and add a `@react-navigation/native` mock; screen tests `vi.mock` the api-client + Zustand stores and live in `src/screens/*.test.tsx`. Components and screens carry `accessibilityRole`/`accessibilityLabel`/`accessibilityState`; tests assert them.

## Environment

Canonical schema: **`apps/backend/src/env.ts`** (Zod, parsed at import, throws a formatted list on failure). Most vars have dev-safe defaults. Production essentials with **no safe default**, all **enforced at boot** (`loadEnv` throws in `NODE_ENV=production` if missing): `JWT_SECRET` (≥32 chars), `FIELD_ENCRYPTION_KEY` (64 hex), `ANCHOR_API_KEY`, `ANCHOR_WEBHOOK_SECRET`, `TERMII_API_KEY` (dev fallbacks/optionality apply only outside production); `DEV_OTP_BYPASS_CODE` is rejected in production. Before go-live, register the Termii sender ID and flip `ANCHOR_API_BASE_URL` off the sandbox default — see `docs/runbook/go-live-checklist.md`. AWS region for S3 media is `af-south-1` (`MEDIA_BUCKET=amana-media-af-south-1`).

## Shared packages

- **`@amana/types`** — pure domain TypeScript types (built to `dist`).
- **`@amana/api-client`** — typed HTTP SDK (`AmanaApiClient`) used by both Expo apps; bearer auth, **single-flight token refresh on 401**, pluggable `TokenStore`, `ApiError` (built to `dist`).
- **`@amana/ui`** — React Native component library + theming (`ThemeProvider`, typography, `Button`, `BalanceCard`, `TransactionRow`, brand marks). **Ships as raw source** (no build step) — Metro transpiles it.
- **`@amana/validation`** — shared Zod schemas (currently thin; built to `dist`).

Both Expo apps share code only through these workspace packages (`workspace:*`), use **Zustand** for state and **expo-secure-store** for token persistence.

## Deployment

Fly.io app `amana-api`, region `jnb`. Two process groups: `app` (web, `/health` checked, auto-stop/start) and `cron` (always-on). Migrations run as the Fly `release_command`. Sentry + Pino are wired. `fly.toml` / `fly.staging.toml` at root.

## Docs

`docs/adr/` (decisions), `docs/superpowers/plans/` (sub-plan implementation docs), `docs/superpowers/specs/` (design spec), `docs/runbook/` (`local-dev.md`, `anchor-sandbox.md`, `funds-model.md` — the limits-only sub-wallet funds model & money flows, `go-live-checklist.md` — pre-production readiness), `docs/brainstorm/locked-decisions.md`.
