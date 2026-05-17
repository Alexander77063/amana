# Cron Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing `bin/cron.ts` bump-expiry + recon-sweep jobs as a continuously-running Fly process alongside the web server.

**Architecture:** Add a `cron` process type to `fly.toml` and `fly.staging.toml` using Fly's `[[processes]]` feature. Bundle `bin/cron.ts` → `dist/cron.js` in the Dockerfile using the same esbuild flags as `index.ts`. No application code changes — all job logic already exists.

**Tech Stack:** Fly.io `[[processes]]`, esbuild, node-cron (already in use), existing `bumpTtlSweepJob` + `reconSweepJob`.

**Spec:** `docs/superpowers/specs/2026-05-17-cron-machine-design.md`

---

## File structure produced by this plan

**Modified:**
- `apps/backend/Dockerfile` — add second esbuild invocation + copy `cron.js` to `/standalone/dist/`
- `fly.toml` — add `[processes]`, scope `[http_service]` to `app`, split `[[vm]]` into two process-scoped blocks
- `fly.staging.toml` — same structural changes, staging-specific values unchanged

---

### Task 1 — Bundle `bin/cron.ts` in Dockerfile

**Files:**
- Modify: `apps/backend/Dockerfile`

The current Dockerfile has two relevant sections at the bottom of Stage 1:

```dockerfile
# Bundle backend + workspace packages; keep npm packages external (avoids dynamic-require issues)
RUN apps/backend/node_modules/.bin/esbuild apps/backend/src/index.ts \
    --bundle --platform=node --target=node20 \
    --outfile=apps/backend/dist/index.js \
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
RUN pnpm --filter @amana/backend deploy --prod --legacy /standalone
# dist/ is gitignored so pnpm deploy omits it; copy just the bundle
RUN mkdir -p /standalone/dist && cp apps/backend/dist/index.js /standalone/dist/index.js
```

- [ ] **Step 1: Replace those two sections with the updated version**

Replace the entire block from `RUN apps/backend/node_modules/.bin/esbuild apps/backend/src/index.ts` through `RUN mkdir -p /standalone/dist && cp ...` with:

```dockerfile
# Bundle backend + workspace packages; keep npm packages external (avoids dynamic-require issues)
RUN apps/backend/node_modules/.bin/esbuild apps/backend/src/index.ts \
    --bundle --platform=node --target=node20 \
    --outfile=apps/backend/dist/index.js \
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
RUN pnpm --filter @amana/backend deploy --prod --legacy /standalone
# dist/ is gitignored so pnpm deploy omits it; copy both bundles
RUN mkdir -p /standalone/dist \
    && cp apps/backend/dist/index.js /standalone/dist/index.js \
    && cp apps/backend/dist/cron.js /standalone/dist/cron.js
```

The complete Dockerfile after the change:

```dockerfile
# Stage 1 — build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/backend/ apps/backend/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @amana/types build
RUN pnpm --filter @amana/validation build
RUN pnpm --filter @amana/backend build
# Bundle backend + workspace packages; keep npm packages external (avoids dynamic-require issues)
RUN apps/backend/node_modules/.bin/esbuild apps/backend/src/index.ts \
    --bundle --platform=node --target=node20 \
    --outfile=apps/backend/dist/index.js \
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
RUN pnpm --filter @amana/backend deploy --prod --legacy /standalone
# dist/ is gitignored so pnpm deploy omits it; copy both bundles
RUN mkdir -p /standalone/dist \
    && cp apps/backend/dist/index.js /standalone/dist/index.js \
    && cp apps/backend/dist/cron.js /standalone/dist/cron.js

# Stage 2 — runtime
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /standalone .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Verify the file reads back correctly**

Read `apps/backend/Dockerfile` and confirm:
- Two `esbuild` `RUN` commands exist (one for `index.ts`, one for `cron.ts`)
- The final `RUN mkdir` line copies both `index.js` and `cron.js`
- Stage 2 `CMD` is still `["node", "dist/index.js"]` (unchanged — Fly overrides per process)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/Dockerfile
git commit -m "feat(deploy): bundle bin/cron.ts → dist/cron.js in Dockerfile"
```

---

### Task 2 — Update `fly.toml` with processes

**Files:**
- Modify: `fly.toml`

Current `fly.toml`:

```toml
app = 'amana-api'
primary_region = 'jnb'

[build]
  dockerfile = 'apps/backend/Dockerfile'

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

  [[http_service.checks]]
    grace_period = '10s'
    interval = '15s'
    method = 'GET'
    path = '/health'
    timeout = '3s'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '256mb'
```

- [ ] **Step 1: Replace `fly.toml` with the updated version**

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

