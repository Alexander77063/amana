# Sub-plan A1 — Admin portal & IAM — Implementation Plan

**Status:** Planned 2026-08-28. **Tasks 1, 2, 3 and 4A built 2026-08-29** — admin identity, Google
Workspace OIDC (verified against a stub; see the caveat under Task 1), server-side sessions, the
seeded first owner, the `audit_log` attribution column, the role model with its invariants,
maker-checker on role grants, and **the cutover: the shared `ADMIN_API_KEY` is deleted and all 13
ops endpoints now require a named staff session.** Remaining: Task 4B (maker-checker on the ops
actions) and Tasks 5–7.

Four changes to this plan were made during Tasks 2–4; all are recorded in the decision tables below
rather than absorbed silently.
**Decisions locked with Alex before planning** (see "Decisions" below) — do not re-litigate them
mid-build; raise a change instead.

---

## Why this exists

There is no admin portal. There are **13 admin endpoints** across `routes/vendors-admin.ts` and
`routes/retailers.ts`, every one behind a **single shared static secret** (`ADMIN_API_KEY`, header
`x-admin-api-key`, `middleware/admin-auth.ts`). There is no UI; it is curl-only.

Four consequences, worst first:

1. **The audit log cannot say who.** `audit_log.actorUserId` exists and every ops write leaves it
   **null**, recording `actorKind: 'ops'` and nothing else. So an immutable, append-only trail —
   a real strength of this codebase — records that *somebody* transferred ownership of a merchant
   bank account. Attribution is the single biggest thing this sub-plan buys.
2. **No permissions.** The key holder can approve a vendor claim, suspend a business, revoke a
   merchant's consent, create retailers and approve KYB. `approve-claim` assigns ownership of a
   bank account to a person.
3. **Revocation is all-or-nothing.** One person leaves; rotating the key locks out everyone.
4. **No session, no MFA, no expiry.** A key in a shell history is permanent access.

## Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Admin sign-in | **Google Workspace SSO** | Offboarding is centralised — disable the Google account and Amana access dies with it. MFA comes free. Requires a Workspace domain + OAuth app. |
| v1 scope | **All four surfaces**, under least privilege | Ops endpoints, IAM itself, support lookup, money operations |
| Permission model | **Fixed roles**, five of them | Easy to audit; a role can be added later, a granular matrix cannot be un-shipped |
| Maker-checker | **Yes, on destructive actions AND role grants** | A role grant is more dangerous than a suspension: it converts into every other permission |
| JIT elevation | **In v1**, for money operations | Even an OWNER holds no standing money power; it is requested per session, with expiry and a logged reason |
| App | **A new Next.js app**, not an extension of the retailer portal | Different audience, different auth, different blast radius. A bug exposing staff tooling to retailers would be severe. |
| Hosting | **Fly, `jnb`, beside the API — fronted by Cloudflare Access** | Same origin means session cookies just work. **No preview deployments**: Vercel's best feature is a liability for staff tooling, where every branch would get a public URL. Cloudflare Access with Google as IdP means the portal is unreachable without a Workspace login *before* app code runs — two independent gates. |
| Staff identity domain | **Google Workspace on `amana-ng.com`** — portal refuses any email outside it | Changed 2026-08-28 from `elitesolutionshub.com`. Staff identity outlives any relationship between the two companies, and `amana-ng.com` is **already required** for the HSTS preload gate, so this adds no new domain dependency. |
| First owner | **`david@amana-ng.com`** | Changed with the domain. It **cannot** be `david@elitesolutionshub.com`: the portal refuses any address outside the Workspace domain, so an Elite address would need a permanent cross-domain exception carved into the bootstrap owner — the worst place in the system to put one. |

### Decided during Task 2 (2026-08-29) — including two changes to the plan itself

