---
name: eas-build
description: Trigger, monitor, and download EAS builds for the Amana Principal or Agent apps. Handles the NODE_TLS_REJECT_UNAUTHORIZED=0 workaround, profile selection, and build status polling.
---

## Apps and profiles

| App | Directory | Android package | iOS bundle |
|-----|-----------|-----------------|------------|
| principal | `apps/principal/` | `com.amana.principal` | `com.amana.principal` |
| agent | `apps/agent/` | `com.amana.agent` | `com.amana.agent` |

| Profile | What it produces | Backend URL | Use for |
|---------|-----------------|-------------|---------|
| `development` | Dev client (internal) | localhost / dev | Local Expo dev client |
| `preview` | APK (internal distribution) | whatever is in `.env` | QA / device testing |
| `production` | AAB (Google Play) | `https://api.amana-ng.com` | Store release |

## TLS issue on Windows

EAS CLI has historically had TLS verification failures on Windows. The root cause is usually Node.js not trusting the Windows certificate store by default.

**Preferred fix** — tell Node.js to use the Windows cert store (one-time, no security downside):

```bash
# In your shell profile or before running eas
export NODE_OPTIONS=--use-openssl-ca
# or set the env var permanently in Windows
```

Alternatively, set `NODE_EXTRA_CA_CERTS` to point to the Expo CA bundle if you have it.

**Last resort only** — `NODE_TLS_REJECT_UNAUTHORIZED=0` disables all TLS certificate verification for the Node.js process. This allows MITM attacks on your connection to Expo's build servers. Use it only if the preferred fix doesn't work, never in CI, and never on shared/production machines.

```bash
# ⚠️ Insecure — use only if NODE_OPTIONS fix fails
NODE_TLS_REJECT_UNAUTHORIZED=0 eas build ...
```

## Step 1 — Determine app and profile

If the user didn't specify, ask:
- Which app? (`principal` / `agent` / `both`)
- Which profile? (`preview` is the default for QA; use `production` only for store releases)
- Which platform? (`android` / `ios` / `all`; default `android` since iOS requires Apple credentials)

## Step 2 — Trigger the build

Run from the **repo root** using the `--profile` flag. EAS resolves the app directory from the workspace:

```bash
# Principal — preview APK
cd apps/principal && eas build --platform android --profile preview --non-interactive

# Agent — preview APK
cd apps/agent && eas build --platform android --profile preview --non-interactive

# Production (store build) — confirm with user before triggering
cd apps/principal && eas build --platform android --profile production --non-interactive
```

If TLS errors occur, try `NODE_OPTIONS=--use-openssl-ca` first (see TLS issue section above).

`--non-interactive` is required — EAS prompts for keystore confirmation in interactive mode which will hang.

## Step 3 — Get the build ID

The command output includes a line like:
```
Build details: https://expo.dev/accounts/amana/projects/amana-principal/builds/<build-id>
```

Extract the build ID for status polling.

## Step 4 — Poll build status (optional)

```bash
eas build:view <build-id>
```

Or list recent builds:
```bash
eas build:list --limit 3 --platform android --non-interactive
```

Builds typically take 5–12 minutes. Don't poll more than once every 3 minutes.

## Step 5 — Download (preview APK only)

```bash
eas build:download --build-id <build-id> --output ./build.apk
```

Production AABs are submitted directly to Google Play — don't download them.

## Production release checklist

Before triggering a `production` build, confirm with the user:
- [ ] `EXPO_PUBLIC_BACKEND_URL` in eas.json points to `https://api.amana-ng.com` (it does by default)
- [ ] Version bump done (eas.json has `autoIncrement: true` so build number increments automatically)
- [ ] All feature work merged to main
- [ ] Backend deployed and healthy (`curl https://api.amana-ng.com/health`)

After a successful production build, submit to Google Play internal track:
```bash
cd apps/principal && eas submit --platform android --profile production --latest --non-interactive
```
(uses `google-play-service-account.json` at the repo root)

## Common errors

| Error | Fix |
|-------|-----|
| `ECONNRESET` / TLS error | Try `NODE_OPTIONS=--use-openssl-ca` first; see TLS section above |
| `Keystore not found` | Run without `--non-interactive` once to let EAS generate a keystore, then re-add the flag |
| `pnpm: command not found` | EAS uses the `pnpm` version from `eas.json` (`10.33.2`) — ensure it matches `packageManager` in root `package.json` |
| Build queued for >15 min | EAS free tier queues builds; this is normal |
