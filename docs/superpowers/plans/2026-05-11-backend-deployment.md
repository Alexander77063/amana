# Backend Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Amana backend (Hono + Node.js + Drizzle ORM) to Fly.io (Johannesburg region) with Supabase Postgres, zero-downtime migrations via Fly release_command, and automatic CD on merge to main via GitHub Actions.

**Architecture:** Multi-stage Docker build using `pnpm deploy --prod` to produce a self-contained runtime image. `fly.toml` at repo root points to `apps/backend/Dockerfile`. Fly's `release_command` runs `node bin/migrate.js` (plain ESM, no compile step) before traffic switches to the new version. The GitHub Actions `deploy` job gates on the existing `build-and-test` job and calls `flyctl deploy --remote-only` so no Docker daemon is needed in CI.

**Tech Stack:** Fly.io Machines v2, Supabase Postgres 15 (PostGIS enabled), `pnpm deploy`, drizzle-orm migrator, `superfly/flyctl-actions`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-11-backend-deployment-design.md`

---

## File map

**Created:**
- `apps/backend/bin/migrate.js` — plain ESM migration runner, called by Fly `release_command`
- `apps/backend/Dockerfile` — multi-stage build: builder (compile) → runtime (node:20-alpine)
- `.dockerignore` — repo root; excludes node_modules, dist, .env, tests from build context
- `fly.toml` — repo root; Fly app config: region jnb, health check, release_command, vm sizing

**Modified:**
- `.github/workflows/ci.yml` — append `deploy` job after `build-and-test`

---

## Task 1 — Migration script (`apps/backend/bin/migrate.js`)

**Files:**
- Create: `apps/backend/bin/migrate.js`

The existing `bin/cron.ts` shows you're already in `apps/backend/bin/`. This script uses `drizzle-orm/postgres-js/migrator` (a production dependency — not `drizzle-kit` which is dev-only). It runs migrations from `src/db/migrations/` relative to the working directory, which in the Docker container is `/app` — matching where `pnpm deploy` places the SQL files.

- [ ] **Step 1: Create `apps/backend/bin/migrate.js`**

```js
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
const db = drizzle(sql);
await migrate(db, { migrationsFolder: 'src/db/migrations' });
await sql.end();
```

- [ ] **Step 2: Verify the file parses cleanly**

The script has `ssl: 'require'` hardcoded, so it can't connect to local Postgres (no SSL). Syntax verification is enough here — the Docker smoke-test in Task 2 Step 4 is the real functional test.

From the repo root:

```bash
node --input-type=module --eval "
  import { readFileSync } from 'fs';
  readFileSync('apps/backend/bin/migrate.js', 'utf8');
  console.log('file readable');
"
```

Expected: prints `file readable` and exits 0. The real end-to-end test runs in Task 2 (Docker image) and Task 5 (first Fly deploy against Supabase).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/bin/migrate.js
git commit -m "feat(deploy): migration runner for Fly release_command"
```

---

## Task 2 — Dockerfile + .dockerignore

**Files:**
- Create: `apps/backend/Dockerfile`
- Create: `.dockerignore` (repo root)

The build context root is the repo root (where `fly.toml` lives). `pnpm deploy --prod` resolves all `workspace:*` packages (`@amana/types`, `@amana/validation`) and copies the backend's compiled output plus production node_modules into `/standalone`. The runtime stage copies only that directory.

- [ ] **Step 1: Create `apps/backend/Dockerfile`**