| Decision | Choice | Why |
|---|---|---|
| **PLAN CHANGE — when the 13 ops routes start writing `actorUserId`** | **Task 4, not Task 2** | Task 2 lists "every existing ops route starts writing `actorUserId`", but those routes authenticate with a shared key that carries no identity. Wiring attribution in before the cutover would make it **silently optional** — an operator who preferred not to be named would simply omit the session cookie, and the audit log would read as authoritative while having holes an insider chooses. That is worse than the current honest null, because nothing distinguishes the two. Attribution is only enforceable where identity is mandatory, and that is the same change: Task 4 swaps the middleware, adds the permission check, threads the actor through, and deletes the key — touching those call sites once instead of twice. |
| **PLAN CHANGE — retailer ops actions had no audit at all** | **Events added in Task 2, actor filled in at Task 4** | Discovered while scoping the above: `routes/retailers.ts` and `retailer-onboarding.service.ts` wrote **no `audit_log` row whatsoever**. Approving a retailer admits a business to the marketplace and suspending one cuts off its income, and neither left any trace that it had happened, by anyone. That is a strictly worse problem than missing attribution, and it is independent of identity — recording *what* happened needs no actor — so the events land now and Task 4 fills in *who*. |
| Bootstrap deadlock: who grants the first role? | **Config seeds BOTH `owner` and `admin` onto `david@amana-ng.com`, with a tested exit ceremony** | Confirmed with Alex 2026-08-29. `owner` cannot grant roles and only `admin` can, so one seeded owner would mean a system that admits nobody, forever, with no path out. Both grants carry a **null granter**, which is what marks them as config-made — the exact parallel to `provisioningSource: 'config'`. It is a break-glass account, which this plan already lists under `owner`. What makes that acceptable is the exit: the account onboards a real admin, who then revokes *its* `admin` grant, restoring segregation of duties — and invariant 1 stops the break-glass account undoing that alone. The seed only ever grants a role that has **never** been granted, so the next deploy cannot hand back what the ceremony took away. |
| Enforcing segregation of duties on grants | **No account may hold both `admin` and `owner`** (except the config bootstrap, until it is stood down) | Invariant 3 says neither role can become the other *alone*. Blocking self-edit is not enough on its own: one admin could simply build the merged account out of a colleague — or a second account they control. Checking the **target's** resulting roles closes that directly. It does not close an admin granting `admin` to a second account they control; that is Task 3's maker-checker, and this invariant must not be read as covering it. |
| Permissions vs. roles at the edge | **Routes check named permissions (`iam.write`), never role names** | A route that asks "is this person an `ops`?" hard-codes the matrix into every call site, and the matrix then cannot change without touching all of them. `/admin/me` returns permissions as well as roles for the same reason: the portal renders from capabilities rather than keeping a second copy of the matrix that would drift and that nobody tests. |

### Decided during Task 1 (2026-08-29), not at planning time

| Decision | Choice | Why it could not be deferred |
|---|---|---|
| Are staff rows in `users`? | **No — `admin_users` is a standalone table, and `audit_log` gains a second nullable actor column `actor_admin_user_id`** (migration `0044`), with a CHECK that at most one actor kind is named (`0045`) | Forced by invariant 7. `audit_log.actorUserId` is a FK to `users.id`, so a standalone admin id written there fails the constraint outright. The alternative — giving every staff member a `users` row — founders on the actual column shape: `users.nin` is **NOT NULL** and `users.phone` is NOT NULL UNIQUE, so onboarding an admin would mean **fabricating a National Identity Number per employee**, in the same encrypted column that holds real customers'. Deciding this in Task 2 instead would have meant either that fabrication or an ALTER on an append-only table after it had accumulated rows. |
| Does signing in create an admin? | **No. An unprovisioned Workspace member is refused (`not_provisioned`)** | Invariant 4 in practice. Every colleague can reach Google's consent screen, so auto-provisioning would turn "works at Amana" into "has an admin record". In Task 1 exactly one person can sign in — the seeded owner — and Task 2's onboarding is what admits anyone else. |
| Session token storage | **Opaque 32-byte token, stored as a plain SHA-256 digest** — not argon2 like `auth_sessions.refreshTokenHash` | Lookup, not laziness. A refresh token arrives with a user id, so the row can be found first and a salted hash verified second. A session cookie arrives alone, so the digest **is** the lookup key, which a salted hash cannot be. The token is 256 bits of CSPRNG, so there is no dictionary for a slow KDF to defend against. |
| Are the Google credentials boot-required? | **Not yet — Task 4 moves them into the production required set** | A boot-required secret is a precondition for the app existing at all, and `amana-api` has never had a successful production boot. Before Task 4 the ops endpoints still authenticate with `ADMIN_API_KEY`, so a missing Workspace degrades nothing that works; adding two boot blockers that depend on a tenant which does not exist would extend the critical path to first boot for a feature nothing yet depends on. After Task 4 removes that fallback, a missing OAuth app means no ops access at all and refusing to boot becomes correct. `tests/env.prod-required.test.ts` pins the current contract and says what to flip. |
| Which denials are audited | **Only those after Google has verified an identity** | `/admin/auth/callback` is unauthenticated. Auditing pre-identity refusals (unknown state, failed exchange) would let an anonymous caller write unbounded rows into an append-only table. Those are bounded by the route's per-IP rate limiter instead. |