Three changes from the original:
1. New `[processes]` block after `[build]`
2. `processes = ['app']` added to `[http_service]`
3. `[[vm]]` split into two process-scoped blocks

- [ ] **Step 2: Verify**

Read `fly.toml` and confirm all three changes are present. The `[processes]` block must appear before `[env]`.

- [ ] **Step 3: Commit**

```bash
git add fly.toml
git commit -m "feat(deploy): fly.toml — add cron process type, scope http_service to app"
```

---

### Task 3 — Update `fly.staging.toml` with processes

**Files:**
- Modify: `fly.staging.toml`

Current `fly.staging.toml`:

```toml
app = 'amana-api-staging'
primary_region = 'jnb'

[build]
  dockerfile = 'apps/backend/Dockerfile'

[env]
  NODE_ENV = 'production'
  PORT = '3000'
  API_BASE_URL = 'https://api-staging.amana-ng.com'
  ANCHOR_API_BASE_URL = 'https://api.sandbox.getanchor.co'

[deploy]
  release_command = 'node bin/migrate.mjs'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    grace_period = '10s'
    interval = '15s'
    method = 'GET'
    path = '/health'
    timeout = '3s'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '256mb'
```

- [ ] **Step 1: Replace `fly.staging.toml` with the updated version**

```toml
app = 'amana-api-staging'
primary_region = 'jnb'

[build]
  dockerfile = 'apps/backend/Dockerfile'

[processes]
  app = 'node dist/index.js'
  cron = 'node dist/cron.js'

[env]
  NODE_ENV = 'production'
  PORT = '3000'
  API_BASE_URL = 'https://api-staging.amana-ng.com'
  ANCHOR_API_BASE_URL = 'https://api.sandbox.getanchor.co'

[deploy]
  release_command = 'node bin/migrate.mjs'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0
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

Identical structure to `fly.toml` except: `app = 'amana-api-staging'`, `API_BASE_URL = 'https://api-staging.amana-ng.com'`, `min_machines_running = 0` on `[http_service]` (staging saves cost by allowing the app machine to stop).

- [ ] **Step 2: Verify**

Read `fly.staging.toml` and confirm:
- `[processes]` block present after `[build]`
- `processes = ['app']` on `[http_service]`
- `min_machines_running = 0` on `[http_service]` (staging — different from prod's `1`)
- Two `[[vm]]` blocks with `processes = ['app']` and `processes = ['cron']`

- [ ] **Step 3: Commit**

```bash
git add fly.staging.toml
git commit -m "feat(deploy): fly.staging.toml — add cron process type, scope http_service to app"
```

---

### Task 4 — Push + verify

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

CI runs `build-and-test` → `deploy`. The Docker build now bundles both `index.ts` and `cron.ts`. Fly deploys two machines: one `app`, one `cron`.

Monitor the run:

```bash
gh run watch --repo Alexander77063/amana
```

Expected: `build-and-test: success`, `deploy: success`, `deploy-staging: skipped`.

- [ ] **Step 2: Verify both machines are running**

```bash
fly machines list --app amana-api
```

Expected output: two machines, both with status `started`:

```
ID            PROCESS  VERSION  REGION  STATE    ...
abc123        app      N        jnb     started
def456        cron     N        jnb     started
```

If the cron machine shows `stopped`, start it:

```bash
fly machines start <cron-machine-id> --app amana-api
```

- [ ] **Step 3: Check cron machine logs**

```bash
fly logs --app amana-api --machine <cron-machine-id>
```

Expected within 1 minute of startup: log lines like:

```
{"job":"bump-ttl-sweep","durationMs":...,"msg":"cron job completed"}
{"job":"recon-sweep","durationMs":...,"msg":"cron job completed"}
```

If you see startup errors instead, check that `dist/cron.js` exists in the image:

```bash
fly ssh console --app amana-api --machine <cron-machine-id> -- ls dist/
```

Expected: `index.js  cron.js`

- [ ] **Step 4: Verify health endpoint still works**

```bash
curl -s https://api.amana-ng.com/health
```

Expected: `{"status":"ok","version":"0.0.0"}`

- [ ] **Step 5: Tag**

```bash
git tag v0.0-cron-machine
git push origin v0.0-cron-machine
```

---

## Plan-complete criteria

- `fly machines list --app amana-api` shows two machines: one `app`, one `cron`, both `started`
- Cron machine logs show `bump-ttl-sweep` firing every minute and `recon-sweep` every 5 minutes
- `GET https://api.amana-ng.com/health` still returns `{"status":"ok"}`
- Any `pending` bump past its `expires_at` transitions to `expired` within 1 minute
