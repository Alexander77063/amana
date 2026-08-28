# Sub-plan A1 — Admin portal & IAM — Implementation Plan

**Status:** Planned 2026-08-28. Not started.
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

### Task 1 — Admin identity and SSO
Google Workspace OIDC, `admin_users` (email, google subject, status), server-side sessions.
Seeded first owner from config. **No roles yet** — everyone who signs in can do nothing.
*Ships:* an admin can prove who they are. Nothing else changes.

### Task 2 — Roles, the invariants, and attribution
`admin_role_grants` (append-only, like `vendor_consents` — a revocation is a row, ordered by
`bigserial seq`, never by timestamp). Permission checks in the service layer. Self-edit blocked.
**Every existing ops route starts writing `actorUserId`.**
*Ships:* the audit log can finally say who.

### Task 3 — Maker-checker
`admin_approvals`: a proposed action, its payload, its maker, its checker, its outcome. Applied
first to **role grants** (the most dangerous action), then to vendor suspend / approve-claim /
consent revoke.
*Ships:* no single admin can hand out power or destroy a business alone.

### Task 4 — Cut the 13 endpoints over
`vendors-admin.ts` and `retailers.ts` move from `adminAuth` to `adminSession` + a permission check.
`ADMIN_API_KEY` is **deleted**, not left as a fallback — a fallback is the whole vulnerability with
extra steps.
*Ships:* the shared secret is gone.

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
