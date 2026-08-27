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

## The role matrix

| Role | Can | Explicitly cannot |
|---|---|---|
| `owner` | Money operations (via JIT elevation), break-glass | **Grant roles** |
| `admin` | Onboard admins, assign and revoke roles | Touch money, read customer data |
| `ops` | Vendor/retailer lifecycle: claim queue, approve, suspend, category, KYB | Money, IAM, unrestricted customer data |
| `support` | Read-only customer lookup — household, wallets, rules, transactions | Any write, anywhere |
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

### Task 6 — Support lookup
Read-only household/wallet/rules/transaction views for `support`. **Every read is audited** — staff
reading customer financial data is itself an event worth recording.

### Task 7 — JIT elevation and money operations
Elevation request/approve/expire, then the money surfaces behind it. Last deliberately: it is the
highest-risk surface and should land on an IAM that has been exercised.

## Open questions for Alex — needed before Task 1

- **Workspace domain?** Which Google Workspace domain do staff accounts live on — and should the
  portal refuse any email outside it?
- **First owner email?** The seeded value for invariant 6.
- **Hosting?** Fly alongside the API, or Vercel like the retailer portal? Affects the OAuth redirect
  URI and the session cookie domain.
- **Is `support` allowed to see full account numbers and BVN/NIN?** Currently the API returns them
  to authorised callers; a support tier probably should not. Needs a decision, not a default.

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
