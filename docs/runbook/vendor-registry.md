# Vendor registry (SP-V1: passive registry + shadow mode; SP-V3: the code and the page)

> **SP-V3 landed 2026-08-26.** Everything below the enforcement sections is unchanged and
> still correct — the registry is still a measurement instrument, and an `observed` category
> still never enforces. Two sections were added at the end: **"The Amana Vendor Code"**, which
> documents the two surfaces a minted code is now readable on, and the
> **PRE-DISTRIBUTION GATE**, which blocks printing any code until HSTS, preload and DNS are
> all in place.

A passive registry of merchant bank accounts, built from settled transactions, that gives
the rule engine an authoritative category answer to *compare against* — not yet to enforce
— the app-supplied one. Read this before touching anything under `modules/vendors`, before
querying `vendor_observations`/`vendors` directly, or before flipping
`households.vendor_category_enforced` for a household. Companion to the design spec,
[`2026-08-25-vendor-registry-design.md`](../superpowers/specs/2026-08-25-vendor-registry-design.md)
— the spec is the binding source for *why*; this is the *how* for an operator.

## What it is

Two tables, one job each:

- **`vendor_observations`** — the raw material. One row per `(bank_code, account_number,
  household_id)` triple (that's the primary key), written at settlement and incremented
  every time a household's agent or principal settles a payment to that account. Holds a
  running `settled_count`, a per-household `category_counts` jsonb tally (self-attested,
  e.g. `{"food": 12, "transport": 1}`), and first/last-seen timestamps.
  **This table is exposed by no route, and must not acquire one.** It is a payment graph
  over Nigerian bank accounts — who pays whom, how often — and the promotion threshold
  plus the retention sweep (below) are the only things standing between it and a directory
  of private individuals. Do not add a `GET` handler for it, admin-gated or otherwise,
  without revisiting spec §10 first.
- **`vendors`** — the registry proper. A row exists only once an account clears the
  promotion threshold (below). Holds `status` (`observed` / `claimed` / `suspended`),
  `category` + `categorySource` (`observed` / `claimed` / `ops`),
  `categoryHouseholdCount`, and (from SP-V2 on) `publicCode`. Any future read surface is
  built on this table; SP-V1 adds none.

## The sweep

One cron job, `vendor-registry-sweep`, schedule `17 * * * *` — hourly, at 17 minutes past
the hour, offset from the recon-sweep's every-fifth-minute cadence (which already covers
`:00`) so the two full-table scans don't stack. Entry point
`apps/backend/src/cron/jobs/vendor-registry-sweep.job.ts`; logic in
`modules/vendors/vendor-registry.service.ts` → `sweep()`.

Three phases, run in this order, deliberately **not** wrapped in one transaction — each
phase is independently idempotent, so a crash between phases costs at most one hour before
the next pass re-derives everything from `vendor_observations`:

1. **Promote.** Any `(bank_code, account_number)` paid by `COUNT(*) >=
   VENDOR_REGISTRY_MIN_HOUSEHOLDS` distinct households in `vendor_observations` gets a
   `vendors` row (`onConflictDoNothing` on the account, so re-running the sweep promotes
   nothing twice and never rewrites the original `promotedHouseholdCount`).
2. **Categorise.** Every vendor whose `categorySource = 'observed'` gets its consensus
   recomputed from that account's observation rows. Each household contributes exactly one
   vote — its own single most-tagged category, regardless of how many times it paid the
   vendor — so a frequent customer can never outvote everyone else (D-V8,
   `docs/brainstorm/locked-decisions.md`). A `claimed` or `ops` category is never touched by
   this pass.
3. **Prune.** Observations with no activity in `VENDOR_OBSERVATION_RETENTION_DAYS`
   (default 180) are deleted — **unless** the account has already been promoted (see
   Retention, below).

**A vendor is never promoted and categorised in the same sweep.**
`VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS` (default 8) is set above
`VENDOR_REGISTRY_MIN_HOUSEHOLDS` (default 5) on purpose: being listed is a weaker claim
than being categorised. A freshly promoted vendor always starts with `category = NULL`
and only picks one up on a later pass, once an 8th household has voted.

