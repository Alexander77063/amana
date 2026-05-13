# Amana — Implementation Plan

**Version:** 1.0 | **Date:** 2026-05-13
**Status:** MVP implemented. Deployment in progress.
**Audience:** Technical co-founder, senior engineer, technical investor

> **Executive summary:** The Amana MVP was built from scratch in a single focused sprint across 8 sub-plans. The stack is a React Native (Expo) monorepo with a Hono/Node.js backend and Postgres (Supabase). Every feature was built test-first (TDD with vitest). The backend deploys to Fly.io (Johannesburg) with zero-downtime migration via Fly `release_command`. Two mobile apps — Principal and Agent — share types and an API client via a pnpm monorepo.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Monorepo (pnpm)                       │
│                                                          │
│  apps/principal    apps/agent    apps/backend            │
│  (Expo/RN)         (Expo/RN)     (Hono + Node.js)        │
│       │                 │              │                  │
│       └────────┬────────┘              │                  │
│                │                       │                  │
│     packages/api-client ──────────────►│                  │
│     packages/types      ──────────────►│                  │
│                                        │                  │
│                              Supabase Postgres 15         │
│                              (PostGIS enabled)            │
└──────────────────────────────────────────────────────────┘
```

### 1.1 Request path

```
Mobile app
  → packages/api-client (typed fetch wrapper)
    → Hono server (apps/backend)
      → Drizzle ORM
        → Supabase Postgres

Async:
  Anchor webhook → POST /webhooks/anchor
    → settlement / failure handling
      → Expo Push → device
```

### 1.2 Why this stack

| Choice | Rationale |
|---|---|
| **Hono** | Fastest Node.js HTTP framework; edge-ready; typed middleware; tiny bundle for Docker |
| **Drizzle ORM** | Type-safe SQL without query-builder magic; migration files are plain SQL (reviewable); no runtime overhead |
| **Postgres (Supabase)** | PostGIS for geolocation; managed ops; free tier for early-stage; direct connection string for our backend |
| **Expo / React Native** | Single codebase for iOS + Android; Expo managed workflow; Expo Push handles FCM + APNS routing |
| **pnpm monorepo** | Fast installs; strict hoisting; `pnpm deploy --prod` produces a self-contained backend bundle for Docker |
| **Fly.io (JNB)** | Johannesburg region; closest Fly region to Nigeria; Machines v2; `release_command` for zero-downtime migrations |
| **vitest** | Fastest TypeScript test runner; no transpile step; ESM-native |

---

## 2. Monorepo Structure

```
amana/
├── apps/
│   ├── backend/          # Hono API server
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema/       # Drizzle table definitions
│   │   │   │   └── migrations/   # Plain SQL migration files (0000–0019)
│   │   │   ├── modules/
│   │   │   │   ├── anomaly/      # Scoring engine
│   │   │   │   ├── bumps/        # Bump workflow service
│   │   │   │   ├── notifications/# Templates + dispatch
│   │   │   │   └── transactions/ # Lifecycle + detail + reversal
│   │   │   ├── routes/           # Hono route handlers (one file per domain)
│   │   │   └── lib/              # mask-account, jwt, etc.
│   │   ├── tests/                # vitest integration tests (hit real DB)
│   │   ├── bin/
│   │   │   ├── migrate.js        # Fly release_command migration runner
│   │   │   └── cron.ts           # Bump expiry cron (v1.1 Fly machine)
│   │   └── Dockerfile
│   ├── principal/        # Principal React Native app (Expo)
│   │   └── src/
│   │       ├── nav/      # React Navigation stacks
│   │       ├── screens/  # One file per screen
│   │       └── lib/      # push.ts, deep-link.ts, api.ts
│   └── agent/            # Agent React Native app (Expo)
│       └── src/
│           ├── nav/
│           ├── screens/
│           └── lib/
├── packages/
│   ├── types/            # Shared TypeScript types (TransactionDetail, NotificationDeepLink, etc.)
│   └── api-client/       # Typed fetch client (AmanaApiClient + domain APIs)
├── fly.toml              # Fly.io config
├── .dockerignore
└── .github/workflows/ci.yml   # build-and-test + deploy jobs
```

---

## 3. Development Phases

### Phase 0 — Bootstrap (Sub-plan 0)
- pnpm monorepo scaffold
- Backend: Hono server, Drizzle config, Postgres connection
- CI: GitHub Actions with postgres service container
- Biome lint + typecheck pipeline

### Phase 1 — Identity & Ledger (Sub-plan 2)
- Users, households, household_members schema
- Master wallets, sub-wallets, ledger accounts
- Double-entry postings (append-only, immutable trigger)
- Audit log (append-only, immutable trigger)
- Migrations 0001–0007

### Phase 2 — Rules, Bumps, Anomaly (Sub-plan 3)
- Rule engine: limit, category, time_window, allowlist, anomaly_threshold
- Rule set versioning (superseded pattern)
- Bump request workflow + one-shot token
- Anomaly scoring: hour-of-day, amount-vs-median, day-of-week, vendor-frequency
- TDD throughout: rule eval tests, bump workflow tests, anomaly scoring tests

### Phase 3 — Vendor Capture & NIP Out (Sub-plan 4)
- NQR decode endpoint
- Name enquiry (NIP account resolution via Anchor)
- Phone-number → account lookup
- Recents table + API
- NFC sticker stub
- Anchor webhook handler (settlement, failure, refund)
- Full transaction lifecycle: draft → rule_eval → in_flight → settled/failed

### Phase 4 — Notifications & Cron (Sub-plan 5)
- Notification tables + preferences
- Device token registration (Expo push)
- Notification dispatch: push + in-app
- Templates for all 6 notification kinds
- Quiet hours + sub-wallet snooze
- Bump expiry cron job

### Phase 5 — Auth Backend (Sub-plan 6a)
- OTP flow (SMS via Anchor)
- JWT access + refresh token issuance
- KYC tier validation
- Pairing token + deep-link generation

### Phase 6 — Principal Mobile App (Sub-plans 6b1–6b6)
- 6b1: Auth stack (phone → OTP → register → household)
- 6b2: Household + sub-wallet screens
- 6b3: Notifications inbox + push handling
- 6b4: Notification preferences screen
- 6b5: Snooze + quiet hours
- 6b6: Transaction detail screen + deep-link routing

### Phase 7 — Agent Mobile App (Sub-plan 7)
- Full agent app: auth → pairing → payment flow → history → settings
- NFC pairing (Android), QR pairing, SMS deep-link
- Full vendor capture stack (NQR, phone, account)
- Photo attach + GPS + note at confirm time
- Bump request + wait screen + resume
- TransactionDetailScreen (agent view)

### Phase 8 — Deployment (Backend deployment plan)
- Multi-stage Dockerfile (pnpm deploy → node:20-alpine)
- `apps/backend/bin/migrate.js` (Fly release_command)
- `fly.toml` (JNB region, health check, 1 min machine)
- GitHub Actions `deploy` job (gates on build-and-test, remote-only build)
- Supabase project provisioned
- Fly app `amana-api` created, secrets set

---

## 4. Testing Approach

### 4.1 Strategy

Every feature was built TDD:
1. Write failing tests
2. Implement until tests pass
3. Refactor under green

### 4.2 Backend tests

**Location:** `apps/backend/tests/`

**Type:** Integration tests — all tests hit a real Postgres database (Docker Compose `postgres` service in dev, GitHub Actions service container in CI).

No mocks. The test DB is seeded per-test via helper factories. Tests run in isolation via per-test transactions that roll back after each test.

```bash
# Run all backend tests
pnpm --filter @amana/backend test

