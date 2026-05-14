# Staging Environment Design

**Date:** 2026-05-14
**Status:** Approved

## Goal

Add a persistent staging environment (`api-staging.amana-ng.com`) that is manually deployable, fully isolated from production, and shares the same Dockerfile and CI pipeline.

## Approach

Separate `fly.staging.toml` config file + `workflow_dispatch` GitHub Actions job. The staging Fly app (`amana-api-staging`) and its Supabase project (`amana-staging`) are completely independent from prod — separate secrets, separate database, same codebase.

---

## Infrastructure

| | Production | Staging |
|---|---|---|
| Fly app | `amana-api` | `amana-api-staging` |
| Region | `jnb` | `jnb` |
| Machine | `shared-cpu-1x` / 256 MB | `shared-cpu-1x` / 256 MB |
| URL | `api.amana-ng.com` | `api-staging.amana-ng.com` |
| Supabase project | `amana-prod` (existing) | `amana-staging` (new) |
| Anchor API | `api.sandbox.getanchor.co` | `api.sandbox.getanchor.co` |
| `min_machines_running` | 1 | 0 (auto-stop when idle) |

Staging uses `min_machines_running = 0` to avoid cost when idle. Prod stays at 1 for zero-latency cold start.

---

## Config files

### `fly.staging.toml` (new file, repo root)

Mirrors `fly.toml` with three differences: app name, `API_BASE_URL`, and `min_machines_running = 0`.

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

### `.github/workflows/ci.yml` (modified)

Two changes:

1. Add `workflow_dispatch:` to the `on:` block.
2. Add `deploy-staging` job; add `if: github.event_name == 'push'` guard to existing `deploy` job.

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

# ... build-and-test job unchanged ...

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

The same `FLY_API_TOKEN` works for both apps (personal access token scoped to the account).

---

## Manual one-time setup (not automated)

These steps are done once by the operator before the first staging deploy:

### 1. Create Fly app
```bash
fly apps create amana-api-staging
```

### 2. Create Supabase project
Create `amana-staging` in the Supabase dashboard. Enable PostGIS extension. Copy the direct connection string (port 5432, `sslmode=require`). URL-encode any special characters in the password.

### 3. Set Fly secrets
```bash
fly secrets set --app amana-api-staging \
  DATABASE_URL="postgres://postgres.<ref>:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require" \
  JWT_SECRET="<32-byte hex — different from prod>" \
  ANCHOR_API_KEY="<same sandbox key as prod or a separate one>" \
  ANCHOR_WEBHOOK_SECRET="<staging webhook secret>"
```

### 4. Allocate IPs
```bash
fly ips allocate-v4 --app amana-api-staging
fly ips allocate-v6 --app amana-api-staging
```

### 5. Add TLS cert
```bash
fly certs add api-staging.amana-ng.com --app amana-api-staging
```

### 6. Add DNS records (Namecheap)
| Type | Host | Value |
|---|---|---|
| A | `api-staging` | staging IPv4 (from `fly ips list --app amana-api-staging`) |
| AAAA | `api-staging` | staging IPv6 |

### 7. First deploy
Trigger from GitHub Actions UI (`workflow_dispatch`) or:
```bash
gh workflow run ci.yml
```

The `release_command` (`node bin/migrate.mjs`) runs automatically on first deploy, bootstrapping the full schema from migrations.

---

## Ongoing workflow

- **Prod deploy:** push to `main` → CI runs → `deploy` job fires automatically
- **Staging deploy:** GitHub Actions UI → "Run workflow" on `ci.yml` → `deploy-staging` job runs, `deploy` job skipped
- **Staging DB migrations:** handled automatically by `release_command` on every staging deploy (same as prod)

---

## Out of scope

- Per-PR preview environments (not needed for manual staging)
- Separate Anchor sandbox credentials (both envs use the same sandbox until KYB approval)
- Mobile app pointing at staging URL (manual override in dev builds when needed)