## The `amana-ng.com` interaction — a synergy and a pre-flight item

Putting the Workspace and the portal on `amana-ng.com` connects this sub-plan to
[`go-live-checklist.md`](../../runbook/go-live-checklist.md) §6 in two ways.

**The synergy.** §6 already commits `amana-ng.com` to the HSTS preload list with `includeSubDomains`.
An admin portal at `admin.amana-ng.com` therefore inherits **HTTPS-only enforcement in shipped browsers,
before a staff member's first visit** — the exact protection the vendor landing page needed preload
for, applied to the surface that can suspend businesses. Free, and worth having deliberately rather
than by luck.

**The pre-flight item.** §6's existing warning is to confirm no `amana-ng.com` subdomain needs plain
HTTP before submitting for preload. This sub-plan **adds a subdomain** to that check. Google
Workspace itself is unaffected — mail runs on Google's own hostnames, and MX/TXT records are not
touched by HSTS — but `admin.amana-ng.com` must be HTTPS-only from day one, which it will be.

**Dependency:** `amana-ng.com` must be owned and verifiable before the Workspace can be created. It is
already on the critical path for §6, so this does not add one.

## The role matrix

| Role | Can | Explicitly cannot |
|---|---|---|
| `owner` | Money operations (via JIT elevation), break-glass | **Grant roles** |
| `admin` | Onboard admins, assign and revoke roles | Touch money, read customer data |
| `ops` | Vendor/retailer lifecycle: claim queue, approve, suspend, category, KYB | Money, IAM, unrestricted customer data |
| `support` | Help a customer **only after that customer verifies electronically** (Task 6). Sees masked account, amounts, rule outcomes | Any write. **BVN and NIN — absent, not masked.** Full account numbers, names, anything before the verification |
| `auditor` | Read everything **including the audit log** | Any write, anywhere |

## Invariants — enforced in code, not policy

These are the sub-plan's actual product. Everything else is plumbing.

1. **Nobody can change their own role or permissions.** Checked at the service layer, not the route,
   so no caller can bypass it. This is what stops the `admin` role from becoming every other role.
2. **A role grant is maker-checked.** Two different admins, and the maker cannot be the checker.
3. **Segregation of duties.** The role that grants access (`admin`) cannot move money; the role that
   moves money (`owner`) cannot grant access. Neither can become the other alone.
4. **Least privilege by default.** A newly onboarded admin has **no role** and can do nothing until
   granted one, explicitly and attributably.
5. **No standing money power.** `owner` must request JIT elevation per session — reason recorded,
   expiry enforced, every use logged.
6. **The first owner is seeded from config, never minted by an endpoint.** There must exist no code
   path that creates an owner from nothing, or that path is the attack.