## Env vars

All defined in `apps/backend/src/env.ts`. All have defaults; none require a code change to
retune, only an env update and a restart (the one exception — enforcement per household —
needs neither; see below).

| Var | Default | Raising it | Lowering it |
|---|---|---|---|
| `VENDOR_CATEGORY_ENFORCE_DEFAULT` | off — only the literal string `'true'` turns it on | Every household without an explicit `vendor_category_enforced` row starts enforcing the registry category instead of the app-supplied one | N/A — off is the floor |
| `VENDOR_REGISTRY_MIN_HOUSEHOLDS` | `5` | Fewer accounts get listed; each one is a stronger public-facing signal | More accounts get listed, including thinner-traffic ones, weakening the NDPR justification for treating a listed account as a public merchant |
| `VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS` | `8` | Fewer vendors get any category; the ones that do are backed by more votes | More vendors get categorised sooner, on thinner evidence |
| `VENDOR_REGISTRY_CONSENSUS_RATIO` | `0.6` | Category is set less often — needs a stronger majority, so ties and near-ties stay `NULL` | Category is set more easily, tolerating a weaker plurality |
| `VENDOR_OBSERVATION_RETENTION_DAYS` | `180` | Sub-threshold accounts are forgotten sooner (better privacy), but a slow-building legitimate vendor has less runway to reach 5 households before its history resets | Sub-threshold observations survive longer, giving borderline vendors more time to reach the threshold, at a privacy cost |
| `VENDOR_SENSITIVE_CATEGORIES` | `pharmacy,clinic,health,alcohol,gambling,religious,legal` | Removing a category from this list lets it be set by observed consensus — a decision that needs the D-V8 privacy reasoning re-applied, not a config tweak | Adding one moves it to claim-or-ops-only |

## Reading the shadow data

Every evaluation where the registry's answer differs from the app-supplied category, and
that difference would change the decision, is logged to `audit_log` with
`action = 'vendor.category_shadow'`. The query an operator actually runs:

```sql
SELECT payload_json ->> 'categorySource'   AS category_source,
       payload_json ->> 'registryCategory' AS registry_category,
       payload_json ->> 'appCategory'      AS app_category,
       COUNT(*)                            AS n
FROM audit_log
WHERE action = 'vendor.category_shadow'
  AND occurred_at > now() - interval '30 days'
GROUP BY 1, 2, 3
ORDER BY n DESC;
```

`audit_log`'s timestamp column is `occurred_at`, not `created_at` (`db/schema/audit.ts`) —
check before adapting this query for a different action.

**Read `category_source` first, and weight the rows by it.** Only `claimed` and `ops` rows
describe a change that switching enforcement on would actually make — those are the two
sources D-V7 allows to be enforced at all. An `observed` row is the registry disagreeing
in a way it is **never** allowed to act on, however strong the consensus behind it (D-V7).
Counting `observed` rows as evidence for switching enforcement on overstates the case,
usually by a lot: SP-V1 ships no claim rail, so `category_source` is `observed` for every
row this query can return today. The honest read of SP-V1 shadow data is "the registry
logged N disagreements, none of them actionable yet" — useful for judging whether the
claim rail (SP-V2) is worth building, but zero evidence for flipping enforcement on
anywhere right now.

## Switching enforcement on for one household

**See also:** [`vendor-claim.md` → "The enforcement switch"](./vendor-claim.md) for the
`POST /vendors-admin/households/:id/enforcement` route that now wraps the SQL below —
this section still owns the reasoning; that one adds the API surface.

The only supported way to start enforcing the registry category is per household, by
hand:

```sql
UPDATE households SET vendor_category_enforced = TRUE WHERE id = '<household-uuid>';
```

No deploy and no restart — the enforcement check inside `lifecycleService.evaluate` reads
this column, and `VENDOR_CATEGORY_ENFORCE_DEFAULT`, fresh on every transaction intent.

`households.vendor_category_enforced` is **three-state**, and the states are not
interchangeable:

