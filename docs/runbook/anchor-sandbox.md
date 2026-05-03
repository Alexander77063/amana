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