7. **Every admin action writes `actorUserId`.** The gap that motivated this sub-plan does not survive
   it.

## File structure

```
apps/backend/src/
  db/schema/admin.ts            admin_users, admin_role_grants, admin_elevations,
                                admin_approvals
  modules/admin/
    admin-identity.service.ts   SSO callback -> admin user, session
    admin-iam.service.ts        role grants, the invariants above
    admin-elevation.service.ts  JIT request/approve/expire
    admin-approval.service.ts   generic maker-checker
    *.repo.ts
  middleware/admin-session.ts   replaces admin-auth.ts (kept until cutover)
  routes/admin/*.ts

apps/admin-portal/             new Next.js app (port 3400)
```

## Tasks — sequenced, each independently shippable

**Order matters.** Every task after 1 depends on attribution existing; every task after 2 depends on
permissions existing. Do not reorder to get a UI sooner.

### Task 1 — Admin identity and SSO ✅ built 2026-08-29
Google Workspace OIDC, `admin_users` (email, google subject, status), server-side sessions.
Seeded first owner from config. **No roles yet** — everyone who signs in can do nothing.
*Ships:* an admin can prove who they are. Nothing else changes.

**What landed**

| Area | Files |
|---|---|
| Schema | `db/schema/admin.ts` (`admin_users`, `admin_auth_requests`, `admin_sessions`), `db/schema/audit.ts` (`actor_admin_user_id`); migrations `0042`–`0045` |
| Identity | `modules/admin/admin-identity.service.ts` + three repos |
| OIDC | `modules/admin/oidc/types.ts` (the seam), `oidc/google-oidc.provider.ts` (the real one) |
| HTTP | `routes/admin/auth.ts` (`/start`, `/callback`, `/logout`), `/admin/me`, `middleware/admin-session.ts` |
| Boot | `src/index.ts` seeds the owner; `env.ts` adds six vars and two boot checks |

**Verified against a stub, NOT against Google.** The `amana-ng.com` Workspace tenant does not exist
yet, so no real ID token has ever been through this code. The provider seam exists precisely so the
task could be built and tested first — every rule the service enforces (verified email, `hd` claim,
provisioning, suspension, subject binding, state single-use) is covered by tests, and
`google-oidc.provider.ts` is exercised against ID tokens signed with a throwaway key pair. What
remains unproven is the live handshake: real credentials, the registered redirect URI, and Google's
actual claim shapes. Do that as the first step of Task 2, following
[`google-workspace-setup.md`](../../runbook/google-workspace-setup.md).

**`adminAuth` / `ADMIN_API_KEY` are untouched**, as planned — the 13 ops endpoints still sit behind
the shared secret until Task 4 cuts them over and deletes it. There is deliberately **no fallback**
between the two mechanisms.

### Task 2 — Roles, the invariants, and attribution ✅ built 2026-08-29
`admin_role_grants` (append-only, like `vendor_consents` — a revocation is a row, ordered by
`bigserial seq`, never by timestamp). Permission checks in the service layer. Self-edit blocked.
~~**Every existing ops route starts writing `actorUserId`.**~~ → **moved to Task 4**, see the plan
change recorded above: attribution is only enforceable where identity is mandatory, and making it
optional first would have been worse than the honest null it replaced.
*Ships:* roles exist, nobody can grant themselves one, and every IAM action names its operator.

**What landed**

| Area | Files |
|---|---|
| Schema | `db/schema/admin.ts` (`admin_role_grants`, `admin_role`, `admin_grant_source`); migration `0046` |
| IAM | `modules/admin/admin-iam.service.ts` (role matrix, permissions, the invariants), `admin-role-grants.repo.ts` (the fold) |
| HTTP | `routes/admin/iam.ts` (list, onboard, grant, revoke, grant history); `/admin/me` now returns real roles **and** permissions |
| Bootstrap | `ensureBootstrapOwner` seeds `owner` + `admin`, idempotently and without resurrecting a revoked role |
| Audit | `admin.onboarded`, `admin.role_granted`, `admin.role_revoked`, and the four new `retailer.*` events |

