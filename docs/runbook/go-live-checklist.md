# Go-live checklist

Pre-production readiness for Amana. The **code** is feature-complete and the security
audit is closed; what remains is environment configuration, one live-integration
verification, and a couple of cosmetic cleanups. Work top-down.

## 1. Secrets & environment (per Fly app: staging + prod)

Set as **Fly secrets** (`fly secrets set …`), never committed. The backend now
**refuses to boot** in `NODE_ENV=production` if any prod-essential secret is missing
(`src/env.ts` — fail-fast, alongside `JWT_SECRET` / `FIELD_ENCRYPTION_KEY`):

| Var | Required in prod | Notes |
|-----|------------------|-------|
| `JWT_SECRET` | ✅ enforced | ≥32 chars; dev fallback only outside prod |
| `FIELD_ENCRYPTION_KEY` | ✅ enforced | 64 hex chars (32 bytes); at-rest BVN/NIN crypto |
| `ANCHOR_API_KEY` | ✅ enforced | Anchor API key (sandbox key until real-money go-live) |
| `ANCHOR_WEBHOOK_SECRET` | ✅ enforced | HMAC verify on `/webhooks/anchor`; missing → 503 = lost money |
| `TERMII_API_KEY` | ✅ enforced | OTP SMS; missing → no logins |
| `SENTRY_DSN` | recommended | error reporting |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | if media used | S3 `af-south-1` |
| `DEV_OTP_BYPASS_CODE` | **must be UNSET** | enforced: boot throws if set in prod |

## 2. Anchor environment — the one deliberate footgun

`fly.toml` **and** `fly.staging.toml` currently set
`ANCHOR_API_BASE_URL = 'https://api.sandbox.getanchor.co'` with
`NODE_ENV = 'production'`. This is the intended **pre-production posture**: production
*infrastructure* running against Anchor's *sandbox* (no real money).

**At real-money go-live:** flip `ANCHOR_API_BASE_URL` to the Anchor production base URL
and swap `ANCHOR_API_KEY` to a production key. Nothing in code prevents prod-against-
sandbox (by design, for now) — this line is the gate, so make it a release-checklist item.

## 3. Termii sender ID

`TERMII_SENDER_ID` defaults to `Amana`. Register it with Termii before sending real OTP
SMS, or messages will be rejected / silently dropped. (See `project-termii-registration`.)

## 4. Mobile build config (EAS)

`apps/{principal,agent}/src/lib/api.ts` default the backend URL to
`http://localhost:3000`. Set **`EXPO_PUBLIC_BACKEND_URL`** in both apps' EAS build
profiles (`eas.json`) for staging/prod, or shipped builds point at localhost.

## 5. Verify the live Anchor integration ⚠️ (the real gate)

The Anchor adapter is fully wired and covered by **mocked** tests, but **has never run
against the real sandbox** — `tests/sandbox/anchor-e2e.test.ts` is `skipIf(!ANCHOR_API_KEY)`.
Before pre-production, run it for real (the backend must be up on `BACKEND_URL`):

```bash
ANCHOR_API_KEY=<sandbox key> pnpm --filter @amana/backend dev   # in one shell
ANCHOR_API_KEY=<sandbox key> pnpm --filter @amana/backend test:sandbox
```

The suite now has **two** cases:
1. **Provisioning + topup + KYC** — real `createCustomer` + `provisionVirtualAccount`, then simulated `virtual_account.credited` → settled topup, then `kyc.approved` → tier bump.
2. **Outbound spend (the real `/transfers` call)** — principal-direct `intent` → `evaluate` → `send` (hits live Anchor), then a simulated `transfer.completed` drives our settlement → `settled`.

This is the one substantive item between "code complete" and "integration verified." It also:
- confirms the `AnchorCreateCustomerRequest.fullName` contract against live Anchor (design §6 flagged this to verify);
- surfaces Anchor's real **insufficient-balance** error signature → unblocks mapping it to a friendly "household needs to top up" message (the open M4 follow-up).

**Prerequisite for case 2:** the real `/transfers` call moves (sandbox) money, so the
provisioned master account must actually be funded on Anchor's side — our simulated topup
credits *our ledger only*, not Anchor's sandbox balance. If the send returns `FAILED`
(insufficient balance) the test fails with a pointer to this note. Fund the sandbox account
via the Anchor dashboard / a real inbound test transfer to the NUBAN, and/or override the
destination with env vars: `SANDBOX_VENDOR_BANK_CODE`, `SANDBOX_VENDOR_ACCOUNT`,
`SANDBOX_VENDOR_NAME`, `SANDBOX_SPEND_KOBO`.

## 6. Cosmetic cleanups

- **Migration `meta/0020_snapshot.json` — verified harmless, no action.** `0020` is a
  hand-written migration (like `0005`/`0007`/`0013`), so the drizzle snapshot chain skips it
  (`0021.prevId → 0019.id`) and never had a `0020` snapshot. The *latest* snapshot (`0022`)
  correctly reflects the live schema (it includes `anchor_customer_id` + `sent_at`), so
  `drizzle-kit check` passes ("Everything's fine") and `drizzle-kit generate` reports "No
  schema changes." drizzle only reads the latest snapshot for `generate` and the `.sql` files
  for `migrate`, so the missing intermediate file is inert. Fabricating one would force
  rewriting `0021.prevId` and risk corrupting a currently-consistent chain — left as-is by
  design.
- Stale README labels now corrected: the `sticker` module is implemented (not a "stub"), and `/households` does real Anchor provisioning (no "placeholder" virtual account).

## Standing guarantees (already done — do not re-litigate)

- Security audit closed (PRs #3–#15): authz on money routes, BVN/NIN at-rest encryption, OTP/pairing atomic claims, in-flight spend limits under advisory lock, webhook dedupe + dead-letter, rate limiting, PII log redaction, limits-only funds model.
- Double-entry ledger invariants enforced in app + DB (immutable postings/audit).
- Coverage gate (lines/statements 92, functions 90, branches 80) enforced in CI; full backend suite green.
- No stubs, fake-data paths, committed secrets, or TODO debt in production source.
