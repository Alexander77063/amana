# Go-live checklist

**The single place go-live state is recorded.** If it is not ticked here, it is not done. If you do
it, tick it here — a thing done and unrecorded gets done again, or worse, gets assumed.

## How to use this

- `- [ ]` open · `- [x]` done. **Tick it in the same change that does the work**, not later.
- When you tick something non-obvious, say **who and when** in the line. "Done" with no date is a
  claim; "done 2026-09-02 by Alex" is a record.
- **Do not delete an item when it is done** — tick it. The reasoning under each one is why it exists,
  and deleting it invites someone to re-litigate it in six months.
- Sub-bullets under an item are the *why*. Read them before deciding an item is unnecessary.

## Where we actually are — 2026-08-27

**Production has never served a transaction.** `amana-api` is deployed (v69) and crash-looping:

```
Error: Missing required production environment variables: ANCHOR_API_KEY, ANCHOR_WEBHOOK_SECRET
```

That is `env.ts` doing its job — failing fast rather than serving a half-configured money API. Two
secrets stand between here and a booting app. Everything else below is either done, or waiting on
that.

| | |
|---|---|
| **Blocking everything** | §1 — the two Anchor secrets |
| **Blocks printing vendor codes only** | §6 — HSTS preload + DNS (code side is done) |
| **Blocks a real merchant claiming** | §8 — legal review + a support channel that exists |
| **Blocks a real *user* signing up** | §8b — **there are no principal or agent terms at all**, and agents are location-monitored with no notice |
| **Migrations** | local DB at `0040`; **production at `0038`** until the next successful deploy |

## 1. Secrets & environment (per Fly app: staging + prod)

Set as **Fly secrets** (`fly secrets set …`), never committed. The backend **refuses to boot** in
`NODE_ENV=production` if any prod-essential secret is missing (`src/env.ts` — fail-fast).

- [x] `JWT_SECRET` — deployed
- [x] `FIELD_ENCRYPTION_KEY` — generated + deployed 2026-08-27
- [x] `ADMIN_API_KEY` — generated + deployed 2026-08-27
- [x] `TERMII_API_KEY` / `TERMII_SENDER_ID` — deployed
- [x] `DATABASE_URL` — repaired 2026-08-27. Two separate faults: the **direct** Supabase host
      publishes only an AAAA record (IPv4 resolvers get `ENOTFOUND`), and the password contained a
      character that breaks URL parsing. Use the Supavisor **session** pooler on **5432**, and
      percent-encode the password — `#`, `?`, `/` all produce `TypeError: Invalid URL`; `%` gives
      `URI malformed`.
- [ ] **`ANCHOR_API_KEY`** — ⚠️ **blocking.** Sandbox key while `ANCHOR_API_BASE_URL` points at
      sandbox (§2); usually self-serve from the Anchor dashboard rather than issued on request.
- [ ] **`ANCHOR_WEBHOOK_SECRET`** — ⚠️ **blocking.** HMAC verify on `/webhooks/anchor`. A wrong
      value is worse than a missing one: signature verification silently rejects every inbound
      `transfer.completed` and `virtual_account.credited`, which is lost settlement events — real
      money. Never guess it.
- [ ] `SENTRY_DSN` — recommended
- [ ] `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — only if media is used (S3 `af-south-1`)
- [x] `DEV_OTP_BYPASS_CODE` **unset** — enforced at boot; production throws if it is set

Reference (what each is and why it is enforced):

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

- [ ] **At real-money go-live:** flip `ANCHOR_API_BASE_URL` to the Anchor production base URL
      and swap `ANCHOR_API_KEY` to a production key. Nothing in code prevents prod-against-
sandbox (by design, for now) — this line is the gate, so make it a release-checklist item.

## 3. Termii sender ID

- [ ] Register `TERMII_SENDER_ID` (defaults to `Amana`) with Termii before sending real OTP SMS,
      or messages are rejected / silently dropped. (See `project-termii-registration`.)

## 4. Mobile build config (EAS)

- [ ] Set **`EXPO_PUBLIC_BACKEND_URL`** in both apps' EAS build profiles (`eas.json`) for
      staging/prod. `apps/{principal,agent}/src/lib/api.ts` default to `http://localhost:3000`, so
      without it a shipped build points at the phone itself.

## 5. Verify the live Anchor integration ⚠️ (the real gate)

- [ ] **Run `test:sandbox` against the real Anchor sandbox.** Blocked on the `ANCHOR_API_KEY` in
      §1.

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

This is the one substantive *integration* item between "code complete" and "integration
verified" — §6 is a separate, non-competing gate on a different thing. It also:
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