**What Task 2 does NOT deliver, despite being easy to assume it does:**

- The 13 ops routes still record a null operator. Task 4.
- One admin can still grant `admin` to a second account they control. Invariant 1 blocks *self*-edit
  only; the two-person rule is Task 3's maker-checker.
- `money.operate` is a permission `owner` holds, but no money surface reads it yet. Task 7 puts it
  behind JIT elevation, so holding `owner` is permission to *request* power, not to have it.

### Task 3 — Maker-checker ✅ built 2026-08-29
`admin_approvals`: a proposed action, its payload, its maker, its checker, its outcome. Applied
first to **role grants** (the most dangerous action), ~~then to vendor suspend / approve-claim /
consent revoke~~ — those wait for **Task 4**, because they run on key-authenticated routes where
there is no maker to record. See "everything that needs an actor" below.
*Ships:* no single admin can hand out power alone.

| Area | Files |
|---|---|
| Schema | `admin_approvals` + kind/status enums; migration `0047` |
| Service | `modules/admin/admin-approval.service.ts` (generic — knows nothing about roles) |
| Orchestration | `admin-iam.service`: `grantRole` proposes, `approveRoleGrant` decides and applies |
| HTTP | `/admin/iam/approvals` list / approve / reject / cancel; the grant route now returns **202** + an `approvalId` |
| Cron | `admin-approval-sweep.job.ts`, hourly, writes the `expired` transition |

### Decided during Task 3 (2026-08-29)

| Decision | Choice | Why |
|---|---|---|
| **PLAN CHANGE — is revocation maker-checked?** | **No. Revocations take effect immediately** | The plan says maker-checker covers "destructive actions AND role grants", and revocation reads as destructive — so this needs saying out loud. Requiring a quorum to *remove* access means a compromised or departing account keeps its powers until a second admin happens to be available. The gate belongs on the direction that **creates** power; taking it away must always be possible alone. This is the fail-safe direction. |
| The bootstrap deadlock, again | **The config-seeded account may complete its own grant, anchored on `provisioningSource === 'config'`** | Maker-checker would otherwise deadlock the Task 2 exit ceremony: the bootstrap account is the only admin, so its proposal to create the first real admin could never find a second approver. **Not** gated on "is the only admin" — that is a count, and therefore attackable: revocation is immediate, so a rogue admin could revoke every peer to re-enter single-admin mode and then grant at will. `provisioningSource` is an immutable property of one row that no admin action can confer. The exemption **self-extinguishes**: after the ceremony that account holds `owner` only, which has no `iam.write`. There is a test for the rogue-admin path specifically. |
| Is the exemption visible? | **Yes — it writes a full proposal row with maker == checker** | A reader should be able to *see* that the exception was used, not infer it from an absent approval. The audit trail has the same shape as a two-person grant. |
| When are proposals re-validated? | **At propose time AND at approve time** | Days pass between the two. The target may have been suspended, or acquired the mutually exclusive role by another route. A proposal is a request, never a pre-authorised write. Proposing also validates, so an impossible request fails immediately instead of sitting in an inbox for a week. |
| Expiry | **A cron sweep writes the `expired` status**, hourly | The house pattern (`bump-ttl-sweep`), and the alternative is worse: a `pending` row that has silently stopped working is one an operator keeps clicking approve on with nothing explaining why nothing happens. |

### Everything that needs an actor was blocked behind Task 4 — two of three now closed

Three separate pieces of work waited on the same thing:

1. ~~The 13 ops routes writing `actorUserId`~~ — **closed by Task 4A.**
2. Maker-checker on vendor suspend / approve-claim / consent revoke — **Task 4B, the last one.**
3. ~~Filling in the operator on the new `retailer.*` audit events~~ — **closed by Task 4A.**

All three needed those routes to carry a signed-in admin instead of a shared secret, which is what
Task 4A did.