| Value | Meaning |
|---|---|
| `TRUE` | This household enforces the registry category, regardless of `VENDOR_CATEGORY_ENFORCE_DEFAULT`. |
| `FALSE` | This household **never** enforces the registry category, regardless of `VENDOR_CATEGORY_ENFORCE_DEFAULT` — an explicit, sticky opt-out. |
| `NULL` (the default for every existing household) | **Inherit.** This household follows whatever `VENDOR_CATEGORY_ENFORCE_DEFAULT` says *today*, including if it changes later. |

Setting `FALSE` and setting `NULL` are different commitments, and mixing them up either
strands a household mid-rollout or silently re-exposes one that asked out.
`NULL` means "ride the global default" — the household is opted into the rollout and will
start enforcing the moment the global default flips on, with no further action. `FALSE`
means "not this household, ever, until someone explicitly changes it back" — an override
that survives a global flip. Use `FALSE` for a household that has asked out or is the
subject of a support case; leave a household at `NULL` (or never touch its row) to have it
ride the global rollout.

To switch a household back off:

```sql
UPDATE households SET vendor_category_enforced = FALSE WHERE id = '<household-uuid>';
```

and to hand it back to the global default (not the same thing as `FALSE`, per above):

```sql
UPDATE households SET vendor_category_enforced = NULL WHERE id = '<household-uuid>';
```

## Why observed categories never enforce

`vendorCategoryResolver.resolve` (`modules/vendors/vendor-category-resolver.service.ts`)
sets `enforceable: vendor.categorySource !== 'observed'` — an observed category is
returned for shadow logging only, and is never allowed to drive a decision, even for a
household with enforcement on and even at a 100% consensus ratio. This is D-V7, and it is
deliberate YAGNI: an inferred category is one aggregate guess assembled from self-attested
household data, and the shadow log above is precisely the mechanism built to tell us, with
real numbers, whether that guess is trustworthy enough to promote to authoritative.
Deciding now would mean deciding without the measurement this whole sub-project exists to
produce.

What would have to change: SP-V2 ships the claim rail, at which point
`category_source = 'claimed'` starts appearing in real volume and the shadow query above
stops returning only non-actionable rows. Revisiting D-V7 to let a sufficiently strong
observed consensus enforce is named as an open question in the spec (§14.4) — it is not
blocked architecturally, only by the absence, so far, of evidence.

## Retention

Sweep phase 3 deletes `vendor_observations` rows with `last_seen_at` older than
`VENDOR_OBSERVATION_RETENTION_DAYS` (default 180) — but only for accounts with no matching
`vendors` row. An account that never reaches the 5-household threshold is forgotten: the
ad-hoc tradesman from decision #16, paid by one or two households, ages out and leaves no
trace.

**A promoted vendor's observations are never pruned.** Once an account is in `vendors`,
its `vendor_observations` rows are read on every subsequent sweep by the categorisation
pass (phase 2) — deleting them would make a promoted vendor's category regress to `NULL`
the next time consensus needed recomputing. Promotion, in effect, exempts an account from
retention permanently. That is acceptable because a promoted vendor is, by construction of
the threshold, a public-facing merchant rather than one of the private individuals
retention exists to protect.

## The Amana Vendor Code (SP-V3)

A claimed vendor's code, minted by the claim rail (SP-V2), is now **payable**: the Amana
apps resolve it into a pre-filled confirm screen, and any phone camera opens it into a page
that says which business it belongs to. Read [`vendor-claim.md`](./vendor-claim.md) first
for how a vendor earns a code; this section is what happens once a payer points a camera at
one.

### The format, and what a scanner will actually see

`AMNV-XXXXX-XXXXX` — the `AMNV` prefix plus two five-symbol groups, minted by
`mintPrefixedCode('AMNV')` (`lib/crockford.ts`) from Crockford base32 with `I`, `L`, `O` and
`U` removed. 32^10 ≈ 1.1e15 codes; the `UNIQUE` constraint on `vendors.public_code` is the
authoritative dedup at write time.