**All three must hold. Do them in this order** — the preload scanner reads the live response, not
the repo, so submitting before item 1 is deployed and verified wastes the wait.

- [x] **1. Serve HSTS app-wide** — `max-age=63072000; includeSubDomains; preload`, on *every*
      response, not just `/v`. Built 2026-08-27 (PR #48): `middleware/security-headers.ts`, mounted
      first in `createServer()`. **Not live yet** — ships on the next deploy, which is blocked on §1.
- [ ] **1b. Verify it on the live host** once deployed, before doing item 2:
      ```bash
      curl -sI https://amana-api.fly.dev/health | grep -i strict-transport-security
      # expect: strict-transport-security: max-age=63072000; includeSubDomains; preload
      ```
- [ ] **2. `amana.ng` submitted to the HSTS preload list AND accepted** into shipped browser lists.
      Ops plus a wait, and **the long pole** — start it the moment 1b passes. Submission is not
      acceptance; the domain has to actually appear in shipped lists.
- [ ] **3. `pay.amana.ng` DNS record** — CNAME to the Fly app, plus a Fly cert for the hostname.

**Verifying item 1 once deployed** — the preload scanner reads the live HTTPS response, not the
repo:

```bash
curl -sI https://amana-api.fly.dev/health | grep -i strict-transport-security
# expect: strict-transport-security: max-age=63072000; includeSubDomains; preload
```

Two properties of the implementation worth knowing before anyone changes it. The value is a
**constant, not an env var**: preload refuses a `max-age` under a year and refuses a policy missing
`includeSubDomains` or `preload`, so a knob would let a deploy silently fall out of eligibility long
after acceptance — and de-listing propagates on browser-release timescales. And the header is
written **after** `await next()`, onto whatever response came back, because `errorHandler` builds a
brand-new `Response` and an unregistered route never reaches a handler at all; those 404s and 500s
are exactly what a mistyped sticker produces.

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

- [x] **Migration `meta/0020_snapshot.json` — verified harmless, no action.** `0020` is a
  hand-written migration (like `0005`/`0007`/`0013`), so the drizzle snapshot chain skips it
  (`0021.prevId → 0019.id`) and never had a `0020` snapshot. The *latest* snapshot (`0022`)
  correctly reflects the live schema (it includes `anchor_customer_id` + `sent_at`), so
  `drizzle-kit check` passes ("Everything's fine") and `drizzle-kit generate` reports "No
  schema changes." drizzle only reads the latest snapshot for `generate` and the `.sql` files
  for `migrate`, so the missing intermediate file is inert. Fabricating one would force
  rewriting `0021.prevId` and risk corrupting a currently-consistent chain — left as-is by
  design.
- [x] Stale README labels corrected: the `sticker` module is implemented (not a "stub"), and `/households` does real Anchor provisioning (no "placeholder" virtual account).

## 8. Legal & consent — blocks the first real merchant claim

The claim rail now has a lawful basis in code (PR #54) and a document behind it (PR #55). What is
left cannot be enforced by a test.

- [x] **Two separate consents recorded**, append-only — `service_terms` (required) and
      `lender_introduction` (optional, default off, independently revocable). Bundling them would
      void the consent under NDPA 2023, so refusing the optional one costs the merchant nothing.
- [x] **Terms text exists** at `docs/legal/vendor-claim-terms/2026-08-27.v1.md`, bound to
      `CURRENT_TERMS_VERSION` by a mutation-verified test — bump the constant without writing the
      document and the suite fails naming the missing path.
- [ ] ⚠️ **Legal review of the terms text by a Nigerian data-protection lawyer.** The document is a
      code-accurate engineering draft and says so at the top. If review changes the meaning, **bump
      the version** rather than editing v1 in place — a merchant who accepted v1 has not accepted v2.
- [ ] ⚠️ **Fill the support channel placeholder.** §1 of the terms text still literally reads
      `[SUPPORT CHANNEL — TO BE FILLED IN BEFORE LAUNCH]`, and §7 points at it as the route for
      *every* data-subject right, including withdrawal. A merchant reading it today would be told to
      contact a placeholder. **No test can catch this** — it is a human check.
- [ ] **Brief support on consent withdrawal.** Until self-serve exists, ops recording it via
      `POST /vendors-admin/vendors/:id/consents/revoke` is the *only* withdrawal channel, and NDPA
      requires withdrawal to be as easy as granting. Support must action it without argument.
- [ ] **Build self-serve consent withdrawal.** The real fix for the item above. There is no merchant
      session on this rail today — the claim OTP is spent at claim time — so this needs a small
      authenticated merchant surface.
- [ ] **Decide the by-product policy** before anyone acts on `PRICING.md` §8. In particular, selling
      "is this account a known vendor" **is** the aggregate PRE-LAUNCH GATE 3 was closed to protect;
      if it is ever pursued, record the decision next to that gate in `vendor-claim.md` so the two
      are read together.

### 8b. Principal and agent terms — **neither exists**

Checked 2026-08-27: `docs/legal/` contains **one** document, the vendor one. There is no terms text,
privacy notice or consent capture anywhere in the principal or agent flow — not at OTP signup, not
at household creation, not at pairing.

- [ ] ⚠️ **Principal terms + privacy notice.** A principal supplies **BVN and NIN**
      (`identity.ts`), encrypted at rest, for CBN KYC tiering. Regulated identity data collected
      with no notice and no recorded basis.
- [ ] ⚠️ **Agent terms + privacy notice — the harder document, and the more urgent one.** Three
      things make it harder than the principal's, and each changes the lawful basis:
      - **Agents are frequently children.** Under NDPA a child cannot give valid consent; a parent
        or guardian consents for them. The product's premise is parents issuing sub-wallets to kids,
        so this is the normal case, not an edge one.
      - **Agents who are staff cannot freely consent either.** Consent given to an employer is not
        *freely given*, so for staff the basis must be contract or legitimate interest — one
        document covering two different bases for two populations.
      - **Agents are monitored, and nothing currently tells them.** `transactions.geolocation` is a
        PostGIS point captured on a spend and shown to the principal on the transaction detail. A
        teenager or a shop assistant whose location is recorded without notice is the most serious
        disclosure gap in the product, and the one that would read worst in a complaint.
- [ ] **Decide who accepts on an agent's behalf, and record it.** If a guardian consents for a
      child, that is a fact about a *specific* pairing and belongs in the data — the same shape as
      `vendor_consents`, not a checkbox in an app that nobody can later evidence.
- [ ] **Tell the agent what the principal can see.** Independent of the legal document: spend
      location, amounts, vendor, category, and any attached photo. This is a product decision as
      much as a legal one — the pitch is "trusted but bounded", and covert monitoring is a different
      product from the one the brand promises.

**Reuse the mechanism, not just the idea.** `vendor_consents` is purpose-scoped, append-only and
versioned; the same table shape works for principals and agents, and building a second, different
consent store would be the failure `PRICING.md` §8.1 warns about in a different costume.

## 9. First-deploy verification (once §1 is unblocked)

Do these in order the first time the app actually boots. None can be done before then.

- [ ] `fly status --app amana-api` — machines running, health check passing rather than `1 warning`
- [ ] `fly logs` shows no `Missing required production environment variables`
- [ ] Migrations `0039` and `0040` applied — production is at `0038` until this deploy
- [ ] `curl -sI https://amana-api.fly.dev/health` returns 200 **and** the HSTS header (§6 item 1b)
- [ ] The registry begins accumulating: after the first settled payout, a row exists in
      `vendor_observations`. It is empty today, which is why `PRICING.md` §8's by-products are
      hypotheses rather than assets.

## Standing guarantees (already done — do not re-litigate)

- **All four claim-rail gates closed 2026-08-27** — GATE 1 cross-purpose OTP cancellation (PR #43,
  needed migration `0038` the runbook had not predicted), GATE 2 attacker-arrives-first race
  (PR #49, closed by making exclusivity wait for proof rather than by the fix the runbook proposed),
  GATE 3 registry-membership oracle (PR #50, closed by reordering the flow so the account is named
  at `/verify`, which also deleted the `no_attempt` kind and its timing channel). Details in
  `vendor-claim.md`.
- Security audit closed (PRs #3–#15): authz on money routes, BVN/NIN at-rest encryption, OTP/pairing atomic claims, in-flight spend limits under advisory lock, webhook dedupe + dead-letter, rate limiting, PII log redaction, limits-only funds model. **One exception, added 2026-08-26: the transport-security gate in §6.** App-wide HSTS and HSTS preload were never in scope of PRs #3–#15 — every client at the time was a native app pinned to an `https://` base URL, and there was no surface a human reached by typing a hostname. SP-V3's public landing page is one. §6 is open; this bullet is not a reason to skip it.
- Double-entry ledger invariants enforced in app + DB (immutable postings/audit).
- Coverage gate (lines/statements 92, functions 90, branches 80) enforced in CI; full backend suite green.
- No stubs, fake-data paths, committed secrets, or TODO debt in production source.