```dockerfile
# Stage 1 — build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/backend/ apps/backend/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @amana/types build
RUN pnpm --filter @amana/validation build
RUN pnpm --filter @amana/backend build
RUN pnpm --filter @amana/backend deploy --prod /standalone

# Stage 2 — runtime
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /standalone .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `.dockerignore` at repo root**

```
**/node_modules
**/dist
**/.env
**/test-corpus
**/tests
**/*.test.ts
.git
```

- [ ] **Step 3: Build the image locally to verify it compiles**

Run from the repo root (not from `apps/backend/`):

```bash
docker build -f apps/backend/Dockerfile -t amana-api:local .
```

Expected: build completes without errors. Final line looks like:
```
=> => naming to docker.io/library/amana-api:local
```

If it fails, common causes:
- `pnpm install` fails: check that `pnpm-lock.yaml` is up to date
- `pnpm --filter @amana/types build` fails: run `pnpm --filter @amana/types typecheck` locally first
- `pnpm deploy` fails: check that `apps/backend/package.json` doesn't have any workspace scripts that reference missing files

- [ ] **Step 4: Smoke-test the built image**

```bash
docker run --rm \
  -e DATABASE_URL=postgres://amana:amana_dev_only@host.docker.internal:5432/amana_dev \
  -e JWT_SECRET=dev-only-secret-do-not-use-in-prod-please-32chars \
  -e NODE_ENV=production \
  -p 3001:3000 \
  amana-api:local
```

In another terminal:

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{"status":"ok"}
```

Then `Ctrl+C` the running container.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/Dockerfile .dockerignore
git commit -m "feat(deploy): Dockerfile (multi-stage pnpm deploy) + .dockerignore"
```

---

## Task 3 — `fly.toml`

**Files:**
- Create: `fly.toml` (repo root)

`primary_region = 'jnb'` is Johannesburg — closest to Nigeria. `min_machines_running = 1` keeps one instance warm at all times (no cold starts — a fintech app must respond immediately). `release_command` runs migrations before traffic switches to the new version; if it exits non-zero, the old version keeps serving.

- [ ] **Step 1: Create `fly.toml` at repo root**

```toml
app = 'amana-api'
primary_region = 'jnb'

[build]
  dockerfile = 'apps/backend/Dockerfile'

[env]
  NODE_ENV = 'production'
  PORT = '3000'
  ANCHOR_API_BASE_URL = 'https://api.sandbox.getanchor.co'

[deploy]
  release_command = 'node bin/migrate.js'

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

- [ ] **Step 2: Verify flyctl can parse the config (requires flyctl installed)**

```bash
fly config validate
```

Expected: `✓ Configuration is valid` (or a warning about the app not existing yet — that's fine).

If flyctl is not installed yet, skip this step and validate during Task 5.

- [ ] **Step 3: Commit**

```bash
git add fly.toml
git commit -m "feat(deploy): fly.toml — jnb region, release_command migrate, min 1 machine"
```

---

## Task 4 — GitHub Actions deploy job

**Files:**
- Modify: `.github/workflows/ci.yml`

The `deploy` job runs only on push to `main` (not on PRs), only after `build-and-test` passes. It uses Fly's remote builder (`--remote-only`) so no Docker daemon is needed on the GitHub-hosted runner. `FLY_API_TOKEN` is a deploy-scoped token (set up in Task 5) stored as a GitHub Actions secret.

- [ ] **Step 1: Append the `deploy` job to `.github/workflows/ci.yml`**

Open `.github/workflows/ci.yml`. After the closing of the `build-and-test` job (after the `run: pnpm test` step), append:

```yaml

  deploy:
    needs: build-and-test
    runs-on: ubuntu-24.04
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v6
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

The full file after editing:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  TURBO_TELEMETRY_DISABLED: 1
  HUSKY: 0

jobs:
  build-and-test:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: amana
          POSTGRES_PASSWORD: amana_dev_only
          POSTGRES_DB: amana_dev
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U amana -d amana_dev"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v6

      - name: Setup pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10.33.2

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: '20.18.0'
          cache: 'pnpm'

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm exec biome check .

      - name: Typecheck
        run: pnpm typecheck

      - name: Build
        run: pnpm build

      - name: Apply migrations
        env:
          DATABASE_URL: postgres://amana:amana_dev_only@localhost:5432/amana_dev
        run: pnpm --filter @amana/backend db:migrate

      - name: Test
        env:
          NODE_ENV: test
          DATABASE_URL: postgres://amana:amana_dev_only@localhost:5432/amana_dev
        run: pnpm test

  deploy:
    needs: build-and-test
    runs-on: ubuntu-24.04
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v6
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(deploy): GitHub Actions deploy job — Fly remote build on main"
```

---

## Task 5 — One-time setup + first deploy

This task is manual steps, not code. Do these once before the automated CD pipeline takes over. Steps 1–3 can be done in any order; steps 4–7 must be sequential.

**Prerequisites:** flyctl installed (`brew install flyctl` on Mac, or `curl -L https://fly.io/install.sh | sh` on Linux/WSL). Logged in (`fly auth login`).

- [ ] **Step 1: Create Supabase project**

  1. Go to supabase.com → New project
  2. Choose region: **eu-west-2 (London)** — closest to Nigeria on the free tier. On a paid plan, `af-south-1` (Cape Town) is available.
  3. Once provisioned, go to: **Project Settings → Database → Connection string → URI**
  4. Copy the **direct connection** URI (port **5432**, NOT the pooler port 6543). It looks like:
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
     ```
  5. Append `?sslmode=require` to the URI:
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require
     ```
  6. Save this string — it becomes `DATABASE_URL`.

- [ ] **Step 2: Create the Fly app**

  From the repo root:

  ```bash
  fly apps create amana-api
  ```

  Expected output:
  ```
  New app created: amana-api
  ```

- [ ] **Step 3: Generate a JWT secret**

  ```bash
  openssl rand -hex 32
  ```

  Copy the output — it becomes `JWT_SECRET`.

- [ ] **Step 4: Set Fly secrets**

  ```bash
  fly secrets set \
    DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres?sslmode=require" \
    JWT_SECRET="YOUR_GENERATED_SECRET" \
    ANCHOR_API_KEY="YOUR_ANCHOR_SANDBOX_KEY" \
    ANCHOR_WEBHOOK_SECRET="YOUR_ANCHOR_WEBHOOK_SECRET"
  ```

  Expected:
  ```
  Secrets are staged for the first deployment
  ```

  To verify secrets are set (values are redacted):
  ```bash
  fly secrets list
  ```

- [ ] **Step 5: Generate a Fly deploy token and add it to GitHub**

  ```bash
  fly tokens create deploy -a amana-api
  ```

  Copy the token. Then:
  1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
  2. Click **New repository secret**
  3. Name: `FLY_API_TOKEN`
  4. Value: paste the token
  5. Save

- [ ] **Step 6: First manual deploy**

  From the repo root:

  ```bash
  fly deploy --remote-only
  ```

  Watch the output. You should see:
  1. Build context uploaded to Fly's remote builder
  2. Docker stages executing (builder → runtime)
  3. `release_command` running: `node bin/migrate.js` — this applies all 19 migrations to your Supabase database
  4. Machine deployment: `v1 is up`

  If `release_command` fails, the deploy aborts and no traffic is switched. Check the logs:
  ```bash
  fly logs
  ```

- [ ] **Step 7: Verify the live endpoint**

  ```bash
  curl https://amana-api.fly.dev/health
  ```

  Expected:
  ```json
  {"status":"ok"}
  ```

  Also check the machine status:
  ```bash
  fly status
  ```

  Expected: 1 machine in state `running`, region `jnb`.

- [ ] **Step 8: Verify automated CD works**

  Push any trivial change to `main` (e.g. add a blank line to `fly.toml`). Watch the GitHub Actions run:

  1. `build-and-test` job runs (lint + typecheck + build + test) — ~15 min
  2. `deploy` job runs only after `build-and-test` passes
  3. Check `https://amana-api.fly.dev/health` again after deploy completes

  Expected: same `{"status":"ok"}` response.