**Two payload forms both scan, and only one of them is what the API emits.** The claim rail
returns the bare code (`vendor-claim.service.ts` → `{ kind: 'claimed', publicCode,
displayName }`); nothing in the backend ever builds a URL. The `https://pay.amana.ng/v/<code>`
form is a **printing convention** — what goes on the sticker so an ordinary camera app has
somewhere to land. The only place that hostname appears in shipped code is the agent
scanner's `CODE_URL_RE` (`apps/agent/src/lib/vendor-code.ts`). Nothing in the system can
refuse to print a sticker, which is why the gate below is written down rather than enforced.

`parseScannedPayload` decides which endpoint a scanned payload goes to, on **shape**, never
by trying one and falling back — a fallback would fire a paid partner call on every
mis-scanned QR in the market. Anything unrecognised falls through to the NQR branch, whose
decoder returns a clean `BAD_INPUT` for garbage.

**The host regex is anchored, and it must stay anchored.** `CODE_URL_RE` is
`^https?://pay\.amana\.ng/v/([^/?#\s]{1,64})/?(?:[?#].*)?$` — a substring or `includes` check
would read `pay.amana.ng.evil.com`, `evil.com/pay.amana.ng/v/…` and `pay.amana.ng@evil.com`
as ours, and the entire job of that branch is deciding which of our endpoints to trust a
stranger's QR with. All three lookalikes are pinned in
`apps/agent/src/lib/vendor-code.test.ts`.

Codes are **case-insensitive and glyph-forgiving on input**: `normalizeCrockford` upper-cases
and folds `I`/`L`→`1`, `O`→`0` inside `vendorsRepo.findByPublicCode`. `U` is deliberately
*not* folded — it is excluded from the alphabet with no digit to fold into, so a `U` is a
code character that cannot exist and must MISS (404), not be coerced into a hit. Both route
regexes accept the full alphanumeric set for exactly this reason; excluding I/L/O/U at the
edge would 400 the transcription errors the alphabet was chosen to absorb.

### `GET /vendors/code/:code?subWalletId=…` — the in-app pay path

Authenticated (`jwtAuth`), then authorized by identity against the sub-wallet
(`assertSubWalletAccess`) exactly as every sibling vendor read is. On success it returns the
same `ResolvedVendorResponse` shape as `/name-enquiry`, `/phone-lookup`, `/sticker/:uuid` and
`/nqr-decode`, with `source: 'vendor_code'` and `vendorId` + `category` populated — the only
path that populates them.

**A NIBSS name enquiry runs on every single scan.** The stored `displayName` is never what
the payer is shown: an account can be closed, reassigned or renamed long after the sticker
was printed, and the name on the confirm screen is the payer's only defence against paying
the wrong shop. If NIBSS is unreachable the resolution fails rather than falling back to the
stored name.

| Status | `error` | What happened |
|---|---|---|
| `200` | — | Resolved. `accountName` is fresh from NIBSS, not the stored `displayName` |
| `400` | `validation_error` | The code failed the structural regex, or `subWalletId` is missing / not a UUID |
| `401` | `missing_bearer` / `invalid_token` / `session_*` | No or unusable access token — `jwtAuth`, ahead of the handler |
| `403` | `forbidden` | The sub-wallet is not this user's — `assertSubWalletAccess`, never the JWT role claim |
| `404` | `NOT_FOUND` | No such code, **or** the row exists but is `observed` — nobody has proven they own that account |
| `409` | `VENDOR_ACCOUNT_GONE` | The code is real; NIBSS no longer knows the bank account behind it |
| `410` | `VENDOR_SUSPENDED` | The code is real and the vendor is suspended |
| `429` | `rate_limited` | The per-account Anchor budget below. Carries `Retry-After` and `retryAfterSeconds` |
| `502` | `VENDOR_ENQUIRY_FAILED` | The enquiry failed for a reason that is neither "account gone" nor "partner down" — a 429/401/403/422 upstream |
| `503` | `PARTNER_DOWN` | Anchor is down, or the circuit breaker is open |

The `: 400` rung at the end of the ladder in `routes/vendors.ts` is a **fail-safe, not a
rung** — `vendorCodeLookupService` re-maps `NOT_FOUND`→`VENDOR_ACCOUNT_GONE` and
`BAD_INPUT`→`VENDOR_ENQUIRY_FAILED` before returning, so nothing the vendor branch can
produce reaches it. Do not count it when reading the ladder, and do not delete it either.

