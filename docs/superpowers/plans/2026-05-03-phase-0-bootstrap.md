# Phase 0 — Repo Bootstrap & Tech Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Amana monorepo with a working TypeScript backend, two React Native mobile shells, Postgres 16 + PostGIS, CI/CD pipeline, structured logging, error tracking, and a smoke-tested end-to-end pipeline that's ready to receive feature code in Sub-plan 2.

**Architecture:** pnpm workspace + Turborepo monorepo. Backend in TypeScript on Hono. Mobile in React Native via Expo (managed workflow). Postgres 16 + PostGIS for spatial data. Drizzle ORM + drizzle-kit for migrations. Vitest for unit tests. GitHub Actions for CI. SOPS + age for secrets. Biome for lint+format.

**Tech Stack (per locked decision #18):**
- Monorepo: pnpm 10+, Turborepo
- Backend: TypeScript 5.5+, Node.js 20+, Hono 4.x, Drizzle ORM, postgres-js, Zod, Pino, Sentry, Vitest
- Database: Postgres 16, PostGIS 3.4
- Mobile: React Native (Expo SDK 51+), TypeScript, EAS Build
- Quality: Biome, TypeScript strict mode
- Secrets: SOPS + age
- CI: GitHub Actions

**Out of scope for this plan:** any feature code, ledger logic, rule engine, mobile UI beyond a smoke-test screen, BaaS adapter beyond a `sandbox.ts` config stub, hosting/deployment infrastructure (deferred to a separate ops plan).

---

## File structure produced by this plan

```
amana/
├── .editorconfig                                NEW
├── .env.example                                 NEW
├── .gitignore                                   MODIFIED
├── .nvmrc                                       NEW
├── .sops.yaml                                   NEW
├── biome.json                                   NEW
├── docker-compose.yml                           NEW
├── package.json                                 NEW (root)
├── pnpm-workspace.yaml                          NEW
├── tsconfig.base.json                           NEW
├── turbo.json                                   NEW
├── README.md                                    MODIFIED (overwritten with bootstrap instructions)
├── .github/
│   ├── workflows/ci.yml                         NEW
│   ├── PULL_REQUEST_TEMPLATE.md                 NEW
│   └── CODEOWNERS                               NEW
├── docs/
│   ├── adr/
│   │   ├── 0001-monorepo-pnpm-turbo.md          NEW
│   │   ├── 0002-typescript-backend-hono.md      NEW
│   │   ├── 0003-react-native-expo.md            NEW
│   │   ├── 0004-postgres-drizzle.md             NEW
│   │   └── 0005-aws-af-south.md                 NEW
│   └── runbook/
│       ├── local-dev.md                         NEW
│       └── anchor-sandbox.md                    NEW
├── secrets/
│   └── .gitkeep                                 NEW
├── packages/
│   ├── types/
│   │   ├── package.json                         NEW
│   │   ├── tsconfig.json                        NEW
│   │   ├── README.md                            NEW
│   │   └── src/index.ts                         NEW
│   ├── validation/
│   │   ├── package.json                         NEW
│   │   ├── tsconfig.json                        NEW
│   │   ├── README.md                            NEW
│   │   └── src/index.ts                         NEW
│   └── api-client/
│       ├── package.json                         NEW
│       ├── tsconfig.json                        NEW
│       ├── README.md                            NEW
│       └── src/
│           ├── index.ts                         NEW
│           └── client.ts                        NEW
└── apps/
    ├── backend/
    │   ├── package.json                         NEW
    │   ├── tsconfig.json                        NEW
    │   ├── vitest.config.ts                     NEW
    │   ├── drizzle.config.ts                    NEW
    │   ├── README.md                            NEW
    │   ├── src/
    │   │   ├── index.ts                         NEW
    │   │   ├── server.ts                        NEW
    │   │   ├── env.ts                           NEW
    │   │   ├── lib/
    │   │   │   ├── logger.ts                    NEW
    │   │   │   └── sentry.ts                    NEW
    │   │   ├── middleware/
    │   │   │   ├── request-id.ts                NEW
    │   │   │   └── error-handler.ts             NEW
    │   │   ├── db/
    │   │   │   ├── client.ts                    NEW
    │   │   │   └── migrations/
    │   │   │       └── 0000_init.sql            NEW
    │   │   ├── integrations/anchor/
    │   │   │   ├── index.ts                     NEW
    │   │   │   └── sandbox.ts                   NEW
    │   │   └── routes/health.ts                 NEW
    │   └── tests/
    │       ├── health.test.ts                   NEW
    │       └── logger.test.ts                   NEW
    ├── principal/
    │   ├── app.json                             NEW
    │   ├── package.json                         NEW
    │   ├── tsconfig.json                        NEW
    │   ├── index.ts                             NEW
    │   ├── App.tsx                              NEW
    │   ├── README.md                            NEW
    │   └── src/screens/HealthCheck.tsx          NEW
    └── agent/
        ├── app.json                             NEW
        ├── package.json                         NEW
        ├── tsconfig.json                        NEW
        ├── index.ts                             NEW
        ├── App.tsx                              NEW
        ├── README.md                            NEW
        └── src/screens/HealthCheck.tsx          NEW
```

---

## Tasks

### Task 1: Verify prerequisites

**Files:** none.

- [ ] **Step 1: Verify Node 20+ is installed**

```bash
node --version
```
Expected: `v20.x.x` or `v22.x.x` (anything ≥20). If not installed, install via [nvm-windows](https://github.com/coreybutler/nvm-windows) or download from nodejs.org.

- [ ] **Step 2: Verify pnpm 10+ is installed**

```bash
pnpm --version
```
Expected: `9.x.x` or higher. If not installed, run `npm install -g pnpm@latest`.

- [ ] **Step 3: Verify Docker Desktop is installed and running**

```bash
docker --version
docker compose version
```
Expected: Docker version 24+ and Docker Compose v2+. If `docker ps` errors, start Docker Desktop.

- [ ] **Step 4: Verify git is configured**

```bash
git config user.name
git config user.email
```
Expected: both return non-empty values. If empty, run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`.

- [ ] **Step 5: Verify the amana repo is git-initialized**

```bash
cd C:/Users/alex_/amana
git status
```
Expected: a working tree on `main` with previous commits visible. If not a repo, see existing project README.

---

### Task 2: Initialize pnpm + Turborepo at the root

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.nvmrc`
- Create: `.editorconfig`
- Modify: `.gitignore` (extend)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "amana",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "format": "biome format --write .",
    "format:check": "biome format ."
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "turbo": "2.1.3",
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 3: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

- [ ] **Step 4: Write `.nvmrc`**

```
20.18.0
```

- [ ] **Step 5: Write `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 6: Append to `.gitignore`**

Open the existing `.gitignore` and append (after the existing content):

```
# pnpm + turbo
.turbo/
.pnpm-store/

# Build outputs
dist/
.expo/
.expo-shared/

# Local secrets (encrypted versions are committed under secrets/)
*.key
age.key

# Mobile build artifacts
ios/Pods/
android/.gradle/
android/build/
*.keystore
```

- [ ] **Step 7: Run `pnpm install` to confirm root setup works**

```bash
pnpm install
```
Expected: `Done in X seconds`. A `pnpm-lock.yaml` and `node_modules/` appear at the root.

- [ ] **Step 8: Verify Turbo and Biome are usable**

```bash
pnpm exec turbo --version
pnpm exec biome --version
```
Expected: `2.1.3` and `1.9.4` respectively (or the versions resolved by `pnpm install`).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .nvmrc .editorconfig .gitignore pnpm-lock.yaml
git commit -m "chore: initialize pnpm + turborepo monorepo with biome"
```

---

### Task 3: Add shared TypeScript base config

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Write `tsconfig.base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore: add shared tsconfig.base.json with strict settings"
```

---

### Task 4: Add Biome lint+format config

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignore": ["**/dist/**", "**/.turbo/**", "**/node_modules/**", "**/.expo/**", "pnpm-lock.yaml"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "warn",
        "useImportType": "error"
      },
      "suspicious": {
        "noConsoleLog": "warn"
      }
    }
  },
  "organizeImports": { "enabled": true }
}
```

- [ ] **Step 2: Run Biome to verify config parses**

```bash
pnpm exec biome check . --reporter=summary
```
Expected: prints a summary; may report zero findings (the repo currently has only markdown). Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: add biome lint+format config"
```

---

### Task 5: Add Postgres+PostGIS via docker-compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
name: amana

services:
  postgres:
    image: postgis/postgis:16-3.4
    container_name: amana-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: amana
      POSTGRES_PASSWORD: amana_dev_only
      POSTGRES_DB: amana_dev
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U amana -d amana_dev"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
```

- [ ] **Step 2: Start the database**

```bash
docker compose up -d
```
Expected: `Container amana-postgres  Started`.

- [ ] **Step 3: Verify Postgres is reachable and PostGIS works**

```bash
docker compose exec postgres psql -U amana -d amana_dev -c "SELECT version();"
docker compose exec postgres psql -U amana -d amana_dev -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT postgis_full_version();"
```
Expected: both queries return version strings; second includes `POSTGIS=\"3.4.x\"`.

- [ ] **Step 4: Stop the container (we'll restart on demand later)**

```bash
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add postgres 16 + postgis docker-compose for local dev"
```

---

### Task 6: Bootstrap `@amana/types` package

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/README.md`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Write `packages/types/package.json`**

```json
{
  "name": "@amana/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "test": "echo 'no tests yet' && exit 0"
  },
  "devDependencies": {
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Write `packages/types/src/index.ts`**

```ts
// Shared domain types for Amana — populated in Sub-plan 2.
// This file intentionally exports a sentinel so the package builds cleanly.
export const __amanaTypesPackageBootstrapped = true;
```

- [ ] **Step 4: Write `packages/types/README.md`**

```markdown
# @amana/types

Shared TypeScript types used by the backend, mobile apps, and tooling.

Populated in Sub-plan 2 (Identity + Wallet Ledger + BaaS Adapter) onwards.
```

- [ ] **Step 5: Run `pnpm install` to link the workspace**

```bash
pnpm install
```
Expected: `+ @amana/types` appears in the output.

- [ ] **Step 6: Build the package and verify**

```bash
pnpm --filter @amana/types build
```
Expected: `dist/index.js` and `dist/index.d.ts` exist.

```bash
ls packages/types/dist
```
Expected: `index.d.ts  index.d.ts.map  index.js  index.js.map`.

- [ ] **Step 7: Commit**

```bash
git add packages/types pnpm-lock.yaml
git commit -m "feat(types): bootstrap @amana/types shared package"
```

---

### Task 7: Bootstrap `@amana/validation` package

**Files:**
- Create: `packages/validation/package.json`
- Create: `packages/validation/tsconfig.json`
- Create: `packages/validation/README.md`
- Create: `packages/validation/src/index.ts`

- [ ] **Step 1: Write `packages/validation/package.json`**

```json
{
  "name": "@amana/validation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "test": "echo 'no tests yet' && exit 0"
  },
  "dependencies": {
    "zod": "3.23.8"
  },
  "devDependencies": {
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `packages/validation/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Write `packages/validation/src/index.ts`**

```ts
import { z } from 'zod';

// Shared Zod schemas — populated in Sub-plan 2 onwards.
// Bootstrap export so the package builds cleanly.
export const PingSchema = z.object({ ping: z.literal('pong') });
export type Ping = z.infer<typeof PingSchema>;
```

- [ ] **Step 4: Write `packages/validation/README.md`**

```markdown
# @amana/validation

Shared Zod validation schemas used by the backend and mobile apps. Importing
from one place guarantees the same shape on the wire and in storage.

Populated in Sub-plan 2 onwards.
```

- [ ] **Step 5: Install + build**

```bash
pnpm install
pnpm --filter @amana/validation build
```
Expected: `dist/index.js` and `dist/index.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add packages/validation pnpm-lock.yaml
git commit -m "feat(validation): bootstrap @amana/validation with zod"
```

---

### Task 8: Bootstrap `@amana/api-client` package

**Files:**
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/README.md`
- Create: `packages/api-client/src/index.ts`
- Create: `packages/api-client/src/client.ts`

- [ ] **Step 1: Write `packages/api-client/package.json`**

```json
{
  "name": "@amana/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "test": "echo 'no tests yet' && exit 0"
  },
  "dependencies": {
    "@amana/types": "workspace:*",
    "@amana/validation": "workspace:*"
  },
  "devDependencies": {
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `packages/api-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Write `packages/api-client/src/client.ts`**

```ts
export interface ClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class AmanaApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async health(): Promise<{ status: 'ok'; version: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`health check failed: ${res.status}`);
    }
    return (await res.json()) as { status: 'ok'; version: string };
  }
}
```

- [ ] **Step 4: Write `packages/api-client/src/index.ts`**

```ts
export { AmanaApiClient, type ClientConfig } from './client';
```

- [ ] **Step 5: Write `packages/api-client/README.md`**

```markdown
# @amana/api-client

Shared, type-safe HTTP client for the Amana backend. Used by both mobile apps
(`apps/principal`, `apps/agent`) and any future internal tooling.

Populated as backend endpoints land in Sub-plan 2 onwards.
```

- [ ] **Step 6: Install + build**

```bash
pnpm install
pnpm --filter @amana/api-client build
```
Expected: `dist/index.js`, `dist/client.js` exist.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "feat(api-client): bootstrap @amana/api-client with health() method"
```

---

### Task 9: Bootstrap `apps/backend` with Hono

**Files:**
- Create: `apps/backend/package.json`
- Create: `apps/backend/tsconfig.json`
- Create: `apps/backend/README.md`
- Create: `apps/backend/src/index.ts`
- Create: `apps/backend/src/server.ts`
- Create: `apps/backend/src/routes/health.ts`

- [ ] **Step 1: Write `apps/backend/package.json`**

```json
{
  "name": "@amana/backend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@amana/types": "workspace:*",
    "@amana/validation": "workspace:*",
    "@hono/node-server": "1.13.2",
    "hono": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "20.16.11",
    "tsx": "4.19.1",
    "typescript": "5.5.4",
    "vitest": "2.1.2"
  }
}
```

- [ ] **Step 2: Write `apps/backend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: Write `apps/backend/src/routes/health.ts`**

```ts
import { Hono } from 'hono';

const VERSION = '0.0.0';

export const healthRoute = new Hono().get('/', (c) =>
  c.json({ status: 'ok' as const, version: VERSION }),
);
```

- [ ] **Step 4: Write `apps/backend/src/server.ts`**

```ts
import { Hono } from 'hono';
import { healthRoute } from './routes/health';

export function createServer(): Hono {
  const app = new Hono();
  app.route('/health', healthRoute);
  return app;
}
```

- [ ] **Step 5: Write `apps/backend/src/index.ts`**

```ts
import { serve } from '@hono/node-server';
import { createServer } from './server';

const PORT = Number(process.env.PORT ?? 3000);

const app = createServer();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // biome-ignore lint/suspicious/noConsoleLog: bootstrap startup banner
  console.log(`amana backend listening on http://localhost:${info.port}`);
});
```

- [ ] **Step 6: Write `apps/backend/README.md`**

```markdown
# @amana/backend

Amana TypeScript backend on Hono.

## Run locally

```bash
pnpm --filter @amana/backend dev
```

Visit http://localhost:3000/health → `{"status":"ok","version":"0.0.0"}`.

## Test

```bash
pnpm --filter @amana/backend test
```
```

- [ ] **Step 7: Install dependencies**

```bash
pnpm install
```
Expected: `+ @amana/backend` and the new `hono`, `@hono/node-server`, `tsx`, `vitest` packages appear.

- [ ] **Step 8: Build to confirm tsc is happy**

```bash
pnpm --filter @amana/backend build
```
Expected: `dist/index.js`, `dist/server.js`, `dist/routes/health.js` all exist; no TypeScript errors.

- [ ] **Step 9: Run the dev server briefly to verify**

In one terminal:
```bash
pnpm --filter @amana/backend dev
```
Expected: `amana backend listening on http://localhost:3000`.

In another terminal (or use a browser):
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok","version":"0.0.0"}`.

Then stop the dev server (Ctrl+C).

- [ ] **Step 10: Commit**

```bash
git add apps/backend pnpm-lock.yaml
git commit -m "feat(backend): bootstrap hono backend with /health endpoint"
```

---

### Task 10: Add Vitest config + first test for /health

**Files:**
- Create: `apps/backend/vitest.config.ts`
- Create: `apps/backend/tests/health.test.ts`

- [ ] **Step 1: Write `apps/backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 2: Write the failing test `apps/backend/tests/health.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server';

describe('GET /health', () => {
  it('returns status ok and a version string', async () => {
    const app = createServer();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 3: Run the test (should already pass — Task 9 wired the route)**

```bash
pnpm --filter @amana/backend test
```
Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/vitest.config.ts apps/backend/tests/health.test.ts
git commit -m "test(backend): add vitest config + /health endpoint test"
```

---

### Task 11: Add structured logging (Pino)

**Files:**
- Create: `apps/backend/src/lib/logger.ts`
- Create: `apps/backend/tests/logger.test.ts`
- Modify: `apps/backend/package.json` (add `pino` dependency)
- Modify: `apps/backend/src/index.ts` (use logger for startup banner)

- [ ] **Step 1: Add Pino dependency**

```bash
pnpm --filter @amana/backend add pino@9.5.0
pnpm --filter @amana/backend add -D pino-pretty@11.2.2
```
Expected: both packages installed.

- [ ] **Step 2: Write `apps/backend/src/lib/logger.ts`**

```ts
import pino, { type Logger } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
    : undefined,
  base: { service: 'amana-backend' },
});
```

- [ ] **Step 3: Write the failing test `apps/backend/tests/logger.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { logger } from '../src/lib/logger';

describe('logger', () => {
  it('exposes pino-compatible level methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('uses base service field', () => {
    // pino exposes `bindings()` only on the root logger
    const bindings = logger.bindings();
    expect(bindings.service).toBe('amana-backend');
  });
});
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @amana/backend test
```
Expected: `3 passed` (logger × 2 + health × 1).

- [ ] **Step 5: Replace `console.log` in `apps/backend/src/index.ts` with logger**

Replace the entire file with:

```ts
import { serve } from '@hono/node-server';
import { logger } from './lib/logger';
import { createServer } from './server';

const PORT = Number(process.env.PORT ?? 3000);

const app = createServer();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info({ port: info.port }, 'amana backend listening');
});
```

- [ ] **Step 6: Re-run dev briefly to confirm structured log output**

```bash
pnpm --filter @amana/backend dev
```
Expected (with pino-pretty in dev): `[HH:MM:ss.l] INFO (amana-backend): amana backend listening { port: 3000 }`. Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/package.json apps/backend/src/lib/logger.ts apps/backend/src/index.ts apps/backend/tests/logger.test.ts pnpm-lock.yaml
git commit -m "feat(backend): structured logging with pino + pretty in dev"
```

---

### Task 12: Add request-id middleware

**Files:**
- Create: `apps/backend/src/middleware/request-id.ts`
- Modify: `apps/backend/src/server.ts` (mount middleware)
- Create test: `apps/backend/tests/request-id.test.ts`

- [ ] **Step 1: Write `apps/backend/src/middleware/request-id.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

const HEADER = 'x-request-id';

export const requestId = (): MiddlewareHandler => async (c, next) => {
  const incoming = c.req.header(HEADER);
  const id = incoming && incoming.length > 0 ? incoming : randomUUID();
  c.set('requestId', id);
  c.header(HEADER, id);
  await next();
};
```

- [ ] **Step 2: Write the failing test `apps/backend/tests/request-id.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../src/middleware/request-id';

describe('request-id middleware', () => {
  it('generates a UUID when no incoming header is present', async () => {
    const app = new Hono().use(requestId()).get('/', (c) => c.text(c.get('requestId') as string));
    const res = await app.request('/');
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(await res.text()).toBe(id);
  });

  it('echoes an incoming x-request-id header', async () => {
    const app = new Hono().use(requestId()).get('/', (c) => c.text(c.get('requestId') as string));
    const res = await app.request('/', { headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('abc-123');
    expect(await res.text()).toBe('abc-123');
  });
});
```

- [ ] **Step 3: Run the test (the request-id tests construct their own Hono app, so they pass even before we wire the middleware into `createServer`)**

```bash
pnpm --filter @amana/backend test
```
Expected: `5 passed` (request-id × 2 + logger × 2 + health × 1).

- [ ] **Step 4: Wire the middleware into `createServer` in `apps/backend/src/server.ts`**

Replace contents with:

```ts
import { Hono } from 'hono';
import { requestId } from './middleware/request-id';
import { healthRoute } from './routes/health';

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  return app;
}
```

- [ ] **Step 5: Update `apps/backend/tests/health.test.ts` to assert the request-id header is present**

Replace the test file with:

```ts
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server';

describe('GET /health', () => {
  it('returns status ok and a version string', async () => {
    const app = createServer();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('emits an x-request-id header', async () => {
    const app = createServer();
    const res = await app.request('/health');
    expect(res.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --filter @amana/backend test
```
Expected: `6 passed` (health × 2 + logger × 2 + request-id × 2).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/middleware apps/backend/src/server.ts apps/backend/tests/request-id.test.ts apps/backend/tests/health.test.ts
git commit -m "feat(backend): request-id middleware echoed via x-request-id header"
```

---

### Task 13: Add Zod-based env validation

**Files:**
- Create: `apps/backend/src/env.ts`
- Create test: `apps/backend/tests/env.test.ts`
- Modify: `apps/backend/package.json` (add `@amana/validation` dep)
- Modify: `apps/backend/src/index.ts` (use validated env)

- [ ] **Step 1: Add `@amana/validation` to backend deps**

Open `apps/backend/package.json` and add to `dependencies`:

```json
"@amana/validation": "workspace:*",
"zod": "3.23.8"
```

Then run:

```bash
pnpm install
```

- [ ] **Step 2: Write `apps/backend/src/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  DATABASE_URL: z.string().url().default('postgres://amana:amana_dev_only@localhost:5432/amana_dev'),
  SENTRY_DSN: z.string().url().optional(),
  ANCHOR_API_KEY: z.string().min(1).optional(),
  ANCHOR_API_BASE_URL: z.string().url().default('https://api.sandbox.getanchor.co'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
```

- [ ] **Step 3: Write the failing test `apps/backend/tests/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

describe('loadEnv', () => {
  it('uses defaults when only NODE_ENV is set', () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.ANCHOR_API_BASE_URL).toBe('https://api.sandbox.getanchor.co');
  });

  it('coerces PORT from a string', () => {
    const env = loadEnv({ NODE_ENV: 'test', PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('throws a descriptive error when DATABASE_URL is malformed', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @amana/backend test
```
Expected: `9 passed` (health × 2 + logger × 2 + request-id × 2 + env × 3).

- [ ] **Step 5: Use the validated env in `apps/backend/src/index.ts`**

Replace the file with:

```ts
import { serve } from '@hono/node-server';
import { env } from './env';
import { logger } from './lib/logger';
import { createServer } from './server';

const app = createServer();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, nodeEnv: env.NODE_ENV }, 'amana backend listening');
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/package.json apps/backend/src/env.ts apps/backend/src/index.ts apps/backend/tests/env.test.ts pnpm-lock.yaml
git commit -m "feat(backend): zod-validated env loader with sensible local defaults"
```

---

### Task 14: Add Drizzle ORM + Postgres connection (no schema yet)

**Files:**
- Create: `apps/backend/src/db/client.ts`
- Create: `apps/backend/drizzle.config.ts`
- Create: `apps/backend/src/db/migrations/0000_init.sql`
- Modify: `apps/backend/package.json` (add `drizzle-orm`, `drizzle-kit`, `postgres`)

- [ ] **Step 1: Add Drizzle dependencies**

```bash
pnpm --filter @amana/backend add drizzle-orm@0.34.1 postgres@3.4.4
pnpm --filter @amana/backend add -D drizzle-kit@0.25.0
```

- [ ] **Step 2: Write `apps/backend/src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';

const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient);

export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
```

- [ ] **Step 3: Write `apps/backend/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://amana:amana_dev_only@localhost:5432/amana_dev',
  },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 4: Create the schema directory placeholder**

```bash
mkdir -p apps/backend/src/db/schema
```

Then write `apps/backend/src/db/schema/.gitkeep`:
```
# Drizzle schema files land here in Sub-plan 2.
```

- [ ] **Step 5: Write the initial migration `apps/backend/src/db/migrations/0000_init.sql`**

```sql
-- Initial bootstrap migration. Enables required Postgres extensions only.
-- Domain schema lands in Sub-plan 2.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
```

- [ ] **Step 6: Add a script to apply migrations**

Add to `apps/backend/package.json` `scripts`:

```json
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 7: Bring Postgres up and apply the migration**

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
```
Expected: drizzle-kit reports `0000_init.sql` applied. (drizzle-kit also creates a `__drizzle_migrations` table.)

- [ ] **Step 8: Verify extensions are installed**

```bash
docker compose exec postgres psql -U amana -d amana_dev -c "SELECT extname FROM pg_extension ORDER BY extname;"
```
Expected output includes `pgcrypto`, `plpgsql`, `postgis`, `uuid-ossp`.

- [ ] **Step 9: Stop Postgres**

```bash
docker compose down
```

- [ ] **Step 10: Commit**

```bash
git add apps/backend/package.json apps/backend/src/db apps/backend/drizzle.config.ts pnpm-lock.yaml
git commit -m "feat(backend): drizzle ORM + postgres-js + initial migration enabling extensions"
```

---

### Task 15: Add Sentry error tracking (optional in dev, required in prod)

**Files:**
- Create: `apps/backend/src/lib/sentry.ts`
- Create: `apps/backend/src/middleware/error-handler.ts`
- Create test: `apps/backend/tests/error-handler.test.ts`
- Modify: `apps/backend/src/server.ts` (mount error handler)
- Modify: `apps/backend/package.json` (add `@sentry/node`)
- Modify: `apps/backend/src/index.ts` (init Sentry on boot)

- [ ] **Step 1: Add Sentry dep**

```bash
pnpm --filter @amana/backend add @sentry/node@8.34.0
```

- [ ] **Step 2: Write `apps/backend/src/lib/sentry.ts`**

```ts
import * as Sentry from '@sentry/node';
import { env } from '../env';
import { logger } from './logger';

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry disabled (no SENTRY_DSN configured)');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  logger.info({ environment: env.NODE_ENV }, 'Sentry initialised');
}

export { Sentry };
```

- [ ] **Step 3: Write `apps/backend/src/middleware/error-handler.ts`**

```ts
import type { ErrorHandler } from 'hono';
import { logger } from '../lib/logger';
import { Sentry } from '../lib/sentry';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') as string | undefined;
  logger.error({ err, requestId, path: c.req.path }, 'unhandled error');
  Sentry.captureException(err, { tags: { requestId } });
  return c.json({ error: 'internal_error', requestId }, 500);
};
```

- [ ] **Step 4: Write the failing test `apps/backend/tests/error-handler.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../src/middleware/error-handler';
import { requestId } from '../src/middleware/request-id';

describe('errorHandler', () => {
  it('returns 500 with error code and request id', async () => {
    const app = new Hono();
    app.use(requestId());
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.onError(errorHandler);
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; requestId: string };
    expect(body.error).toBe('internal_error');
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
```

- [ ] **Step 5: Wire the handler into `apps/backend/src/server.ts`**

Replace contents with:

```ts
import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { healthRoute } from './routes/health';

export function createServer(): Hono {
  const app = new Hono();
  app.use(requestId());
  app.route('/health', healthRoute);
  app.onError(errorHandler);
  return app;
}
```

- [ ] **Step 6: Initialise Sentry on boot in `apps/backend/src/index.ts`**

Replace contents with:

```ts
import { serve } from '@hono/node-server';
import { env } from './env';
import { initSentry } from './lib/sentry';
import { logger } from './lib/logger';
import { createServer } from './server';

initSentry();

const app = createServer();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, nodeEnv: env.NODE_ENV }, 'amana backend listening');
});
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @amana/backend test
```
Expected: `10 passed` (health × 2 + logger × 2 + request-id × 2 + env × 3 + error-handler × 1).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/package.json apps/backend/src/lib/sentry.ts apps/backend/src/middleware/error-handler.ts apps/backend/src/server.ts apps/backend/src/index.ts apps/backend/tests/error-handler.test.ts pnpm-lock.yaml
git commit -m "feat(backend): sentry init + central error handler returning request-id"
```

---

### Task 16: Bootstrap `apps/principal` (Expo + React Native)

**Files:**
- Create: `apps/principal/package.json`
- Create: `apps/principal/tsconfig.json`
- Create: `apps/principal/app.json`
- Create: `apps/principal/index.ts`
- Create: `apps/principal/App.tsx`
- Create: `apps/principal/src/screens/HealthCheck.tsx`
- Create: `apps/principal/README.md`

- [ ] **Step 1: Write `apps/principal/package.json`**

```json
{
  "name": "@amana/principal",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "build": "echo 'mobile builds via EAS — run: pnpm exec eas build --platform all' && exit 0",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "test": "echo 'mobile tests land in Sub-plan 6' && exit 0"
  },
  "dependencies": {
    "@amana/api-client": "workspace:*",
    "@amana/types": "workspace:*",
    "expo": "~51.0.39",
    "expo-status-bar": "~1.12.1",
    "react": "18.2.0",
    "react-native": "0.74.5"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@types/react": "~18.2.79",
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `apps/principal/tsconfig.json`**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-native"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `apps/principal/app.json`**

```json
{
  "expo": {
    "name": "Amana Principal",
    "slug": "amana-principal",
    "version": "0.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": { "bundleIdentifier": "com.amana.principal", "supportsTablet": false },
    "android": { "package": "com.amana.principal" },
    "platforms": ["ios", "android"]
  }
}
```

- [ ] **Step 4: Write `apps/principal/index.ts`**

```ts
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

- [ ] **Step 5: Write `apps/principal/src/screens/HealthCheck.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AmanaApiClient } from '@amana/api-client';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

type Status = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error'; message: string };

export function HealthCheck(): JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const client = new AmanaApiClient({ baseUrl: BACKEND_URL });
    client
      .health()
      .then((r) => setStatus({ kind: 'ok', version: r.version }))
      .catch((e: Error) => setStatus({ kind: 'error', message: e.message }));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Amana Principal — bootstrap smoke test</Text>
      <Text style={styles.subtitle}>Backend: {BACKEND_URL}</Text>
      {status.kind === 'loading' && <ActivityIndicator />}
      {status.kind === 'ok' && <Text style={styles.ok}>OK · backend version {status.version}</Text>}
      {status.kind === 'error' && <Text style={styles.err}>ERROR · {status.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#666' },
  ok: { fontSize: 16, color: '#0a7d24', fontWeight: '600' },
  err: { fontSize: 14, color: '#9a1d1d', textAlign: 'center' },
});
```

- [ ] **Step 6: Write `apps/principal/App.tsx`**

```tsx
import { StatusBar } from 'expo-status-bar';
import { HealthCheck } from './src/screens/HealthCheck';

export default function App(): JSX.Element {
  return (
    <>
      <StatusBar style="auto" />
      <HealthCheck />
    </>
  );
}
```

- [ ] **Step 7: Write `apps/principal/README.md`**

```markdown
# @amana/principal

Amana Principal mobile app (React Native via Expo).

## Run locally

In one terminal start the backend:
```bash
pnpm --filter @amana/backend dev
```

In another terminal:
```bash
pnpm --filter @amana/principal start
```

Press `a` (Android emulator), `i` (iOS simulator), or `w` (web) inside the Expo CLI prompt.

The bootstrap screen calls `GET /health` against the backend; you should see
"OK · backend version 0.0.0" within a second.
```

- [ ] **Step 8: Install + typecheck**

```bash
pnpm install
pnpm --filter @amana/principal typecheck
```
Expected: install completes; typecheck passes with zero errors.

- [ ] **Step 9: Commit**

```bash
git add apps/principal pnpm-lock.yaml
git commit -m "feat(principal): bootstrap expo react-native app with health-check screen"
```

---

### Task 17: Bootstrap `apps/agent` (Expo + React Native)

**Files:** mirror of `apps/principal` with different identifiers and a different smoke-test label. Steps abbreviated since the structure is identical.

- [ ] **Step 1: Write `apps/agent/package.json`**

```json
{
  "name": "@amana/agent",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "build": "echo 'mobile builds via EAS — run: pnpm exec eas build --platform all' && exit 0",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "test": "echo 'mobile tests land in Sub-plan 7' && exit 0"
  },
  "dependencies": {
    "@amana/api-client": "workspace:*",
    "@amana/types": "workspace:*",
    "expo": "~51.0.39",
    "expo-status-bar": "~1.12.1",
    "react": "18.2.0",
    "react-native": "0.74.5"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@types/react": "~18.2.79",
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `apps/agent/tsconfig.json`** (identical to principal):

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-native"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `apps/agent/app.json`**

```json
{
  "expo": {
    "name": "Amana Agent",
    "slug": "amana-agent",
    "version": "0.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": { "bundleIdentifier": "com.amana.agent", "supportsTablet": false },
    "android": { "package": "com.amana.agent" },
    "platforms": ["ios", "android"]
  }
}
```

- [ ] **Step 4: Write `apps/agent/index.ts`**

```ts
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

- [ ] **Step 5: Write `apps/agent/src/screens/HealthCheck.tsx`** (same as principal but the title says "Agent")

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AmanaApiClient } from '@amana/api-client';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

type Status = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error'; message: string };

export function HealthCheck(): JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const client = new AmanaApiClient({ baseUrl: BACKEND_URL });
    client
      .health()
      .then((r) => setStatus({ kind: 'ok', version: r.version }))
      .catch((e: Error) => setStatus({ kind: 'error', message: e.message }));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Amana Agent — bootstrap smoke test</Text>
      <Text style={styles.subtitle}>Backend: {BACKEND_URL}</Text>
      {status.kind === 'loading' && <ActivityIndicator />}
      {status.kind === 'ok' && <Text style={styles.ok}>OK · backend version {status.version}</Text>}
      {status.kind === 'error' && <Text style={styles.err}>ERROR · {status.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#666' },
  ok: { fontSize: 16, color: '#0a7d24', fontWeight: '600' },
  err: { fontSize: 14, color: '#9a1d1d', textAlign: 'center' },
});
```

- [ ] **Step 6: Write `apps/agent/App.tsx`**

```tsx
import { StatusBar } from 'expo-status-bar';
import { HealthCheck } from './src/screens/HealthCheck';

export default function App(): JSX.Element {
  return (
    <>
      <StatusBar style="auto" />
      <HealthCheck />
    </>
  );
}
```

- [ ] **Step 7: Write `apps/agent/README.md`**

```markdown
# @amana/agent

Amana Agent mobile app (React Native via Expo).

## Run locally

```bash
pnpm --filter @amana/backend dev
pnpm --filter @amana/agent start
```

The bootstrap screen hits `GET /health` and renders the result.
```

- [ ] **Step 8: Install + typecheck**

```bash
pnpm install
pnpm --filter @amana/agent typecheck
```
Expected: passes with zero errors.

- [ ] **Step 9: Commit**

```bash
git add apps/agent pnpm-lock.yaml
git commit -m "feat(agent): bootstrap expo react-native app with health-check screen"
```

---

### Task 18: Add `.env.example` and SOPS scaffold

**Files:**
- Create: `.env.example`
- Create: `.sops.yaml`
- Create: `secrets/.gitkeep`

- [ ] **Step 1: Write `.env.example`**

```bash
# Copy to .env and fill in. Never commit .env.
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Local Postgres (matches docker-compose.yml)
DATABASE_URL=postgres://amana:amana_dev_only@localhost:5432/amana_dev

# Sentry — optional in dev, required in staging/prod
SENTRY_DSN=

# Anchor (BaaS) — sandbox by default. Real keys live in encrypted secrets/.
ANCHOR_API_BASE_URL=https://api.sandbox.getanchor.co
ANCHOR_API_KEY=
```

- [ ] **Step 2: Write `.sops.yaml`**

```yaml
# Encrypts files under secrets/ with the team age key.
# Set up:
#   1. Install age:    https://github.com/FiloSottile/age
#   2. Install sops:   https://github.com/getsops/sops
#   3. Generate a key: age-keygen -o age.key
#   4. Replace the placeholder below with the public part of age.key.
#   5. Encrypt:        sops --encrypt --in-place secrets/<file>.env
creation_rules:
  - path_regex: secrets/.*\.env$
    encrypted_regex: ^.*$
    age: "AGE_PUBLIC_KEY_PLACEHOLDER_REPLACE_BEFORE_FIRST_REAL_SECRET"
```

- [ ] **Step 3: Create `secrets/.gitkeep` placeholder**

Write the file with content:
```
# Encrypted secrets (.env files) live here, encrypted via SOPS.
# Never commit plaintext secrets.
```

- [ ] **Step 4: Confirm `.gitignore` already excludes plain `.env`**

```bash
grep -E "^\.env" .gitignore
```
Expected: matches `.env` and possibly `.env.local`. If missing, append to `.gitignore`:

```
.env
.env.local
.env.*.local
```

- [ ] **Step 5: Commit**

```bash
git add .env.example .sops.yaml secrets/.gitkeep
git commit -m "chore: add env.example and sops scaffold for encrypted secrets"
```

---

### Task 19: Stub the Anchor BaaS adapter (config + types only)

**Files:**
- Create: `apps/backend/src/integrations/anchor/index.ts`
- Create: `apps/backend/src/integrations/anchor/sandbox.ts`

- [ ] **Step 1: Write `apps/backend/src/integrations/anchor/sandbox.ts`**

```ts
import { env } from '../../env';

export interface AnchorConfig {
  baseUrl: string;
  apiKey: string | undefined;
}

export const anchorConfig: AnchorConfig = {
  baseUrl: env.ANCHOR_API_BASE_URL,
  apiKey: env.ANCHOR_API_KEY,
};
```

- [ ] **Step 2: Write `apps/backend/src/integrations/anchor/index.ts`**

```ts
// Anchor BaaS adapter surface.
// The real implementation (circuit breaker, idempotency, retries, narration
// formatter, NIBSS name enquiry, NIP-out, phone lookup, webhook verification)
// lands in Sub-plan 2. This file only exists so import paths are stable.

export { anchorConfig, type AnchorConfig } from './sandbox';
```

- [ ] **Step 3: Verify nothing breaks**

```bash
pnpm --filter @amana/backend typecheck
pnpm --filter @amana/backend test
```
Expected: typecheck passes; `10 passed`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/integrations
git commit -m "feat(backend): stub anchor adapter surface (config only) for stable import paths"
```

---

### Task 20: Set up GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/CODEOWNERS`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

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
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.33.2

      - name: Setup Node
        uses: actions/setup-node@v4
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
```

- [ ] **Step 2: Write `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## What

<!-- One sentence describing the change. -->

## Why

<!-- The motivation, ticket link, or spec section being implemented. -->

## How verified

- [ ] `pnpm test` passes locally
- [ ] `pnpm typecheck` passes locally
- [ ] `pnpm exec biome check .` passes locally
- [ ] Manually exercised the change (describe how)

## Notes for reviewer

<!-- Anything tricky, intentional shortcuts, follow-ups. -->
```

- [ ] **Step 3: Write `.github/CODEOWNERS`**

```
# Default owners for everything.
*       @alex_

# Specific surfaces — adjust when the team grows.
/apps/backend/                  @alex_
/apps/principal/                @alex_
/apps/agent/                    @alex_
/packages/                      @alex_
/docs/superpowers/              @alex_
```

- [ ] **Step 4: Commit**

```bash
git add .github
git commit -m "ci: add github actions ci with postgis service + pr template + codeowners"
```

---

### Task 21: Write the five ADRs

**Files:**
- Create: `docs/adr/0001-monorepo-pnpm-turbo.md`
- Create: `docs/adr/0002-typescript-backend-hono.md`
- Create: `docs/adr/0003-react-native-expo.md`
- Create: `docs/adr/0004-postgres-drizzle.md`
- Create: `docs/adr/0005-aws-af-south.md`

- [ ] **Step 1: Write `docs/adr/0001-monorepo-pnpm-turbo.md`**

```markdown
# 1. Monorepo with pnpm + Turborepo

Date: 2026-05-03
Status: Accepted

## Context

We ship a TypeScript backend and two React Native apps that share types,
validation schemas, and an HTTP client. We need consistent versioning and a
single CI run that catches contract drift.

## Decision

Single repository organised as a pnpm workspace with Turborepo orchestrating
build/test/lint/typecheck across packages.

## Alternatives considered

- **Polyrepo (one repo per app/package).** Rejected — guarantees contract drift
  between mobile and backend, slows hiring (more CI configs to learn), and
  removes the option of atomic refactors that touch both sides.
- **npm + workspaces (no Turbo).** Rejected — Turbo's caching is meaningful at
  our planned ~5 packages and grows with team size.
- **Nx.** Plausible. Rejected for now because Turbo is closer to our team's
  scale (a few people) and is simpler to grok. Re-evaluate at 20+ packages.

## Consequences

Single CI run. Single `pnpm install`. One Biome / TypeScript config family.
Cost: contributors must understand the workspace layout.
```

- [ ] **Step 2: Write `docs/adr/0002-typescript-backend-hono.md`**

```markdown
# 2. TypeScript backend on Hono

Date: 2026-05-03
Status: Accepted

## Context

The backend serves the principal and agent apps over HTTPS, integrates with
Anchor (BaaS), runs background recon and notification jobs, and houses the
ledger / rule engine / bump / anomaly modules.

## Decision

TypeScript on Node.js 20+ with Hono as the HTTP framework.

## Alternatives considered

- **Go.** Better raw performance and concurrency, but smaller dev pool in
  Lagos and forces a second type system away from React Native. Re-evaluate if
  per-request latency becomes a bottleneck (current SLO p95 < 500 ms is
  comfortably reachable on Node).
- **Elixir / Phoenix.** Best fit for the bump workflow's stateful nature
  (OTP processes), but the Lagos hiring pool is too small.
- **Express / Fastify.** Both work. Hono picked for: smaller surface area,
  better TypeScript inference, edge-runtime portability if we ever want it,
  and trivial in-process testing via `app.request()`.

## Consequences

One language across backend and mobile. Strong typing end-to-end via shared
workspace packages. Cost: must enforce strict mode and keep build outputs
small (Hono helps).
```

- [ ] **Step 3: Write `docs/adr/0003-react-native-expo.md`**

```markdown
# 3. React Native via Expo for both mobile apps

Date: 2026-05-03
Status: Accepted

## Context

We ship two mobile apps (Principal + Agent), both iOS + Android. Need fast
iteration, OTA updates, and a single team capable of shipping both apps.

## Decision

React Native via Expo (managed workflow + EAS Build). Two Expo projects in the
monorepo (`apps/principal`, `apps/agent`) sharing the `@amana/api-client` and
`@amana/types` packages.

## Alternatives considered

- **Flutter.** Better default UX, but a separate Dart skillset and no type
  sharing with the TS backend.
- **Split native (Kotlin + Swift).** Best UX, double the team forever.
  Rejected at our scale.
- **React Native bare workflow.** Useful if we hit Expo limitations
  (e.g. NFC tag-write before Expo's NFC support catches up). We can eject
  per-app later if forced; not a one-way door.

## Consequences

One TypeScript codebase per app, sharing utilities across both. EAS Build
handles the iOS/Android signing and store-submission painful bits. Cost:
some native modules require Expo config plugins.
```

- [ ] **Step 4: Write `docs/adr/0004-postgres-drizzle.md`**

```markdown
# 4. Postgres 16 + PostGIS + Drizzle ORM

Date: 2026-05-03
Status: Accepted

## Context

The Amana backend stores a double-entry ledger, append-only audit log,
versioned rule sets, sub-wallets, and (per Decision #16) GPS coordinates for
ad-hoc transactions. We need ACID transactions, append-only enforcement
through DB roles, and a way to write the schema in TypeScript.

## Decision

Postgres 16 with the PostGIS extension. Drizzle ORM for schema-as-code and
type-safe queries. drizzle-kit for migrations. postgres-js as the driver.

## Alternatives considered

- **Prisma.** Mature, but heavier runtime and historically poor performance
  on complex queries; also a separate generated client step. Drizzle is
  closer to raw SQL when we want it.
- **TypeORM.** Older, decorator-based, less TypeScript-idiomatic.
- **Raw SQL via Kysely or pg-typed.** Plausible alternatives if Drizzle ever
  becomes a bottleneck. Drizzle gives us a slightly better type story today.
- **MySQL / MariaDB.** No technical reason to prefer over Postgres for our
  workload.

## Consequences

Schema lives in TypeScript files under `src/db/schema/`. Migrations are SQL
files under `src/db/migrations/` (drizzle-kit generates them from the
schema). We can drop into raw SQL whenever needed via the postgres-js client.
Cost: Drizzle is younger than Prisma; minor APIs may shift.
```

- [ ] **Step 5: Write `docs/adr/0005-aws-af-south.md`**

```markdown
# 5. AWS af-south (Cape Town) for initial hosting

Date: 2026-05-03
Status: Accepted (with parallel legal-review track)

## Context

We need low-latency hosting for Lagos users and storage that satisfies CBN
expectations on financial-data residency. CBN's stance on data residency for
non-bank fintechs is evolving; we need to start somewhere defensible without
blocking on legal certainty.

## Decision

Initial hosting on AWS af-south-1 (Cape Town) — the closest AWS region to
Lagos with full service support. Backend runs on ECS Fargate; database on
Aurora Postgres with PostGIS.

A parallel legal-review track confirms whether CBN requires Nigerian-resident
data for our specific BaaS-routed model. If yes, we migrate to a Nigerian
provider (e.g. Layer3, MainOne, Galaxy Backbone) before public launch.

## Alternatives considered

- **AWS eu-west-1 (Ireland).** Higher latency to Lagos (~120 ms vs ~80 ms).
  Likely worse data-residency posture too.
- **Local NG cloud (Layer3 / MainOne / Galaxy).** Best CBN posture, smaller
  managed-service surface, harder to hire ops talent for. Defaulting here
  too early would slow MVP.
- **Self-hosted on a Lagos colo.** Out of scope at our team size.

## Consequences

af-south is a real AWS region with most services we need (ECS, Aurora, S3,
CloudWatch, KMS, Secrets Manager). Cost: some newer AWS services lag in
af-south by months. Switch path to a Nigerian provider stays clean because
the backend uses standard SQL/Postgres and stateless container deploys.
```

- [ ] **Step 6: Commit**

```bash
git add docs/adr
git commit -m "docs: add ADRs 0001-0005 for monorepo, backend stack, mobile, db, hosting"
```

---

### Task 22: Write Anchor sandbox runbook (human-in-the-loop)

**Files:**
- Create: `docs/runbook/anchor-sandbox.md`

- [ ] **Step 1: Write `docs/runbook/anchor-sandbox.md`**

```markdown
# Anchor sandbox setup

The backend talks to Anchor (BaaS) via the adapter at
`apps/backend/src/integrations/anchor/`. For local dev we use Anchor's sandbox.

## What you need to do

1. Sign up for an Anchor account at https://www.getanchor.co.
2. From the Anchor dashboard, switch to the **Sandbox** environment.
3. Generate an API key under Settings → API Keys → Sandbox.
4. Note the sandbox API base URL (currently `https://api.sandbox.getanchor.co`).

## Wire it locally

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set in `.env`:

```
ANCHOR_API_BASE_URL=https://api.sandbox.getanchor.co
ANCHOR_API_KEY=<your sandbox key>
```

## Wire it in CI / staging / prod

Real keys live encrypted in `secrets/<env>.env`, decrypted via SOPS at deploy
time. Never commit plaintext keys.

## Verify

After Sub-plan 2 lands the real Anchor adapter, run:

```bash
pnpm --filter @amana/backend exec tsx scripts/anchor-smoke.ts
```

(That script doesn't exist yet — created in Sub-plan 2.)

## Contact

Anchor support is responsive on their developer Slack — invite link in the
Anchor dashboard.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook/anchor-sandbox.md
git commit -m "docs: anchor sandbox setup runbook"
```

---

### Task 23: Write the local-dev runbook

**Files:**
- Create: `docs/runbook/local-dev.md`
- Modify: `README.md` (point to the runbook)

- [ ] **Step 1: Write `docs/runbook/local-dev.md`**

```markdown
# Local development

## One-time setup

1. Install Node 20+ (use `nvm use` if you have nvm-windows).
2. Install pnpm 10+: `npm install -g pnpm@latest`.
3. Install Docker Desktop and start it.
4. Clone the repo and `cd amana`.
5. `pnpm install`
6. `cp .env.example .env`
7. (Optional) Get an Anchor sandbox key per `docs/runbook/anchor-sandbox.md`
   and add to `.env`.

## Daily loop

In one terminal:

```bash
docker compose up -d                              # starts Postgres
pnpm --filter @amana/backend db:migrate           # apply any new migrations
pnpm --filter @amana/backend dev                  # backend at http://localhost:3000
```

In a second terminal:

```bash
pnpm --filter @amana/principal start              # Expo for principal app
```

In a third terminal:

```bash
pnpm --filter @amana/agent start                  # Expo for agent app
```

## Run tests

```bash
pnpm test                  # all packages
pnpm --filter @amana/backend test
```

## Lint + format

```bash
pnpm exec biome check .             # check
pnpm exec biome check --write .     # auto-fix
```

## Stop everything

```bash
docker compose down
```

## Troubleshooting

- **Postgres won't start** — `docker compose down -v` to wipe the volume,
  then `docker compose up -d` again.
- **`@amana/...` not found** — re-run `pnpm install` at the repo root.
- **Expo can't reach the backend** — set `EXPO_PUBLIC_BACKEND_URL` to your
  machine's LAN IP (not `localhost`) when running on a physical device.
```

- [ ] **Step 2: Update `README.md` to point at the runbook**

Replace the current README contents with:

```markdown
# Amana

Phone-to-phone controlled-spend wallet for Nigeria.

A principal funds a master wallet and issues sub-wallets to N agents with real-time limits, category locks, time windows, and remote-or-present authorization. Phone-to-phone is between **principal and agent** — vendors are paid via standard NIP transfer.

**Two segments, one primitive:**
- **Households** — parents and school-going kids, heads-of-household and domestic staff, adult children supporting ageing parents.
- **Small businesses** — restaurant owners and kitchen staff, fleet owners and riders, retail managers, construction supervisors, field sales teams, property managers.

The spend pattern is structurally identical in both: principal funds, delegates within rules, controls + audits in real-time.

## Status

MVP design spec complete (2026-05-03). 18 decisions locked. Phase 0 implementation plan written; ready to execute.

- **Design spec:** `docs/superpowers/specs/2026-05-03-amana-design.md`
- **Locked decisions (18):** `docs/brainstorm/locked-decisions.md`
- **Brand brief:** `docs/brainstorm/brand.md`
- **Implementation plans:** `docs/superpowers/plans/`
- **Architecture decision records:** `docs/adr/`

## Develop

See `docs/runbook/local-dev.md`.

## Workflow

1. Brainstorm → 18 locked decisions ✅
2. Design spec ✅
3. Sub-plan 1 — Phase 0 bootstrap (this plan)
4. Sub-plans 2–8 — backend core, vendor capture, notifications, mobile apps, hardening
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbook/local-dev.md README.md
git commit -m "docs: local-dev runbook + updated README pointing at runbook"
```

---

### Task 24: End-to-end smoke test (manual checklist)

**Files:** none. This is a verification task — produces no code, only confirms the bootstrap holds together.

- [ ] **Step 1: Fresh clone simulation — start from a clean state**

```bash
docker compose down -v
rm -rf node_modules apps/*/node_modules packages/*/node_modules .turbo
pnpm install
```
Expected: clean install completes; lockfile is up-to-date (no warnings about a stale lockfile).

- [ ] **Step 2: Start Postgres and apply migrations**

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
```
Expected: Postgres becomes ready; migration `0000_init.sql` applies; the `__drizzle_migrations` table exists.

- [ ] **Step 3: Build everything**

```bash
pnpm build
```
Expected: turbo builds all packages and apps with zero errors. The summary at the end shows all tasks `[FULL TURBO]` cached or `successful`.

- [ ] **Step 4: Lint everything**

```bash
pnpm exec biome check .
```
Expected: zero errors. Warnings are OK at this stage.

- [ ] **Step 5: Typecheck everything**

```bash
pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 6: Run all tests**

```bash
pnpm test
```
Expected: `10 passed` from `@amana/backend` (health × 2 + env × 3 + logger × 2 + request-id × 2 + error-handler × 1). The two mobile apps print their `echo` placeholder and exit 0. The two type-only packages print their `echo` placeholder and exit 0.

- [ ] **Step 7: Start the backend**

In one terminal:
```bash
pnpm --filter @amana/backend dev
```
Expected: structured-log line `INFO: amana backend listening`.

- [ ] **Step 8: Hit /health**

```bash
curl -i http://localhost:3000/health
```
Expected:
- HTTP 200
- header `x-request-id: <uuid>`
- body `{"status":"ok","version":"0.0.0"}`

- [ ] **Step 9: Start the Principal app and verify it talks to the backend**

In a second terminal:
```bash
pnpm --filter @amana/principal start
```
Press `w` to open in a web browser (fastest smoke test). Expected: page renders, shows "Amana Principal — bootstrap smoke test", and within ~1 s shows "OK · backend version 0.0.0".

Stop with Ctrl+C.

- [ ] **Step 10: Start the Agent app and verify it talks to the backend**

```bash
pnpm --filter @amana/agent start
```
Press `w`. Expected: same shape, with "Amana Agent — bootstrap smoke test" and "OK · backend version 0.0.0".

Stop with Ctrl+C.

- [ ] **Step 11: Stop the backend and Postgres**

In the backend terminal: Ctrl+C.

```bash
docker compose down
```

- [ ] **Step 12: Push the branch and verify CI is green**

```bash
git push origin main
```

Open GitHub Actions and confirm the workflow `ci` passes. If it fails, fix
forward (don't disable steps) — typically a node-version or pnpm-version skew.

- [ ] **Step 13: Tag the bootstrap completion**

```bash
git tag -a v0.0.1-bootstrap -m "Phase 0 bootstrap complete"
git push origin v0.0.1-bootstrap
```

- [ ] **Step 14: Hand off to Sub-plan 2**

Phase 0 is complete when all 13 prior steps in this task pass on a clean
checkout. Open Sub-plan 2 (`Identity + Wallet Ledger + BaaS Adapter`) when
ready.

---

## Plan complete

When all 24 tasks land green:
- Monorepo is bootstrapped, all packages build, all tests pass, CI is green.
- Both mobile apps render a smoke-test screen that successfully calls the
  backend `/health` endpoint.
- ADRs document every architectural choice.
- Local-dev runbook is comprehensive enough that a new engineer can clone +
  run within 30 minutes.

**Next:** Sub-plan 2 — `Identity + Wallet Ledger + BaaS Adapter` — written separately.