# Run specific test file
pnpm --filter @amana/backend test tests/routes/transactions.test.ts
```

### 4.3 Package tests

`packages/api-client` and `packages/types` have unit tests for type contracts and client method signatures.

### 4.4 Mobile tests

`apps/principal/src/lib/push.test.ts` — unit tests for `deepLinkFor` (pure function, no React Native deps).

`apps/agent/src/lib/push.test.ts` — same for agent.

### 4.5 CI pipeline

```yaml
build-and-test:
  - pnpm install
  - biome check (lint + format)
  - pnpm typecheck (all packages)
  - pnpm build (types + api-client)
  - drizzle migrate (test DB)
  - pnpm test (all packages)

deploy: (main branch only, after build-and-test)
  - flyctl deploy --remote-only
```

---

## 5. Deployment Architecture

```
GitHub (main branch)
  └── GitHub Actions: build-and-test → deploy
        └── flyctl deploy --remote-only
              └── Fly remote builder (Depot)
                    └── Multi-stage Docker build
                          ├── builder: pnpm install + tsc
                          └── runtime: node:20-alpine + pnpm deploy --prod

Fly.io (JNB region)
  └── release_command: node bin/migrate.js
        └── Drizzle migrator → Supabase Postgres
  └── [migrations pass] → route traffic to new version
  └── [migrations fail] → keep old version (zero-downtime)

Supabase Postgres 15 (eu-west-2 / London)
  └── Direct connection: port 5432, sslmode=require
  └── PostGIS extension enabled
```

### 5.1 Environment variables (Fly secrets)

| Secret | Description |
|---|---|
| `DATABASE_URL` | Supabase direct connection URI |
| `JWT_SECRET` | 32-byte hex random |
| `ANCHOR_API_KEY` | Anchor Bearer token (pending KYB) |
| `ANCHOR_WEBHOOK_SECRET` | HMAC signing secret (pending webhook config) |

### 5.2 Health check

`GET /health` returns `{"status":"ok"}`. Fly checks every 15 seconds with a 3-second timeout and 10-second grace period.

---

## 6. Known Limitations & Next Phase

### 6.1 Known MVP limitations

| Limitation | Severity | Plan |
|---|---|---|
| Anchor KYB pending — NIP transfers non-functional until approved | High | Apply now; typically 1–2 weeks |
| No staging environment | Medium | Add before beta invite |
| Cron job not deployed (bump expiry, notification digest) | Low | Separate Fly machine in v1.1 |
| iOS NFC pairing not available | Low | Architectural constraint; QR covers iOS |
| Wallet balance computed from ledger scan (no cache) | Low | Materialised balance view in v1.1 when volume justifies |
| No custom domain configured | Low | DNS CNAME + `fly certs add api.amana-ng.com` |

### 6.2 v1.1 roadmap

1. **Custom domain** — `api.amana-ng.com` CNAME + Fly TLS cert
2. **Staging environment** — separate Fly app + Supabase project
3. **Cron machine** — bump expiry sweep + notification digest
4. **Amana Receive NFC sticker** — complete vendor capture path A
5. **Card top-up** — Sudo integration for master wallet inbound
6. **Admin dashboard** — internal ops tooling
7. **Multi-principal households** — schema already supports it
8. **Reconciliation cron** — catch missed Anchor webhooks