None of the failures carry a `detail`. `BAD_INPUT`'s message is built as `Anchor <status>` —
our banking partner named, with its exact upstream status — which is free reconnaissance for
a caller and a probing oracle once someone maps inputs to upstream codes. It goes to the log
instead.

### `GET /v/:code` — the public landing page

Unauthenticated by necessity: it is opened by whoever points a phone camera at a shop window.
Served by the same Hono app (`routes/vendor-page.ts`, mounted at `/v` in `server.ts` **above**
the catch-all `/` router, or it would inherit that router's `jwtAuth` and 401 every camera).

It shows only what the shop already displays publicly — its name, and the **last four digits**
of the account on its own POS sticker. Never the full number. Every response is
self-contained HTML with no external script, stylesheet, font or image;
`Cache-Control: no-store`; `noindex,nofollow`; and a CSP of `default-src 'none'` with
`style-src` pinned to the SHA-256 hash of the one stylesheet actually served.

**No NIBSS enquiry happens here, and none may be added.** An unauthenticated endpoint that
triggers a paid partner call is a financial denial-of-service, and that call runs on the same
circuit breaker as real spend — anyone with a photographed sticker could take payments down.
The consequence is that the name on this page can be stale, and that is the correct trade:
**this page identifies a business, it does not authorise a payment.** The pay path
re-verifies against NIBSS every time.

| Status | Content type | Page |
|---|---|---|
| `200` | `text/html` | Business name, "Verified on Amana", `Account ending ••••NNNN` |
| `400` | `text/html` | "That is not an Amana code" — the code failed the structural regex |
| `404` | `text/html` | "That code was not recognised" — unknown code, or an `observed` row carrying one |
| `410` | `text/html` | "This code is no longer active" — the vendor is suspended |
| `429` | `application/json` | `{"error":"rate_limited","retryAfterSeconds":N}` — see the known edges below |

**Neither dead-end page echoes the requested code back**, and the 404 and 410 are
deliberately distinguishable: a suspended vendor keeps its `publicCode`, so "this code was
real and is now dead" is a different fact from "this code never existed", and the payer
standing in the shop is the person who needs to know which. That leaks nothing — at 32^10 the
only way to hold a well-formed code is for a vendor to have handed it to you.

### Why the two ladders differ

Two independent reasons, and they are worth keeping apart.

**The authenticated endpoint splits failures the claim rail deliberately collapses.** On
`/vendor-claim/*` an unauthenticated stranger is probing whether a given bank account is in
the registry, so every outcome has to look alike. Here the caller is an authenticated user
who has physically scanned a code in a shop: they already know the shop exists, there is no
aggregate left to protect, and collapsing the statuses would leave a real payer with no idea
why their scan failed. Note that the same fact gets different statuses on the two rails on
purpose — a suspended vendor is `409` on the claim rail (a **mutation** conflicting with
resource state) and `410` here (a **read** whose subject is simply gone).

**The page's ladder is shorter for a structural reason, not a disclosure one.** `409`, `502`
and `503` cannot occur on `/v/:code` at all, because that handler runs no name enquiry —
there is no partner call to fail. The three failure statuses the page *does* return map
one-for-one onto the pay path's `400` / `404` / `410`: **one condition, one status, across
both surfaces.**

### Suspending a compromised code

`POST /vendors-admin/vendors/:id/suspend` (see
[`vendor-claim.md` → "Suspending a vendor"](./vendor-claim.md)). Both surfaces answer `410`
**immediately** — `vendorCodeLookupService` returns `VENDOR_SUSPENDED` on the pay path and the
page returns its "no longer active" page — and the page's `Cache-Control: no-store` is what
makes "immediately" true rather than "within the TTL". That is the whole reason the page is
uncached: suspension is a safety control, and a cached page keeps advertising a live business
for as long as its max-age says.

Both surfaces use an **allow-list with an exhaustive `never` guard** over `vendorStatusEnum`,
not `status === 'suspended' ? … : payable`. A fourth enum member added later fails to compile
in both places until someone decides which side of the line it falls on — rather than
silently becoming payable and stamped "Verified on Amana".

### The two new rate-limit env vars

Both in `apps/backend/src/env.ts`, both windowed by `RATE_LIMIT_WINDOW_SECONDS` (default
900s). They exist as separate constants because they bound genuinely different things.

| Var | Default | Key | What it bounds |
|---|---|---|---|
| `RATE_LIMIT_VENDOR_PAGE_PER_IP` | `600` per 900s (40/min) | client IP | Postgres load from `/v/*` |
| `RATE_LIMIT_VENDOR_ANCHOR_PER_ACTOR` | `60` per 900s | authenticated user id | The **vendor module's** paid Anchor name-enquiry calls, on its four `/vendors/*` paths only — not an account's total partner spend (see below) |

**The page limiter is load protection, not enumeration defence.** At 32^10 nothing is being
guessed; it is there so a sticker photographed off a shop window cannot be replayed into
unbounded database load. It is keyed on IP because there is no actor to key on — and under
Nigerian carrier-grade NAT one bucket is shared by every subscriber behind a single
MTN/Airtel/Glo egress address, not one payer. That is why it sits an order of magnitude above
the auth limits: at the auth surface's 60 a busy market day would 429 real customers standing
in real shops. **Raise this before lowering it** — the cost of a false positive is a payment
that does not happen.

**The Anchor limiter is per account, and it is ONE middleware instance across four paths**
(`/code/*`, `/name-enquiry`, `/phone-lookup`, `/nqr-decode`), so all four share a single
bucket. Four separate buckets would let one account spend 4x by rotating between the paths.

**It bounds those four paths, NOT an account's total partner spend.** An earlier version of
this section said the latter, and of the code comment too; both were false.
`apps/backend/src/routes/vas.ts` mounts `jwtAuth()` and **no limiter**, and three of its
handlers are pure reads straight into `anchorAdapterSingleton`:

| Path | Anchor call | Limiter |
|---|---|---|
| `GET /vas/billers` | `listBillers` | none |
| `GET /vas/billers/:billerId/products` | `listProducts` | none |
| `GET /vas/validate` | `validateCustomer` | none |

So an actor who exhausts the 60-call vendor bucket can switch to `GET /vas/validate` and keep
buying partner calls against the same process-global circuit breaker. **This is known and is
not closed by widening the vendor limiter** — a catalogue read and a NIBSS name enquiry want
different bucket sizes, and choosing VAS's is its own change with its own numbers.

The remaining unlimited authenticated paths to that breaker — `POST /vas/purchase`,
`POST /households`, and the nip-out send on `routes/transactions.ts` — are left alone for a
different reason: each is self-bounding (a wallet debit, one virtual account per household),
so none is free to spin the way a GET is.
`/nqr-decode` belongs on the list because the `nqr` branch runs a name enquiry to confirm the
decoded account against NIBSS rather than trust the QR's own tag 59; it was excluded once on
the stated grounds that it does not reach Anchor, which was simply false. `/recents` and
`/sticker/:uuid` stay out, verified rather than assumed — neither reaches Anchor at any depth.

It is keyed per account rather than per IP for the same CGNAT reason, plus one the page
limiter cannot escape: **an IP key does not bound a global resource.** Per-IP × per-process ×
N Fly machines is unbounded in aggregate; a per-account key at least bounds what any one
account can spend, and a stranger cannot open an account per scan. The limiter is registered
inside `vendorsRoute` after `.use(jwtAuth())`, because the app-level limiters in
`attachRateLimiters` run before `app.route('/vendors', …)` and `c.get('actor')` is still unset
there.

Known and accepted: the limiter runs ahead of the handler, so a 404 or a malformed code
spends the same allowance as a real enquiry. Counting only requests that actually reached
Anchor is the right change when this moves to Redis; the fixed-window store cannot express it
today.

### Known edges on `/v/*` — verified, not inferred

Each of these was probed against a real `createServer()`, not read off the source.

- **A `429` on `/v/*` carries none of the page's security headers, and is JSON.** The limiter
  is registered app-level in `attachRateLimiters`, which runs *before* `app.route('/v', …)`,
  so the router's own `securityHeaders` middleware never executes. Observed: no
  `Content-Security-Policy`, no `X-Content-Type-Options`, no `Cache-Control`; body
  `{"error":"rate_limited","retryAfterSeconds":893}` with a `Retry-After` header. Low
  consequence for a bare JSON error served with an explicit content type, and worth knowing
  before you go hunting for a missing CSP.
- **`/v/` with an empty segment answers `401`, not the "not an Amana code" page.** `/v/`,
  `/v` and any method other than `GET`/`HEAD` on `/v/:code` match no handler in
  `vendorPageRoute` and fall through to the catch-all `/` router, which applies `jwtAuth` —
  so the body is
  `{"error":"missing_bearer"}`. **Operators will meet this one**, because it looks like an
  auth failure on a page that has no auth. (The security headers *are* present on that 401:
  the router's `.use('*')` ran before the fall-through. It is the body that is wrong, not the
  headers.)
- **`HEAD /v/:code` is handled.** Hono 4.6.5 dispatches HEAD through the GET handler and
  returns `new Response(null, …)` (`hono/dist/hono-base.js:172`), so a HEAD gets the correct
  status and the full header set with a zero-length body. Verified: HEAD on an unknown code
  returned `404`, `text/html`, CSP present, body length 0 — identical to the GET minus the
  body.

### What SP-V3 did NOT ship — `apps/principal` has no vendor capture flow

**The agent app only.** The plan described "mirroring" the scan changes into the principal
app; there was nothing to mirror. `apps/principal/src/screens/` contains no
`CaptureMethodScreen`, no `NQRScanScreen` and no `ConfirmScreen`; `apps/principal/src/nav/`
is `AuthStack` / `MainStack` / `RootNavigator` with no `PayStack`; and `expo-camera` is a
dependency of `apps/agent` alone. Adding the vendor-code branch there would have meant
building direct master-wallet spend end to end — the client half of decision #17, which has
never been built — not adding a branch to an existing screen.

So: **a principal cannot scan an Amana Vendor Code, and could not scan an NQR either.** Do
not assume parity between the two apps on any capture path.
[`docs/business/APP-FLOW.md`](../business/APP-FLOW.md) §2.5 describes a principal
direct-spend flow that exists on the server and not in the app; it is now marked as such.

## PRE-DISTRIBUTION GATE — HSTS, preload, and the DNS record

**No Amana Vendor Code may be printed for distribution until all three of the items below
hold.** This is a gate on *printing*, not on launch, and the distinction is the whole point:
a printed sticker in a shop window cannot be recalled. Everything else on this page can be
fixed with a deploy.

### Why a printed code is different from everything Amana has shipped

Every previous Amana client was a native app pinned to an `https://` base URL. This page is
the first surface a human reaches **by typing a hostname**. A shopkeeper prints
`pay.amana.ng/v/AMNV-XXXXX-XXXXX` in a window, and a person who types that — as printed,
without a scheme — gets an HTTP first hop. On market Wi-Fi an on-path attacker owns that hop
and serves their own page: same layout, same "Verified on Amana" badge, a **different account
ending**. The single job this page has is letting a payer confirm they are paying the right
shop, and a plaintext first hop subverts exactly that. `Referrer-Policy`, `frame-ancestors`
and the hashed CSP do nothing about it — they are all delivered *by the response the attacker
replaced*.

`fly.toml` and `fly.staging.toml` set `force_https = true`. That is **a 301 that travels in
cleartext**, which the attacker simply does not send. It is not HSTS and it is not a
substitute for it.

> **Updated 2026-08-27.** The paragraph that stood here said grepping this repo for
> `strict-transport` or `hsts` returned nothing, and that there was no app-wide security-header
> middleware to hang it on. Both were true when written and are now false: item 1 below is built.
> `middleware/security-headers.ts` serves the header on every response and is mounted first in
> `createServer()`. Items 2 and 3 are untouched, so **the gate is still closed.**

### The three items

1. ✅ **BUILT 2026-08-27** — `Strict-Transport-Security: max-age=63072000; includeSubDomains;
   preload` served app-wide, on every response from the API rather than only on `/v`.
   `middleware/security-headers.ts`, mounted first in `createServer()`; covered by
   `tests/middleware/security-headers.test.ts`, which pins the 404, the 500 and the 401 as well as
   the happy path, since those are what a mistyped sticker actually produces. **Not yet live** —
   it ships on the next deploy, which is blocked on the Anchor keys, so confirm it on the real
   host before submitting item 2. (The sub-plan called the landing page's only external dependency
   "a DNS record… an ops step in Task 7's runbook, not an engineering one". That was true of DNS
   and false of the gate as a whole.)
2. **`amana.ng` submitted to the HSTS preload list *and accepted*.** Not merely submitted —
   the domain has to actually appear in the shipped browser lists.
3. **The `pay.amana.ng` DNS record** — a CNAME to the Fly app, plus a Fly certificate for
   that hostname.

**Preload is the load-bearing item, and the reason DNS alone is not the gate.** A
`Strict-Transport-Security` header can only protect a hostname the browser has *already
visited over HTTPS*. It cannot protect the first-ever hit to a hostname — which is precisely
and exclusively what a printed sticker creates, every single time someone reads one. A payer
who has never opened `pay.amana.ng` before is the normal case here, not the edge case. Only
preload covers that first hit.

### Before you submit the preload entry

`includeSubDomains` on `amana.ng` commits **every** subdomain of `amana.ng` to HTTPS-only in
every shipped browser, and removal from the preload list propagates on browser-release
timescales — months, not a deploy. Confirm first that no `amana.ng` subdomain (marketing, a
status page, a partner callback, anything an ops runbook curls) needs plain HTTP, now or in
the foreseeable rollout. That irreversibility is why this is a gate with a pre-flight rather
than a checklist tick.

### Until the gate closes

The code still works **in the apps**: `GET /vendors/code/:code` needs no DNS record and no
public hostname, and the agent scanner accepts the bare `AMNV-…` form as well as the URL. The
public page is reachable on the API hostname. So SP-V3 is shippable and testable today; what
is blocked is **printing**, and only printing.

Nothing in the codebase can enforce this. The API emits a bare code and never a URL, so the
sticker's `pay.amana.ng/v/…` wrapper is added by whoever prepares the print run. This section
is the control.

## Follow-ups — what shipped since, and what is still deferred

**Shipped:**

- **The claim rail shipped (SP-V2).** Before it did, every registry category was
  `category_source = 'observed'` and no household could meaningfully turn enforcement on.
  `claimed` rows now exist, so the shadow query above can return actionable rows — see
  [`vendor-claim.md`](./vendor-claim.md).
- **The code and the scan path shipped (SP-V3)** — see "The Amana Vendor Code", above.
  `vendors.publicCode` is written only by `claim()`, atomically with `status = 'claimed'`, so
  it stays `NULL` for every `observed` row.

**Still deferred:**

- **Randomised promotion threshold** (spec §10.2) — a defence against a membership-
  inference attack on promotion timing. Deliberately not built in v1 (the sybil cost is
  already high via KYC, there is no public vendor feed, and the payoff is negligible);
  revisit if a public directory, a real-time vendor feed, or cheap household creation ever
  ships.
- **`VENDOR_SENSITIVE_CATEGORIES`'s default list** is a starting guess (spec §14.3), and
  **its stated precondition has already been crossed unmet.** This bullet used to read
  "review it against the real category taxonomy *before any claim rail lets a vendor request
  a sensitive category*". SP-V2 shipped that rail: `/vendor-claim/verify` takes an optional
  `category` and `vendorClaimService.verify` writes it through verbatim — the list is read
  only by `consensus.ts`, on the observed path, and by nothing on the claim path. That is
  **by design** (the list means "not settable by observed consensus; claim-or-ops only", per
  the env table above), so this is not a bypass. But the review the bullet asked for still has
  not happened, and a claimant can today self-assert `pharmacy` — which, being
  `categorySource = 'claimed'`, *is* enforceable. Do the review.
- **The 5 / 8 / 0.6 thresholds** are starting guesses (spec §14.2) — all three are env
  vars specifically so they can be tuned once shadow data exists, with no deploy beyond an
  env change.
