# Backend Deployment Design

**Status:** Approved by user 2026-05-11.
**Scope:** Deploy the Amana backend (Hono + Node.js + Drizzle + Postgres) to production using Fly.io + Supabase, with automated CI/CD via GitHub Actions.

---

## 1. Architecture

Three managed components:

- **Fly.io** (`jnb` — Johannesburg region) — runs the compiled Hono server as a persistent machine (`shared-cpu-1x`, 256 MB RAM). `min_machines_running = 1` keeps one instance always warm (no cold starts — unacceptable for a fintech app). Scales up automatically under load.
- **Supabase Postgres** — free tier to start; PostGIS is enabled by default (required for geolocation columns). Single direct connection string (port 5432) used for both app and migrations. Switching to the transaction pooler for the app is a later optimisation, not needed at MVP scale.
- **GitHub Actions** — the existing `build-and-test` job is unchanged. A new `deploy` job runs only on push to `main`, only after `build-and-test` passes, using Fly's remote builder so no Docker daemon is needed in CI.

**Migration strategy:** Fly's `release_command` runs `node bin/migrate.js` before traffic is cut over to the new version. If the migration fails, the old version keeps serving traffic. This gives zero-downtime deploys without a separate migration pipeline.

---

## 2. Files produced

**Created:**
- `apps/backend/Dockerfile`
- `apps/backend/.dockerignore`
- `apps/backend/bin/migrate.js`
- `fly.toml` (repo root)

**Modified:**
- `.github/workflows/ci.yml` — add `deploy` job

---

## 3. Dockerfile

Multi-stage build. The `builder` stage installs all dependencies and compiles; `pnpm deploy --prod` then creates a self-contained `/standalone` directory with compiled output, production `node_modules`, and all resolved workspace packages (`@amana/types`, `@amana/validation`). The `runtime` stage copies only `/standalone` into a clean `node:20-alpine` image.

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

`pnpm deploy` copies `dist/`, `src/db/migrations/` (SQL files), `bin/`, and `package.json` into `/standalone`. Runtime image targets under 200 MB.

### .dockerignore (repo root)

```
**/node_modules
**/dist
**/.env
**/test-corpus
**/tests
**/*.test.ts
.git
```

---

## 4. fly.toml

Located at repo root. `dockerfile` path points into the monorepo.

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

`ANCHOR_API_BASE_URL` is non-sensitive and lives in `[env]` so it's easy to switch from sandbox to production without touching secrets.

---

## 5. Migration script

`apps/backend/bin/migrate.js` — plain ESM JS (no compile step; `pnpm deploy` copies it directly into the image). Run by Fly as `release_command`.

```js
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
const db = drizzle(sql);
await migrate(db, { migrationsFolder: 'src/db/migrations' });
await sql.end();
```

`ssl: 'require'` is mandatory for Supabase. `migrationsFolder` is relative to the container working directory (`/app`), which matches where `pnpm deploy` places `src/db/migrations/`.

---

## 6. GitHub Actions — deploy job

Appended to `.github/workflows/ci.yml` after the existing `build-and-test` job:

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

`--remote-only` sends the build context to Fly's remote builder. No Docker daemon needed in CI. `FLY_API_TOKEN` is a deploy token scoped to the `amana-api` app (not a personal token), stored as a GitHub Actions secret.

---

## 7. Secrets

Set via `fly secrets set` before the first deploy. Stored encrypted in Fly's vault; injected as env vars at runtime.

### Required

| Secret | Source |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → URI (port 5432 direct) → append `?sslmode=require` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `ANCHOR_API_KEY` | Anchor sandbox dashboard |
| `ANCHOR_WEBHOOK_SECRET` | Anchor sandbox dashboard |

### Optional (add when needed)

| Secret | Notes |
|---|---|
| `SENTRY_DSN` | Sentry project DSN |
| `EXPO_ACCESS_TOKEN` | Expo dashboard → Access Tokens (push notifications) |
| `TERMII_API_KEY` | Termii dashboard (real SMS OTP) |
| `AWS_ACCESS_KEY_ID` | S3 media uploads |
| `AWS_SECRET_ACCESS_KEY` | S3 media uploads |

---

## 8. One-time setup runbook

Steps to run once before the first automated deploy.

1. **Create Supabase project** — free tier doesn't offer an Africa region; choose `eu-west-2` (London) as the lowest-latency option. On a paid plan, `af-south-1` (Cape Town) is available. Copy the direct connection URI (port 5432, not the pooler).
2. **Install flyctl** — `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`
3. **Create Fly app** — `fly apps create amana-api` (from repo root)
4. **Set secrets** — `fly secrets set DATABASE_URL="..." JWT_SECRET="..." ANCHOR_API_KEY="..." ANCHOR_WEBHOOK_SECRET="..."`
5. **Generate Fly deploy token** — `fly tokens create deploy -a amana-api` → paste into GitHub → Settings → Secrets → `FLY_API_TOKEN`
6. **First deploy** — `fly deploy --remote-only` (manual, from local machine, to verify)
7. **Subsequent deploys** — automatic on merge to `main`

---

## 9. Out of scope

- Custom domain (`api.amana.ng`) — add when going live with real users
- Supabase transaction pooler — add when connection count becomes a bottleneck
- Fly Postgres (not used — Supabase chosen for PostGIS and managed ops)
- Staging environment — add before inviting beta users
- Cron process (`bin/cron.ts`) — deploy as a separate Fly machine in a follow-up