### Task 4 — Cut the 13 endpoints over ✅ built 2026-08-29 (part A)
`vendors-admin.ts` and `retailers.ts` move from `adminAuth` to `adminSession` + a permission check.
`ADMIN_API_KEY` is **deleted**, not left as a fallback — a fallback is the whole vulnerability with
extra steps.
*Ships:* the shared secret is gone.

**Split into two PRs**, cutover first. The cutover is the part that can cause an outage or a silent
hole and it should be reviewable without approval plumbing beside it; if it has to be reverted, the
maker-checker work should not go with it.

- **Part A (built):** the middleware swap, per-endpoint permissions, attribution on all nine audit
  events, and deleting the key. Closes two of the three deferrals — the ops routes now write
  `actorUserId`, and the `retailer.*` events name their operator.
- **Part B (next):** maker-checker on vendor suspend / approve-claim / consent revoke, closing the
  third deferral.

**The test that proves it** is `tests/routes/admin-cutover.test.ts`, and it is deliberately about
the OLD mechanism: it presents a correctly configured `x-admin-api-key` to all thirteen endpoints
and requires every one to answer 401. Tests that only prove the new session auth works would pass
just as happily with a leftover `adminAuth` mount still honouring the secret somewhere. Before the
cutover it failed with all 13 accepting the key (200/400/404); after, all 13 refuse it.

| Decision | Choice | Why |
|---|---|---|
| `POST /vendors-admin/households/:id/enforcement` permission | **`vendor.write`**, though it writes a household row | The one mapping in this change that is not obvious, so it is argued rather than assumed. The role matrix gives `ops` the vendor registry and withholds unrestricted customer data. This endpoint sets one tri-state boolean, `vendorCategoryEnforced`, deciding whether registry category rules apply to that household. It reads nothing about the household and exposes no balance, transaction or identifier — it is vendor-registry authority pointed at one household, not customer-data access. |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | **Now boot-required in production** | Exactly as the Task 1 follow-up promised. With `ADMIN_API_KEY` gone, Google Workspace is the only way into the ops surfaces, so a missing OAuth app means no claim queue, no retailer KYB, no suspensions. Booting a portal nobody can sign in to is worse than refusing to boot. |
| `ADMIN_API_KEY` in `env.ts` | **Removed from the schema entirely**, not deprecated | Setting it is now inert (the schema is non-strict), which is the right outcome for a stale deploy that still exports it — it boots fine and the value buys nothing. |

### Task 5 — The portal UI
Next.js app: sign-in, the ops surfaces, the IAM screens, an approvals inbox. Tokens duplicated in
CSS as the retailer portal does (same accepted cost, same reason).

### Task 6 — Support: verify the customer *before* the conversation, and see almost nothing

Reframed from "support lookup" on Alex's instruction, and it is a materially better design.

**The customer is verified electronically; support never sees who they are.** Support asks for a
phone number, types it in, and gets back one bit: verified, or nothing.

```
CUSTOMER phones support
  └── support enters the number the caller states
        └── ALWAYS answers "verification sent" — never "no such customer"
              (a staff-facing enumeration oracle is still an enumeration oracle;
               same reasoning as PRE-LAUNCH GATE 3)
        ├── push to the customer's app: "Are you speaking to Amana support? Approve"
        │     (expo-push.provider.ts — the rail already exists)
        └── falls back to an SMS code they read back
              (termii-sms.provider.ts — likewise)

  └── support's screen flips to: ✅ VERIFIED · session expires in 15 min
        and NOTHING else identifying
```

**What support may see after verification — and it is deliberately little:**

| Visible | Never visible |
|---|---|
| Masked account (`••••1234`) | Full account number |
| Transaction amounts, times, status, denial reasons | **BVN, NIN** — not masked, *absent* |
| Rule names and whether a rule denied a spend | Full name, address, date of birth |
| Wallet balances | Anything before this verification |

