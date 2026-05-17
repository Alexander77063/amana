# Cron Machine Design

**Date:** 2026-05-17
**Status:** Approved

## Goal

Deploy the existing `bin/cron.ts` entry point as a continuously-running Fly process alongside the web server, so bump expiry and reconciliation sweeps actually execute in production and staging.

## Scope

**In scope:**
- `bumpTtlSweepJob` — expires pending bumps past their `expiresAt` (runs every minute, already implemented)
- `reconSweepJob` — catches missed Anchor webhooks, reconciles in-flight transactions (runs every 5 minutes, already implemented)
- Dockerfile: bundle `bin/cron.ts` → `dist/cron.js`
- `fly.toml` + `fly.staging.toml`: add `[processes]`, scope `[http_service]` to `app`, add `[[vm]]` for `cron`

**Out of scope (deferred until real user signal):**
- Notification digest job — `defer_digest` preference infrastructure exists but no job; add after beta when cadence is known

---

## Architecture

One Fly app (`amana-api`), two process types sharing the same Docker image and all secrets:

| | `app` process | `cron` process |
|---|---|---|
| Command | `node dist/index.js` | `node dist/cron.js` |
| Machines | 1 | 1 (new) |
| HTTP traffic | yes (`[http_service]`) | no |
| Auto-stop | yes | no (`min_machines_running = 1`) |
| VM | `shared-cpu-1x` / 256 MB | `shared-cpu-1x` / 256 MB |

The cron machine runs continuously. `node-cron` manages its own internal schedule — no external trigger needed. The machine never stops (`min_machines_running = 1` on the `cron` process). Staging gets an identical cron machine.

### Jobs

| Job | Schedule | Logic |
|---|---|---|
| `bump-ttl-sweep` | `* * * * *` | `bumpWorkflowService.sweepExpired(db, now)` — queries `bump_requests` where `status = 'pending' AND expires_at < now`, transitions each to `expired` |
| `recon-sweep` | `*/5 * * * *` | `reconciliationService.sweep(db, adapter, now)` — catches missed Anchor webhooks, reconciles in-flight transactions |

Both jobs already exist at `apps/backend/src/cron/jobs/`. The entry point `apps/backend/bin/cron.ts` already registers and starts them. No new job logic is needed.

---

## Changes

### 1. `apps/backend/Dockerfile`

Add a second esbuild invocation after the existing `index.ts` bundle, and extend the copy step:

```dockerfile
# Bundle cron entry point (same external flags as index.ts)
RUN apps/backend/node_modules/.bin/esbuild apps/backend/bin/cron.ts \
    --bundle --platform=node --target=node20 \
    --outfile=apps/backend/dist/cron.js \
    --format=esm \
    "--external:@aws-sdk/*" \
    "--external:@hono/*" \
    "--external:@sentry/*" \
    "--external:argon2" \
    "--external:drizzle-orm" \
    "--external:expo-server-sdk" \
    "--external:hono" \
    "--external:jose" \
    "--external:node-cron" \
    "--external:pino" \
    "--external:postgres" \
    "--external:zod"

# Copy both bundles into standalone
RUN mkdir -p /standalone/dist \
    && cp apps/backend/dist/index.js /standalone/dist/index.js \
    && cp apps/backend/dist/cron.js /standalone/dist/cron.js
```

The runtime stage `CMD` stays as `node dist/index.js` — Fly overrides it per process type via `[processes]`.

### 2. `fly.toml`

Full file after changes:

```toml
app = 'amana-api'
primary_region = 'jnb'

[build]
  dockerfile = 'apps/backend/Dockerfile'

[processes]
  app = 'node dist/index.js'
  cron = 'node dist/cron.js'

[env]
  NODE_ENV = 'production'
  PORT = '3000'
  API_BASE_URL = 'https://api.amana-ng.com'
  ANCHOR_API_BASE_URL = 'https://api.sandbox.getanchor.co'

[deploy]
  release_command = 'node bin/migrate.mjs'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 1
  processes = ['app']

  [[http_service.checks]]
    grace_period = '10s'
    interval = '15s'
    method = 'GET'
    path = '/health'
    timeout = '3s'

[[vm]]
  processes = ['app']
  size = 'shared-cpu-1x'
  memory = '256mb'

[[vm]]
  processes = ['cron']
  size = 'shared-cpu-1x'
  memory = '256mb'
```

### 3. `fly.staging.toml`

Same `[processes]`, `processes = ['app']` on `[http_service]`, and two `[[vm]]` blocks — only `app` name and `API_BASE_URL` differ from prod.

### 4. CI (`ci.yml`)

No changes. `flyctl deploy` deploys all process types in one shot.

---

## Verification

After deploy, confirm the cron machine is running:

```bash
fly machines list --app amana-api
```

Expected: two machines — one `app` process, one `cron` process, both `started`.

Confirm bump expiry is working: create a test bump with a short TTL, wait for it to expire, verify `status = 'expired'` in the DB.
