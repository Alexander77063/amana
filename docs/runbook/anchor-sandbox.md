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

## Business KYB (marketplace retailers)

Marketplace retailers are **business** customers, not personal ones. `createBusinessCustomer`
POSTs the flat internal contract to `/business-customers` (mirroring `createCustomer`) and the
verdict arrives asynchronously as a `kyb.approved` / `kyb.rejected` webhook.

Two things to know when testing against sandbox:

- The call is idempotency-cached under its **own scope** (`anchor.business_customer`), keyed
  `kyb:<retailerId>`. Re-submitting KYB for the same retailer will not create a second business
  customer — clear `idempotency_keys` if you deliberately want a fresh one in sandbox.
- `anchor_business_customer_id` is UNIQUE on `retailers`, because the `kyb.*` webhook resolves the
  retailer by it. Reusing one sandbox business customer across two seeded retailers will fail on
  insert rather than silently making the webhook ambiguous.

Full flow and the ops runbook: `docs/runbook/retailer-onboarding.md`.