This answers the open question from the first draft: **`support` never sees BVN or NIN.** Alex's
instruction was "without the support seeing any of the customer details", and the resolution is that
verification is what unlocks *helping*, not what unlocks *looking*.

**Every read is audited with `actorUserId` and the verification id**, so "which operator read this
customer's transactions, under which verified session" is answerable. Reading customer financial
data is itself an event.

**Verification expires** (15 min, tunable). A new call is a new verification — support cannot hold a
session open and reuse it for the next caller.

### Task 7 — JIT elevation and money operations
Elevation request/approve/expire, then the money surfaces behind it. Last deliberately: it is the
highest-risk surface and should land on an IAM that has been exercised.

## Open questions — answered 2026-08-28

- ~~Workspace domain~~ → **`amana-ng.com`** (changed 2026-08-28 from `elitesolutionshub.com`), and the portal **refuses any email outside it**.
- ~~First owner~~ → **`david@amana-ng.com`**. The `elitesolutionshub.com` address was confirmed free of the typo, then superseded by the domain change — see Decisions for why it cannot be kept.
- ~~Hosting~~ → Fly `jnb` + Cloudflare Access. See Decisions.
- ~~Support and BVN/NIN~~ → **never**. Resolved by the Task 6 redesign: support sees a verification
  result, not an identity.

### Still open, and blocking

- **The Workspace does not exist yet.** Step-by-step setup, including the two things that bite if
  skipped, is in [`runbook/google-workspace-setup.md`](../../runbook/google-workspace-setup.md). `amana-ng.com` needs to be owned and verified, then a Google
  Workspace tenant, an OAuth app, and the redirect URI, before Task 1 can be tested against anything
  real. Task 1 can be *built* against a stub, but not verified. `amana-ng.com` is already on §6's
  critical path, so this is a shared dependency rather than a new one.

  **Status 2026-08-29:** `amana-ng.com` **is** owned (confirmed by Alex). Task 1 is built and
  green against the stub; the tenant, the OAuth app and the first live sign-in are still to do,
  and they are now the only thing standing between this code and a working staff login. Task 1
  also settled the runbook's open question about the redirect URI: it is
  `https://admin.amana-ng.com/admin/auth/callback` — a **backend** path, because the code exchange
  never touches the portal.
- **Call recording (below) needs a platform decision** that is not Amana's to make in code.

## Call recording — flagged, not planned here

Alex asked for support conversations to be recorded, with the customer informed. Agreed in
principle, and deliberately **not** folded into this sub-plan, because it is not primarily an Amana
build:

- **Amana has no telephony.** Recording requires a call platform (a helpdesk or contact-centre
  provider). Which one decides everything else — where audio lives, for how long, and who can press
  play.
- **A recording is personal data**, and a sensitive kind. It needs its own NDPA basis, a retention
  period, and access control — realistically `auditor` only, never `support`, because the person on
  the call should not be able to re-listen to other people's.
- **The notice must be given before recording starts**, not in terms accepted months earlier. That
  is a script and a system prompt, not a paragraph in a document.
- **It interacts with Task 6.** If the caller is not yet verified, the recording captures an
  unverified person — so recording should start at the *point of contact*, and the verification
  result should be stamped into the recording's metadata.

Sub-plan **A2** should cover it, once the platform is chosen.

## Self-review

- **The riskiest thing here is Task 4**, not Task 7. Cutting 13 live endpoints off a working auth
  mechanism is where an outage or a silent hole gets introduced. Keep `adminAuth` in the tree until
  the cutover test passes, then delete it in the same PR that proves the replacement works.
- **Least privilege has a cost and it will be felt on day one:** a newly onboarded admin can do
  nothing at all until someone grants a role, and role grants need two people. That is correct and
  will feel broken. Say so in the runbook before anyone hits it.
- **JIT elevation with one or two owners is friction with little immediate gain** — it was chosen
  deliberately anyway, to avoid retrofitting it onto callers later. Revisit the expiry duration once
  it has been used in anger.
