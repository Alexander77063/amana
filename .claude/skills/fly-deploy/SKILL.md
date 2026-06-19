---
name: fly-deploy
description: Deploy the Amana backend to Fly.io (app name amana-api). Handles pre-flight checks, deploy, log monitoring, and health verification.
---

## App details

- **App name**: `amana-api`
- **Health endpoint**: `https://api.amana-ng.com/health`
- **flyctl path**: `$env:USERPROFILE\.fly\bin\flyctl.exe` (also available as `fly` or `flyctl` if on PATH)
- **Deploy method**: `--remote-only` (no local Docker build — Fly builds in the cloud)

Use `$env:USERPROFILE\.fly\bin\flyctl.exe` if `fly` / `flyctl` aren't found on PATH.

## Pre-flight checks

Before deploying, confirm:
1. **Auth**: `fly auth whoami` — if it fails, the user needs to run `fly auth login` interactively
2. **No uncommitted schema changes**: warn if `apps/backend/src/db/migrations/` has untracked files — migrations must ship with the build
3. **Backend typechecks**: `pnpm --filter @amana/backend typecheck` — don't deploy broken code

## Deploy

```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" deploy --remote-only --app amana-api
```

This streams build logs. Wait for `v{N} deployed successfully` before proceeding.

## Post-deploy verification

**1. Check machine status:**
```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" status --app amana-api
```
All machines should show `started`.

**2. Verify health endpoint:**
```powershell
Invoke-WebRequest -Uri "https://api.amana-ng.com/health" -UseBasicParsing -TimeoutSec 30 | Select-Object StatusCode, Content
```
Expect `200` with `{"status":"ok"}`.

**3. If unhealthy — tail logs:**
```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" logs --app amana-api --no-tail
```
Common failure patterns:
- `ERR_PACKAGE` / `Cannot find` → missing dist file; check the Dockerfile copies `dist/`
- `Error: DATABASE_URL` → secret not set; run `fly secrets list --app amana-api`
- Machine keeps restarting → OOM or crash loop; check `fly machine status <id> --app amana-api`

## Secrets management

List secrets (values hidden):
```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" secrets list --app amana-api
```

Set a secret (triggers automatic redeploy):
```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" secrets set KEY="value" --app amana-api
```

**Required secrets**: `DATABASE_URL`, `JWT_SECRET`, `TERMII_API_KEY`, `TERMII_SENDER_ID`, `ANCHOR_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SENTRY_DSN`

## Rollback

If the deploy is bad, immediately roll back to the previous version:
```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" releases --app amana-api   # find previous version N
& "$env:USERPROFILE\.fly\bin\flyctl.exe" deploy --image registry.fly.io/amana-api:deployment-{N} --app amana-api
```
