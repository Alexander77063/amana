# Go-live checklist

Pre-production readiness for Amana. The **code** is feature-complete and the security
audit is closed; what remains is environment configuration, one live-integration
verification, one gate that blocks printing vendor codes (§6), and a couple of cosmetic
cleanups. Work top-down.

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
| `ADMIN_API_KEY` | ✅ enforced | ≥32 chars; `x-admin-api-key` on `/retailers` ops routes. Unset = every admin route 401s (fails closed) |
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

## 6. Vendor-code pre-distribution gate ⚠️ (HSTS + preload + DNS — all three)

**Scope: this gate blocks PRINTING vendor codes, not launch.** The rest of Amana can go live
with none of it done. What it blocks is putting `pay.amana.ng/v/AMNV-XXXXX-XXXXX` on a sticker
in a shop window — because a printed sticker cannot be recalled, and the cost of getting this
wrong rises the moment the first one is in a window rather than at go-live.

Full reasoning in
[`vendor-registry.md` → "PRE-DISTRIBUTION GATE"](./vendor-registry.md). The short version: the
public landing page is the **first Amana surface a human reaches by typing a hostname**. Every
previous client was a native app pinned to an `https://` base URL. A person who types the
sticker as printed — no scheme — gets an HTTP first hop, and on market Wi-Fi an on-path
attacker owns that hop and serves an identical page with a **different account ending**. The
page's one job is letting a payer confirm they are paying the right shop, and that hop
defeats it. `force_https = true` in `fly.toml` is **a 301 that travels in cleartext**; it is
not HSTS.

| # | Must be true before any code is printed | Kind of work |
|---|---|---|
| 1 | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` served **app-wide** — every response, not just `/v` | **Engineering.** There is no HSTS and no app-wide security-header middleware in the codebase today; this is a `server.ts` change, not a config flip |
| 2 | `amana.ng` submitted to the HSTS preload list **and accepted** into shipped browser lists | Ops + a wait |
| 3 | `pay.amana.ng` DNS record — CNAME to the Fly app, plus a Fly cert for the hostname | Ops |

**Item 2 is the load-bearing one; item 3 alone is not the gate.** An HSTS header can only
protect a hostname the browser has already visited over HTTPS. It cannot protect the
*first-ever* hit to a hostname — which is exactly and only what a printed sticker creates,
every time someone reads one. Preload is what covers that first hit.

**Pre-flight before submitting item 2:** `includeSubDomains` commits every `amana.ng`
subdomain to HTTPS-only in shipped browsers, and de-listing propagates on browser-release
timescales. Confirm no subdomain needs plain HTTP first.

**Until this closes:** SP-V3 still ships and is testable. `GET /vendors/code/:code` needs no
public hostname, the agent scanner accepts the bare `AMNV-…` form, and the page is reachable
on the API hostname. Only printing is blocked.

Nothing in code can enforce this. The API returns a bare `publicCode` and never a URL, so the
`pay.amana.ng/v/…` wrapper is added by whoever prepares the print run — this checklist item is
the only control.

## 7. Cosmetic cleanups

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
