# Staging Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually-triggered staging environment (`api-staging.amana-ng.com`) as a separate Fly.io app backed by a separate Supabase project, deployable via GitHub Actions `workflow_dispatch`.

**Architecture:** A new `fly.staging.toml` config file (mirrors `fly.toml` with `app = 'amana-api-staging'`, staging URL, and `min_machines_running = 0`) plus a `deploy-staging` job in the existing `ci.yml`. The existing `deploy` job gets an explicit `push`-only guard so it never fires on manual triggers. Infrastructure (Fly app, Supabase project, DNS, TLS cert) is set up once via CLI — not automated.

**Tech Stack:** Fly.io (`flyctl`), GitHub Actions, Supabase Postgres, Namecheap DNS — no application code changes.

**Spec:** `docs/superpowers/specs/2026-05-14-staging-environment-design.md`

---

## File structure produced by this plan

**Created:**
- `fly.staging.toml` — Fly config for `amana-api-staging`

**Modified:**
- `.github/workflows/ci.yml` — add `workflow_dispatch` trigger + `deploy-staging` job

---

### Task 1 — Create `fly.staging.toml`

**Files:**
- Create: `fly.staging.toml` (repo root, beside `fly.toml`)

- [ ] **Step 1: Create the file**

Create `fly.staging.toml` at the repo root with this exact content:

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

- [ ] **Step 2: Validate the config**

```bash
flyctl config validate --config fly.staging.toml
```

Expected output contains: `✓ Configuration is valid`

If `flyctl` is not installed locally, skip this step — the remote builder validates on deploy.

- [ ] **Step 3: Commit**

```bash
git add fly.staging.toml
git commit -m "feat(deploy): fly.staging.toml — amana-api-staging, min 0 machines"
```

---

### Task 2 — Update CI workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

The current file has:
```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

And a `deploy` job with:
```yaml
  deploy:
    needs: build-and-test
    runs-on: ubuntu-24.04
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

- [ ] **Step 1: Add `workflow_dispatch` trigger**

In `.github/workflows/ci.yml`, replace the `on:` block:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

- [ ] **Step 2: Verify the `deploy` job already has a `push`-only guard**

Confirm the `deploy` job's `if:` condition is:

```yaml
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

This already guards against firing on `workflow_dispatch`. No change needed if it matches exactly.

- [ ] **Step 3: Add `deploy-staging` job**

At the end of `.github/workflows/ci.yml`, after the `deploy` job, add:

```yaml
  deploy-staging:
    needs: build-and-test
    runs-on: ubuntu-24.04
    if: github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v6
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.staging.toml --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 4: Verify the full `ci.yml` looks correct**

The complete file should look like:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

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

  deploy-staging:
    needs: build-and-test
    runs-on: ubuntu-24.04
    if: github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v6
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.staging.toml --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): deploy-staging job — workflow_dispatch deploys to amana-api-staging"
```

---

### Task 3 — Manual infrastructure setup

**No files to create.** These are one-time operator shell commands run locally. Run them in order.

> **Pre-requisite:** `flyctl` installed and authenticated (`fly auth login`). Supabase CLI optional — project can be created in the dashboard.

- [ ] **Step 1: Create the Fly app**

```bash
fly apps create amana-api-staging
```

Expected: `New app created: amana-api-staging`

- [ ] **Step 2: Create Supabase staging project**

In the [Supabase dashboard](https://supabase.com/dashboard):
1. Click **New project**
2. Name: `amana-staging`
3. Region: **EU West (London)** — same as prod to minimise latency
4. Generate a strong password (save it)
5. Once provisioned, go to **Settings → Database → Connection string → URI**
6. Copy the **direct connection** URI (port 5432, not pooler)
7. URL-encode any `$` in the password as `%24`
8. Enable PostGIS: go to **Database → Extensions**, search `postgis`, enable it

- [ ] **Step 3: Set Fly secrets on the staging app**

```bash
fly secrets set --app amana-api-staging \
  DATABASE_URL="postgres://postgres.<project-ref>:<url-encoded-password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  ANCHOR_API_KEY="<same value as prod — both are sandbox>" \
  ANCHOR_WEBHOOK_SECRET="<staging webhook secret>"
```

Verify secrets are set:

```bash
fly secrets list --app amana-api-staging
```

Expected: four secrets listed (`DATABASE_URL`, `JWT_SECRET`, `ANCHOR_API_KEY`, `ANCHOR_WEBHOOK_SECRET`).

- [ ] **Step 4: Allocate dedicated IPs**

```bash
fly ips allocate-v4 --app amana-api-staging
fly ips allocate-v6 --app amana-api-staging
fly ips list --app amana-api-staging
```

Note the IPv4 and IPv6 addresses — needed for DNS in the next step.

- [ ] **Step 5: Add TLS cert**

```bash
fly certs add api-staging.amana-ng.com --app amana-api-staging
```

Expected: cert provisioning begins. Let's Encrypt will validate once DNS propagates.

- [ ] **Step 6: Add DNS records on Namecheap**

In the Namecheap dashboard for `amana-ng.com`, add two records:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | `api-staging` | `<IPv4 from Step 4>` | Automatic |
| AAAA | `api-staging` | `<IPv6 from Step 4>` | Automatic |

Wait 2–5 minutes for DNS propagation, then verify:

```bash
fly certs check api-staging.amana-ng.com --app amana-api-staging
```

Expected: `✓ Your certificate for api-staging.amana-ng.com has been issued.`

---

### Task 4 — First deploy + smoke test

> **Pre-requisite:** Tasks 1–3 complete. `fly secrets list --app amana-api-staging` shows four secrets. DNS cert is issued.

- [ ] **Step 1: Push the code to trigger CI**

```bash
git push origin main
```

The `build-and-test` job runs. The `deploy` job fires (push to main). `deploy-staging` does NOT fire (it requires `workflow_dispatch`).

Wait for CI to go green.

- [ ] **Step 2: Trigger staging deploy manually**

```bash
gh workflow run ci.yml
```

Or via the GitHub Actions UI: **Actions → ci → Run workflow → Run workflow**.

This triggers `build-and-test` → `deploy-staging`. The `release_command` (`node bin/migrate.mjs`) runs automatically on the Fly machine, bootstrapping the full schema from all migrations on the staging Supabase DB.

Monitor the run:

```bash
gh run watch
```

Expected: `build-and-test` passes, `deploy-staging` passes, `deploy` is skipped.

- [ ] **Step 3: Smoke test the health endpoint**

```bash
curl -s https://api-staging.amana-ng.com/health | jq
```

Expected:

```json
{"status":"ok","version":"0.0.0"}
```

If you get a 503, the machine may be starting (auto-start from cold). Wait 5 seconds and retry.

- [ ] **Step 4: Tag**

```bash
git tag v0.0-staging-environment
git push origin v0.0-staging-environment
```

---

## Plan-complete criteria

- `https://api-staging.amana-ng.com/health` returns `{"status":"ok"}`.
- `fly apps list` shows both `amana-api` (prod) and `amana-api-staging` (staging).
- Pushing to `main` deploys prod only — staging is not touched.
- Running `gh workflow run ci.yml` deploys staging only — prod is not touched.
- Staging DB is a completely separate Supabase project with its own migrations applied.
