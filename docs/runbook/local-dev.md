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
