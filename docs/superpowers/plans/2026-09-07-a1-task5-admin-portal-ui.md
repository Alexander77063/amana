# A1 Task 5 — Admin Portal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/admin-portal`, the staff portal for Amana: Google Workspace sign-in, the maker-checker inbox, the vendor and retailer ops surfaces, and the IAM screens — deployable to Fly at `admin.amana-ng.com` on the same origin as the API's `/admin/*` routes.

**Architecture:** A separate Next.js 14 App Router app (port 3400) that owns no secrets and proxies three backend prefixes (`/admin/*`, `/vendors-admin/*`, `/retailers/*`) through explicit, unit-tested Route Handlers, so the backend's host-only `HttpOnly; Secure; SameSite=Lax` session cookie is set on and sent from the portal's own origin. Every screen renders from the permissions `/admin/me` returns — the portal never re-implements the role matrix. Two small backend changes first, because the contract survey found gaps no UI can work around: the inbox is invisible to the `ops` role that works it, and the claim queue exposes bare vendor ids with no vendor read endpoint.

**Tech Stack:** Next.js 14.2.15, React 18.2.0, TypeScript 5.5, plain CSS with the `@amana/ui` dark tokens duplicated once (the retailer-portal convention), Vitest 2.1.2 + react-test-renderer 18.2.0 for component tests, Playwright (already a root devDep) for the hand-run browser probe, Fly.io (`amana-admin`, `jnb`) with a standalone Next build in Docker.

**Spec:** `docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md` (Task 5, the Decisions table, the role matrix and the seven invariants) plus the three survey findings recorded under *Decisions made for this plan* below. Read the spec's role matrix before touching permissions.

## Global Constraints

- Node `>=20`, `pnpm@10.33.2`, Turborepo. New app registers itself by existing under `apps/` with the standard scripts (`dev`, `build`, `lint`, `typecheck`, `test`).
- Biome: single quotes, semicolons, trailing commas, 2-space, 100-col, `useImportType: error`. `pnpm exec biome check .` runs repo-wide in CI and fails on drift.
- Backend tests run against the real Postgres (`docker compose up -d`), `pool: forks` + `singleFork`. Route tests use `app.request()` and `signedInAdmin(email, roles)` from `apps/backend/tests/helpers/admin-session.ts` (one call per unique email per test).
- **The portal holds no secrets.** No `GOOGLE_OAUTH_*`, no `JWT_SECRET`. Its only configuration is `BACKEND_ORIGIN` (server-side, never `NEXT_PUBLIC_*`) and `PORT`.
- **The portal's own pages must stay off `/admin`, `/vendors-admin` and `/retailers`** — those paths are the proxy. UI lives at `/`, `/sign-in`, `/ops/*`, `/people/*`. `/` and `/sign-in` are the exact targets of the backend's post-sign-in and sign-in-failed redirects.
- **Render from `permissions`, never from role names** (spec decision, Task 2 table). The only place a role name is shown is as information about a person.
- Money is `bigint` kobo everywhere; the portal shows no money in this task (money surfaces are Task 7). If a kobo string ever needs display, copy `formatNaira` from `apps/retailer-portal/lib/api.ts` byte-identical.
- Accessible names are the test selectors: every input has a `<label htmlFor>`, every icon-only control an `aria-label`, nav uses `aria-current="page"`, focus is `outline: 2px solid var(--accent)`, never `outline: none`. Status is always colour **plus a word**.
- Error copy: never distinguish "not yours" from "does not exist"; never explain a 403 beyond "you don't have permission" (the backend deliberately collapses every `ForbiddenError` to `{ error: 'forbidden' }`).
- Commit after every task. Never push to `main`. Do not run `gh pr merge`.

---

## Decisions made for this plan (2026-09-07)

These were forced by what the three surveys found. Each is recorded here so it is raised as a change, not re-litigated mid-build.

| Decision | Choice | Why |
|---|---|---|
| Same-origin mechanism | **Explicit Route Handler proxies** in the portal for `/admin/*`, `/vendors-admin/*`, `/retailers/*`, sharing one `lib/proxy.ts` — not `next.config` `rewrites()` | The one load-bearing unknown with rewrites is whether a `302` that also carries `Set-Cookie` (the OAuth callback) survives Next's proxy unmodified. A Route Handler copies status, `set-cookie` and `location` explicitly, and is unit-testable by injecting `fetch`. Rewrites exist nowhere in the repo, so neither option follows a precedent; the testable one wins. |
| Hosting | **Separate Fly app `amana-admin`**, `jnb`, `min_machines_running = 1`, 512 MB, `/health` route, `admin.amana-ng.com` CNAME at Namecheap | The plan says "beside the API", the OAuth redirect URI already registered with Google points at the **portal** host, and the cookie is host-only — so the portal host must forward `/admin/*`. `min_machines_running = 1` because a cold portal stalls Google's redirect inside the 10-minute login TTL, not for the API's "no cold starts" reason. |
| CI deploy | A third job `deploy-admin`, gated on `vars.ADMIN_PORTAL_DEPLOY == 'true'` and secret `FLY_API_TOKEN_ADMIN` | The Fly app, cert and DNS are ops steps Alex performs; the job must not fail every push until then. |
| **PLAN CHANGE — inbox visibility** | `GET /admin/approvals` is **scoped by permission per kind**: `role_grant` visible with `iam.read` or `iam.write`; `vendor_approve_claim` visible with `vendor.read` or `vendor.write`; **your own proposals always visible**. Gains `?status=pending\|decided`, maker/checker emails, decision fields. | Task 3 gated the whole inbox on `iam.read`. `ops` does not hold it, so the only role that can work vendor-claim approvals could not see the queue (403) and had to be handed ids out of band. A queue nobody can see is not a control. |
| **PLAN CHANGE — reject permission** | Rejecting requires the **same permission as approving that kind** (`iam.write` / `vendor.write`), dispatched like approve. | `iam.read` was enough to reject, so `auditor` — specified as "writes nothing, anywhere" — could reject a vendor claim, while `ops` could not. The permission to decline is the permission to decide. Maker-cannot-be-checker still applies. |
| Vendor read surface | New `GET /vendors-admin/vendors` (status + text search, limit 200), `GET /vendors-admin/vendors/:id`, and the claim queue joins a **vendor summary** with the account number **masked** (`••••1234`) | The queue returned bare `vendorId`s and no admin route reads a vendor, so the claim screen could show nothing about the business being claimed. Ops never needs the full account number; the claim carries the bank identity already. |
| API layer | Portal-local `lib/api.ts` (relative `fetch`, `credentials: 'same-origin'`), **not** `@amana/api-client` | The shared client requires a `tokenStore` and never sends credentials; a cookie-authenticated same-origin portal needs neither. Adding a cookie mode to a client the two mobile apps depend on is risk with no mobile benefit. This is an explicit exception to sp4b's "the portal consumes only the client" rule, and it is written down here. |
| Tests in CI | `"test": "vitest run"` so `turbo run test --filter='!@amana/backend'` picks the app up | The retailer portal has no test script and is silently skipped by CI. Staff tooling that can suspend a business gets tests. |
| Fonts | Georgia (system serif) for headings and queue counts; `system-ui` for body; no webfonts | Brand continuity with `@amana/ui`'s `heading`/`amount` scale (Georgia), at zero download cost — the retailer portal's stated reason for avoiding webfonts holds, and Georgia needs none. |

### Design plan (the frontend-design pass)

**Subject.** A control room for a small staff — five to ten people — where the most consequential act is two of them agreeing to hand a bank account to a merchant. The job of the page is to make *who* and *what* unmistakable before *approve* is pressed.

**Palette** (the dark ramp from `packages/ui/src/theme/tokens.ts`, duplicated once in CSS):
`--bg-base #0D1B2A` (page), `--bg-surface #152535` (rail, cards), `--bg-raised #1C3147` (inputs, hover), `--text-primary #F5F0E8`, `--text-secondary #8BA3B8`, `--accent #C9A227` gold — spent in exactly three places: the count of things waiting for you, the primary action of a screen, and focus. `--credit #52C49A` and `--debit #FF6B6B` only ever beside a word.

**Type.** Georgia 26/700 for the page title and for the single large number in the rail; Georgia 18/700 for section titles; `system-ui` 15/1.55 body; `tabular-nums` on every id, code, count and timestamp column. Form labels keep the design system's small uppercase label (that is the brand's token, not an eyebrow), and there are no eyebrow labels above content.

**Layout.**
```
┌──────────────┬──────────────────────────────────────────────┐
│ Amana        │  Waiting for a second person                 │
│ Staff        │                                              │
│              │  ┌ Make ada@amana-ng.com an admin ─────────┐ │
│ ● Inbox   3  │  │ proposed by david@ · expires in 6 days   │ │
│   Vendors    │  │ [ Approve ]  [ Decline ]  reason ______  │ │
│   Retailers  │  └──────────────────────────────────────────┘ │
│   People     │  ┌ Give CORNER SHOP's account to +234…  ────┐ │
│              │  │ proposed by ops1@ · food                 │ │
│              │  └──────────────────────────────────────────┘ │
│ david@       │                                              │
│ owner, admin │  Proposed by you            Decided recently │
│ Sign out     │  …                          …                │
└──────────────┴──────────────────────────────────────────────┘
```
Left rail 232 px (the retailer portal's `.shell` grid), content left-aligned, max-width 1080. The rail's bottom block is the person: email, roles, sign out — always visible, because attribution is the product.

**The one memorable element.** Each approval is a ledger line with **two seats**: the maker's seat is filled with their email; the checker's seat is empty and reads *"needs a second person"* until you sit in it. Approving fills the seat with you. Nothing else on the page moves.

**Principles.** Every action names its consequence in plain words ("Give CORNER SHOP's account to +234 803…", "Make ada@ an admin", "Suspend CORNER SHOP — stops new spends at once"). Destructive and immediate actions (suspend, revoke) ask for a click-through confirmation inline, not a modal. Errors say what happened and what to do; empty states say what would fill them.

**Reviewed against the generic default.** A dark navy dashboard with gold accents could be any fintech's admin. What makes this one specific is the two-seat approval line, gold reserved for "needs you", copy that names the consequence, and the person block pinned in the rail. Dropped from the first draft: a stats row of counts on the home page (the count belongs in the rail, once), numbered steps on the retailer KYB form (it is not a sequence the operator controls), and hover transitions on rows.

---

## File structure

```
apps/backend/src/
  modules/admin/admin-approval.service.ts        MODIFY: listForActor(), decided statuses
  modules/admin/admin-approval-dispatch.service.ts MODIFY: reject() dispatch by kind
  routes/admin/approvals.ts                      MODIFY: ?status, scoped list, reject via dispatch
  modules/vendors/vendors.repo.ts                MODIFY: search(), findManyByIds()
  modules/vendors/vendor-claims.repo.ts          MODIFY: listForVendor()
  routes/vendors-admin.ts                        MODIFY: GET /vendors, GET /vendors/:id, enriched queue
  lib/vendor-summary.ts                          CREATE: masked summary serialiser
apps/backend/tests/routes/
  admin-approvals.inbox.test.ts                  CREATE
  vendors-admin.read.test.ts                     CREATE

apps/admin-portal/
  package.json, tsconfig.json, next-env.d.ts, next.config.mjs, vitest.config.ts
  app/layout.tsx                                 server component; imports globals.css
  app/globals.css                                tokens + component vocabulary
  app/icon.svg
  app/health/route.ts                            Fly health check
  app/admin/[...path]/route.ts                   proxy
  app/vendors-admin/[...path]/route.ts           proxy
  app/retailers/[...path]/route.ts               proxy
  app/sign-in/page.tsx
  app/(portal)/layout.tsx                        session shell: MeProvider + rail
  app/(portal)/page.tsx                          inbox (home)
  app/(portal)/ops/vendors/page.tsx              claim queue + vendor search
  app/(portal)/ops/vendors/[id]/page.tsx         vendor detail + actions
  app/(portal)/ops/retailers/page.tsx            list + create
  app/(portal)/ops/retailers/[id]/page.tsx       detail + KYB/approve/suspend
  app/(portal)/people/page.tsx                   admins + onboard
  app/(portal)/people/[id]/page.tsx              roles: grant/revoke/history
  lib/proxy.ts                                   proxyToBackend(request, fetchImpl)
  lib/api.ts                                     ApiError, request(), endpoint functions
  lib/types.ts                                   wire types
  lib/copy.ts                                    errorMessage(), describeApproval(), relative time
  lib/me.tsx                                     MeProvider, useMe(), can()
  components/Rail.tsx                            nav + person block
  components/ApprovalCard.tsx                    the two-seat line
  components/Confirm.tsx                         inline click-through confirm
  components/StatusPill.tsx
  test/setup.ts, test/render.tsx, test/next.mock.tsx
  lib/*.test.ts, components/*.test.tsx, app/**/page.test.tsx
  Dockerfile
fly.admin.toml                                   CREATE (repo root)
.dockerignore                                    MODIFY: + **/.next
.github/workflows/ci.yml                         MODIFY: deploy-admin job
tools/demo/probe-admin-portal.mjs                CREATE
docs/runbook/admin-portal.md                     CREATE
docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md  MODIFY: Task 5 status + decisions
docs/business/UI-UX-DESIGN-BRIEF.md              MODIFY: §10 admin portal
docs/business/APP-FLOW.md                        MODIFY: §9 staff flows
docs/product/README.md, CLAUDE.md, docs/runbook/go-live-checklist.md  MODIFY
```

---

### Task 1: Backend — the inbox everyone who works it can see

**Files:**
- Modify: `apps/backend/src/modules/admin/admin-approval.service.ts` (add `listForActor`)
- Modify: `apps/backend/src/modules/admin/admin-approval-dispatch.service.ts` (add `reject`)
- Modify: `apps/backend/src/routes/admin/approvals.ts`
- Test: `apps/backend/tests/routes/admin-approvals.inbox.test.ts`

**Interfaces:**
- Consumes: `adminIamService.permissionsFor(db, adminUserId): Promise<AdminPermission[]>`, `adminIamService.requirePermission(db, adminUserId, permission)`, `adminApprovalService.reject(db, { approvalId, checkerAdminUserId, reason })`, `signedInAdmin(email, roles)`.
- Produces: `adminApprovalService.listForActor(db, actorAdminUserId, { status: 'pending' | 'decided' }): Promise<InboxRow[]>` where `InboxRow = AdminApprovalRow & { makerEmail: string; checkerEmail: string | null }`; `adminApprovalDispatch.reject(db, { approvalId, checkerAdminUserId, reason })`; `GET /admin/approvals?status=` response shape (below).

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/routes/admin-approvals.inbox.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';

const app = createServer({ adminOidcProvider: stubOidcProvider() });
const NOW = new Date();

async function post(cookie: string, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function proposeRoleGrant(cookie: string, targetId: string) {
  const res = await post(cookie, `/admin/iam/admins/${targetId}/roles`, {
    role: 'ops',
    reason: 'inbox test',
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { approvalId: string }).approvalId;
}

async function proposeVendorClaim(cookie: string) {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber: factories.bankAccount(),
    displayName: 'INBOX SHOP',
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  const res = await post(cookie, `/vendors-admin/vendors/${v.id}/approve-claim`, {
    phone: factories.phone(),
    category: 'food',
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { approvalId: string }).approvalId;
}

describe('GET /admin/approvals — scoped by permission per kind', () => {
  beforeEach(truncateAll);

  it('an ops admin sees vendor claims but not role grants', async () => {
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const target = await signedInAdmin('newbie@amana-ng.com', []);
    const roleId = await proposeRoleGrant(admin.cookie, target.adminUserId);
    const claimId = await proposeVendorClaim(ops.cookie);

    const ops2 = await signedInAdmin('ops2@amana-ng.com', ['ops']);
    const res = await app.request('/admin/approvals', { headers: { cookie: ops2.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: Array<{ id: string; kind: string }> };
    expect(body.approvals.map((a) => a.id)).toContain(claimId);
    expect(body.approvals.map((a) => a.id)).not.toContain(roleId);
  });

  it('an admin sees role grants but not vendor claims', async () => {
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const target = await signedInAdmin('newbie@amana-ng.com', []);
    const roleId = await proposeRoleGrant(admin.cookie, target.adminUserId);
    const claimId = await proposeVendorClaim(ops.cookie);

    const admin2 = await signedInAdmin('admin2@amana-ng.com', ['admin']);
    const res = await app.request('/admin/approvals', { headers: { cookie: admin2.cookie } });
    const body = (await res.json()) as { approvals: Array<{ id: string; makerEmail: string }> };
    expect(body.approvals.map((a) => a.id)).toContain(roleId);
    expect(body.approvals.map((a) => a.id)).not.toContain(claimId);
    expect(body.approvals.find((a) => a.id === roleId)?.makerEmail).toBe('admin1@amana-ng.com');
  });

  it('the maker always sees their own proposal, whatever their permissions', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    // Take the role away — the proposal is still theirs to see and cancel.
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const revoke = await post(admin.cookie, `/admin/iam/admins/${ops.adminUserId}/roles/revoke`, {
      role: 'ops',
    });
    expect(revoke.status).toBe(204);

    const res = await app.request('/admin/approvals', { headers: { cookie: ops.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: Array<{ id: string }> };
    expect(body.approvals.map((a) => a.id)).toEqual([claimId]);
  });

  it('a support admin with no matching permission sees an empty inbox, not a 403', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    await proposeVendorClaim(ops.cookie);
    const support = await signedInAdmin('support@amana-ng.com', ['support']);
    const res = await app.request('/admin/approvals', { headers: { cookie: support.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { approvals: unknown[] }).approvals).toEqual([]);
  });

  it('?status=decided lists decisions with the checker named', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const ops2 = await signedInAdmin('ops2@amana-ng.com', ['ops']);
    const approve = await post(ops2.cookie, `/admin/approvals/${claimId}/approve`, {
      reason: 'checked with the shop',
    });
    expect(approve.status).toBe(200);

    const pending = await app.request('/admin/approvals', { headers: { cookie: ops.cookie } });
    expect(((await pending.json()) as { approvals: unknown[] }).approvals).toEqual([]);

    const decided = await app.request('/admin/approvals?status=decided', {
      headers: { cookie: ops.cookie },
    });
    expect(decided.status).toBe(200);
    const body = (await decided.json()) as {
      approvals: Array<{
        id: string;
        status: string;
        checkerEmail: string | null;
        decisionReason: string | null;
        decidedAt: string | null;
      }>;
    };
    const row = body.approvals.find((a) => a.id === claimId);
    expect(row?.status).toBe('approved');
    expect(row?.checkerEmail).toBe('ops2@amana-ng.com');
    expect(row?.decisionReason).toBe('checked with the shop');
    expect(row?.decidedAt).toMatch(/^\d{4}-/);
  });

  it('rejects an unknown status with 400', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const res = await app.request('/admin/approvals?status=everything', {
      headers: { cookie: ops.cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/approvals/:id/reject — the permission to decline is the permission to decide', () => {
  beforeEach(truncateAll);

  it('an auditor cannot reject a vendor claim', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const auditor = await signedInAdmin('auditor@amana-ng.com', ['auditor']);
    const res = await post(auditor.cookie, `/admin/approvals/${claimId}/reject`, {});
    expect(res.status).toBe(403);
  });

  it('a second ops admin can reject a vendor claim', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const ops2 = await signedInAdmin('ops2@amana-ng.com', ['ops']);
    const res = await post(ops2.cookie, `/admin/approvals/${claimId}/reject`, {
      reason: 'wrong phone',
    });
    expect(res.status).toBe(204);
  });

  it('an ops admin cannot reject a role grant', async () => {
    const admin = await signedInAdmin('admin1@amana-ng.com', ['admin']);
    const target = await signedInAdmin('newbie@amana-ng.com', []);
    const roleId = await proposeRoleGrant(admin.cookie, target.adminUserId);
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const res = await post(ops.cookie, `/admin/approvals/${roleId}/reject`, {});
    expect(res.status).toBe(403);
  });

  it('the maker still cannot reject their own proposal', async () => {
    const ops = await signedInAdmin('ops1@amana-ng.com', ['ops']);
    const claimId = await proposeVendorClaim(ops.cookie);
    const res = await post(ops.cookie, `/admin/approvals/${claimId}/reject`, {});
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin-approvals.inbox.test.ts`
Expected: FAIL — the ops-sees-claims test gets 403 (inbox gated on `iam.read`), `?status=decided` returns pending rows, the auditor reject returns 204.

- [ ] **Step 3: Add `listForActor` to the approval service**

In `apps/backend/src/modules/admin/admin-approval.service.ts`, add to the imports:

```ts
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { adminApprovals, adminUsers } from '../../db/schema';
import { adminIamService } from './admin-iam.service';
```

(Keep `lt` — `sweepExpired` uses it. Check for a circular import: `admin-iam.service` imports this file for `propose`/`approve`. Both are object literals resolved at call time, so the cycle is safe under ESM; if Vitest complains, move `listForActor` to read permissions through a parameter — `listForActor(db, actor, permissions, opts)` — and have the route pass `await adminIamService.permissionsFor(...)`. Prefer the parameter form from the start; it is the version shown here.)

Add the types and the method:

```ts
export type InboxStatus = 'pending' | 'decided';
const DECIDED = ['approved', 'rejected', 'cancelled', 'expired'] as const;

export type InboxRow = AdminApprovalRow & { makerEmail: string; checkerEmail: string | null };

/** Which kinds a set of permissions may see and decide. Reading and writing both count. */
export function visibleKinds(permissions: readonly string[]): AdminApprovalKind[] {
  const kinds: AdminApprovalKind[] = [];
  if (permissions.includes('iam.read') || permissions.includes('iam.write')) kinds.push('role_grant');
  if (permissions.includes('vendor.read') || permissions.includes('vendor.write')) {
    kinds.push('vendor_approve_claim');
  }
  return kinds;
}
```

and inside `adminApprovalService`, after `listPending`:

```ts
  /**
   * The inbox as one person sees it: every proposal of a kind their permissions let them decide,
   * plus every proposal they made themselves — a maker keeps sight of their own request even
   * after losing the permission that let them make it, because cancelling is still theirs to do.
   *
   * Scoped per kind rather than gated as a whole because the queue spans domains: `ops` works
   * vendor claims and holds no IAM permission at all, and an inbox they cannot open is not a
   * control, it is a rumour.
   */
  async listForActor(
    db: DbOrTx,
    actor: { adminUserId: string; permissions: readonly string[] },
    opts: { status: InboxStatus },
  ): Promise<InboxRow[]> {
    const maker = alias(adminUsers, 'maker');
    const checker = alias(adminUsers, 'checker');
    const kinds = visibleKinds(actor.permissions);
    const mine = eq(adminApprovals.makerAdminUserId, actor.adminUserId);
    const scope = kinds.length > 0 ? or(inArray(adminApprovals.kind, kinds), mine) : mine;
    const status =
      opts.status === 'pending'
        ? eq(adminApprovals.status, 'pending')
        : inArray(adminApprovals.status, [...DECIDED]);

    const rows = await db
      .select({
        approval: adminApprovals,
        makerEmail: maker.email,
        checkerEmail: checker.email,
      })
      .from(adminApprovals)
      .innerJoin(maker, eq(maker.id, adminApprovals.makerAdminUserId))
      .leftJoin(checker, eq(checker.id, adminApprovals.checkerAdminUserId))
      .where(and(scope, status))
      .orderBy(desc(adminApprovals.createdAt))
      .limit(200);

    return rows.map((r) => ({ ...r.approval, makerEmail: r.makerEmail, checkerEmail: r.checkerEmail }));
  },
```

- [ ] **Step 4: Add `reject` to the dispatcher**

In `apps/backend/src/modules/admin/admin-approval-dispatch.service.ts`, add after `approve`:

```ts
  /**
   * Declining is deciding. It needs the same permission as approving that kind — otherwise an
   * `auditor`, who writes nothing anywhere, could close a vendor claim, while the `ops` admin
   * meant to work the queue could not. The maker-cannot-be-checker rule is enforced by the
   * generic service underneath, exactly as for approve.
   */
  async reject(
    db: DbOrTx,
    input: { approvalId: string; checkerAdminUserId: string; reason?: string | null },
    now: Date = new Date(),
  ): Promise<void> {
    const approval = await adminApprovalService.findById(db, input.approvalId);
    if (!approval) throw new NotFoundError('approval_not_found');
    const permission = approval.kind === 'role_grant' ? 'iam.write' : 'vendor.write';
    await adminIamService.requirePermission(db, input.checkerAdminUserId, permission);
    await adminApprovalService.reject(db, input, now);
  },
```

- [ ] **Step 5: Rewrite the list and reject routes**

In `apps/backend/src/routes/admin/approvals.ts`, add `parseQuery` to the `../../lib/validate` import and a query schema:

```ts
const ListQuery = z.object({ status: z.enum(['pending', 'decided']).default('pending') });
```

Replace the `.get('/')` handler:

```ts
  .get('/', async (c) => {
    const actor = c.get('adminActor');
    const query = parseQuery(c, ListQuery);
    if (query instanceof Response) return query;
    // No permission gate on the inbox as a whole: the list is scoped per kind to what this
    // person may decide, plus their own proposals. Someone with no matching permission gets an
    // empty list, not a 403 — an empty inbox is a true statement about their work.
    const permissions = await adminIamService.permissionsFor(db, actor.adminUserId);
    const rows = await adminApprovalService.listForActor(
      db,
      { adminUserId: actor.adminUserId, permissions },
      { status: query.status },
    );
    return c.json({
      approvals: rows.map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        payload: a.payloadJson,
        makerAdminUserId: a.makerAdminUserId,
        makerEmail: a.makerEmail,
        checkerAdminUserId: a.checkerAdminUserId,
        checkerEmail: a.checkerEmail,
        reason: a.reason,
        decisionReason: a.decisionReason,
        decidedAt: a.decidedAt?.toISOString() ?? null,
        expiresAt: a.expiresAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
      })),
    });
  })
```

Replace the body of `.post('/:id/reject')` after the two parses:

```ts
    await adminApprovalDispatch.reject(db, {
      approvalId: params.id,
      checkerAdminUserId: actor.adminUserId,
      reason: body.reason ?? null,
    });
    return c.body(null, 204);
```

and delete the now-unused `adminIamService` import only if nothing else in the file uses it (the list handler does — keep it).

- [ ] **Step 6: Run the new tests and the neighbours**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/admin-approvals.inbox.test.ts tests/routes/admin-iam.test.ts tests/routes/vendors-admin.approvals.test.ts`
Expected: all PASS. If `admin-iam.test.ts` has a case where an `iam.read`-only account rejects, update that case to use an `admin` (`iam.write`) account and note the plan change in the test comment.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter @amana/backend typecheck
pnpm exec biome check apps/backend/src apps/backend/tests
git add apps/backend
git commit -m "feat(admin): scope the approvals inbox per kind, and make rejecting need the deciding permission"
```

---

### Task 2: Backend — a vendor the portal can actually show

**Files:**
- Create: `apps/backend/src/lib/vendor-summary.ts`
- Modify: `apps/backend/src/modules/vendors/vendors.repo.ts` (add `search`, `findManyByIds`)
- Modify: `apps/backend/src/modules/vendors/vendor-claims.repo.ts` (add `listForVendor`)
- Modify: `apps/backend/src/routes/vendors-admin.ts`
- Test: `apps/backend/tests/routes/vendors-admin.read.test.ts`

**Interfaces:**
- Produces: `vendorSummary(v: VendorRow): VendorSummary` with `VendorSummary = { id, displayName, bankCode, accountNumberMasked, status, category, categorySource, publicCode, promotedHouseholdCount, promotedAt, claimedAt }`; `GET /vendors-admin/vendors?status=&q=` → `{ vendors: VendorSummary[] }`; `GET /vendors-admin/vendors/:id` → `{ vendor: VendorSummary, claimAttempts: ClaimAttemptRow[] }`; `GET /vendors-admin/claim-queue` → `{ attempts: (ClaimAttemptRow & { vendor: VendorSummary | null })[] }`.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/routes/vendors-admin.read.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { vendorClaimsRepo } from '../../src/modules/vendors/vendor-claims.repo';
import { vendorsRepo } from '../../src/modules/vendors/vendors.repo';
import { createServer } from '../../src/server';
import { signedInAdmin } from '../helpers/admin-session';
import { factories } from '../helpers/factories';
import { stubOidcProvider } from '../helpers/oidc-stub';
import { testDb, truncateAll } from '../helpers/test-db';

const app = createServer({ adminOidcProvider: stubOidcProvider() });
const NOW = new Date();

async function promote(displayName: string, accountNumber = factories.bankAccount()) {
  const v = await vendorsRepo.promoteIfAbsent(testDb, {
    bankCode: factories.bankCode(),
    accountNumber,
    displayName,
    promotedHouseholdCount: 6,
    now: NOW,
  });
  if (!v) throw new Error('promotion failed');
  return v;
}

describe('vendor reads for ops', () => {
  beforeEach(truncateAll);

  it('GET /vendors-admin/vendors/:id masks the account number and lists claim attempts', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const v = await promote('CORNER SHOP', '0123456789');
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(Date.now() + 60_000),
      now: NOW,
      renewableSince: new Date(NOW.getTime() - 3_600_000),
    });

    const res = await app.request(`/vendors-admin/vendors/${v.id}`, {
      headers: { cookie: ops.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vendor: { accountNumberMasked: string; displayName: string; status: string };
      claimAttempts: Array<{ status: string }>;
    };
    expect(body.vendor.displayName).toBe('CORNER SHOP');
    expect(body.vendor.accountNumberMasked).toBe('••••6789');
    expect(JSON.stringify(body)).not.toContain('0123456789');
    expect(body.claimAttempts).toHaveLength(1);
    expect(body.claimAttempts[0]?.status).toBe('pending');
  });

  it('GET /vendors-admin/vendors/:id is 404 for an unknown vendor and 400 for a bad id', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const missing = await app.request('/vendors-admin/vendors/00000000-0000-4000-8000-000000000000', {
      headers: { cookie: ops.cookie },
    });
    expect(missing.status).toBe(404);
    const bad = await app.request('/vendors-admin/vendors/not-a-uuid', {
      headers: { cookie: ops.cookie },
    });
    expect(bad.status).toBe(400);
  });

  it('GET /vendors-admin/vendors filters by status and searches by name or code', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const a = await promote('MAMA PUT KITCHEN');
    const b = await promote('BOLA TYRES');
    await vendorsRepo.setStatus(testDb, b.id, 'suspended');

    const observed = await app.request('/vendors-admin/vendors?status=observed', {
      headers: { cookie: ops.cookie },
    });
    const ob = (await observed.json()) as { vendors: Array<{ id: string }> };
    expect(ob.vendors.map((v) => v.id)).toEqual([a.id]);

    const byName = await app.request('/vendors-admin/vendors?q=tyres', {
      headers: { cookie: ops.cookie },
    });
    const bn = (await byName.json()) as { vendors: Array<{ id: string }> };
    expect(bn.vendors.map((v) => v.id)).toEqual([b.id]);
  });

  it('claim-queue rows carry a masked vendor summary', async () => {
    const ops = await signedInAdmin('ops@amana-ng.com', ['ops']);
    const v = await promote('QUEUE SHOP', '1122334455');
    await vendorClaimsRepo.openAttempt(testDb, {
      vendorId: v.id,
      phone: factories.phone(),
      expiresAt: new Date(Date.now() + 60_000),
      now: NOW,
      renewableSince: new Date(NOW.getTime() - 3_600_000),
    });
    const res = await app.request('/vendors-admin/claim-queue', { headers: { cookie: ops.cookie } });
    const body = (await res.json()) as {
      attempts: Array<{ vendor: { displayName: string; accountNumberMasked: string } | null }>;
    };
    expect(body.attempts[0]?.vendor?.displayName).toBe('QUEUE SHOP');
    expect(body.attempts[0]?.vendor?.accountNumberMasked).toBe('••••4455');
    expect(JSON.stringify(body)).not.toContain('1122334455');
  });

  it('refuses an admin without vendor.read', async () => {
    const admin = await signedInAdmin('admin@amana-ng.com', ['admin']);
    const res = await app.request('/vendors-admin/vendors', { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendors-admin.read.test.ts`
Expected: FAIL — `/vendors-admin/vendors/:id` falls through to the catch-all and answers 401; the queue rows have no `vendor`.

- [ ] **Step 3: The summary serialiser**

`apps/backend/src/lib/vendor-summary.ts`:

```ts
import type { VendorRow } from '../modules/vendors/vendors.repo';

export type VendorSummary = {
  id: string;
  displayName: string;
  bankCode: string;
  /** Last four digits only. Ops never needs the full number; the claim already carries the bank identity. */
  accountNumberMasked: string;
  status: VendorRow['status'];
  category: string | null;
  categorySource: VendorRow['categorySource'];
  publicCode: string | null;
  promotedHouseholdCount: number;
  promotedAt: string;
  claimedAt: string | null;
};

export function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export function vendorSummary(v: VendorRow): VendorSummary {
  return {
    id: v.id,
    displayName: v.displayName,
    bankCode: v.bankCode,
    accountNumberMasked: maskAccount(v.accountNumber),
    status: v.status,
    category: v.category,
    categorySource: v.categorySource,
    publicCode: v.publicCode,
    promotedHouseholdCount: v.promotedHouseholdCount,
    promotedAt: v.promotedAt.toISOString(),
    claimedAt: v.claimedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 4: Repo methods**

In `apps/backend/src/modules/vendors/vendors.repo.ts`, ensure the drizzle import includes `and, desc, eq, ilike, inArray, or, sql` and add to `vendorsRepo`:

```ts
  async findManyByIds(db: DbOrTx, ids: readonly string[]): Promise<VendorRow[]> {
    if (ids.length === 0) return [];
    return db.select().from(vendors).where(inArray(vendors.id, [...ids]));
  },

  /**
   * Ops search. `q` matches the display name (case-insensitive substring) or the public code
   * exactly, which is what an operator has in hand: a shop name from a call, or a code from a
   * sticker. Newest promotions first, capped at 200 like the claim queue.
   */
  async search(
    db: DbOrTx,
    opts: { status?: VendorRow['status']; q?: string },
  ): Promise<VendorRow[]> {
    const clauses = [];
    if (opts.status) clauses.push(eq(vendors.status, opts.status));
    if (opts.q) {
      const term = opts.q.trim();
      clauses.push(
        or(ilike(vendors.displayName, `%${term}%`), eq(vendors.publicCode, term.toUpperCase())),
      );
    }
    return db
      .select()
      .from(vendors)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(vendors.promotedAt))
      .limit(200);
  },
```

In `apps/backend/src/modules/vendors/vendor-claims.repo.ts` add:

```ts
  /** Every attempt against one vendor, newest first — the history an operator reads before deciding. */
  async listForVendor(db: DbOrTx, vendorId: string): Promise<ClaimAttemptRow[]> {
    return db
      .select()
      .from(vendorClaimAttempts)
      .where(eq(vendorClaimAttempts.vendorId, vendorId))
      .orderBy(desc(vendorClaimAttempts.createdAt))
      .limit(50);
  },
```

- [ ] **Step 5: Routes**

In `apps/backend/src/routes/vendors-admin.ts` add imports `import { vendorSummary } from '../lib/vendor-summary';` and `parseQuery`, plus:

```ts
const VendorListQuery = z.object({
  status: z.enum(['observed', 'claimed', 'suspended']).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
```

Replace the claim-queue handler and add the two reads **above** the `/vendors/:id/approve-claim` route:

```ts
  .get('/claim-queue', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.read');
    const rows = await vendorClaimsRepo.listPendingForOps(db, new Date());
    const vendorsById = new Map(
      (await vendorsRepo.findManyByIds(db, [...new Set(rows.map((r) => r.vendorId))])).map((v) => [
        v.id,
        vendorSummary(v),
      ]),
    );
    return c.json(
      { attempts: rows.map((r) => ({ ...r, vendor: vendorsById.get(r.vendorId) ?? null })) },
      200,
    );
  })

  .get('/vendors', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.read');
    const query = parseQuery(c, VendorListQuery);
    if (query instanceof Response) return query;
    const rows = await vendorsRepo.search(db, query);
    return c.json({ vendors: rows.map(vendorSummary) }, 200);
  })

  .get('/vendors/:id', async (c) => {
    const actor = c.get('adminActor');
    await adminIamService.requirePermission(db, actor.adminUserId, 'vendor.read');
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const vendor = await vendorsRepo.findById(db, params.id);
    if (!vendor) return c.json({ error: 'not_found' }, 404);
    const claimAttempts = await vendorClaimsRepo.listForVendor(db, params.id);
    return c.json({ vendor: vendorSummary(vendor), claimAttempts }, 200);
  })
```

- [ ] **Step 6: Run the tests, then the cutover test**

Run: `pnpm --filter @amana/backend exec vitest run tests/routes/vendors-admin.read.test.ts tests/routes/vendors-admin.test.ts tests/routes/admin-cutover.test.ts`
Expected: all PASS. (The cutover test enumerates 13 endpoints and asserts the old key is refused; the two new GETs are session-guarded by the router's `.use('*', adminSession())`, so add them to that test's list so the count becomes 15 and the proof stays exhaustive.)

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter @amana/backend typecheck && pnpm exec biome check apps/backend
git add apps/backend
git commit -m "feat(vendors-admin): vendor read and search for ops, with the account number masked"
```

---

### Task 3: Portal scaffold, tokens, health, and the tested proxy

**Files:**
- Create: `apps/admin-portal/package.json`, `tsconfig.json`, `next-env.d.ts`, `next.config.mjs`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/icon.svg`, `app/health/route.ts`, `lib/proxy.ts`, `app/admin/[...path]/route.ts`, `app/vendors-admin/[...path]/route.ts`, `app/retailers/[...path]/route.ts`, `test/setup.ts`
- Test: `apps/admin-portal/lib/proxy.test.ts`

**Interfaces:**
- Produces: `proxyToBackend(request: Request, opts: { backendOrigin: string; fetchImpl?: typeof fetch }): Promise<Response>`; the three catch-all route modules export `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: package.json and configs**

`apps/admin-portal/package.json`:

```json
{
  "name": "@amana/admin-portal",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3400",
    "build": "next build",
    "start": "next start --port 3400",
    "lint": "biome check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "14.2.15",
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/react": "~18.2.79",
    "@types/react-dom": "~18.2.25",
    "@types/react-test-renderer": "^18.3.1",
    "react-test-renderer": "18.2.0",
    "typescript": "^5.5.4",
    "vitest": "2.1.2"
  }
}
```

`tsconfig.json`: copy `apps/retailer-portal/tsconfig.json` verbatim. `next-env.d.ts`: copy verbatim.

`next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone so the Docker image ships `.next/standalone` + a node server, not the pnpm tree.
  output: 'standalone',
  // No `rewrites`: the backend prefixes are proxied by explicit Route Handlers under app/, which
  // copy status, Set-Cookie and Location by hand and are unit-tested. See lib/proxy.ts.
};

export default nextConfig;
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // One React instance for the component and react-test-renderer (pnpm otherwise splits it).
      react: root('../../node_modules/react'),
      'react/jsx-runtime': root('../../node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': root('../../node_modules/react/jsx-dev-runtime'),
      'next/navigation': root('./test/next.mock.tsx'),
      'next/link': root('./test/next.mock.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx', 'app/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    globals: false,
  },
});
```

`test/setup.ts`:

```ts
// Component tests run under node; pages read the browser only inside effects, which the render
// helper drives with `act`. Nothing global is needed yet, but the file exists so vitest.config is
// stable when something is.
export {};
```

- [ ] **Step 2: Layout, tokens, icon, health**

`app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Amana staff',
  description: 'Work the approvals inbox, vendors, retailers and access for Amana.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/globals.css` — the token block copied from `apps/retailer-portal/app/globals.css` **with its origin comment**, then the vocabulary. Full file:

```css
/*
 * Design tokens copied from @amana/ui (packages/ui/src/theme/tokens.ts).
 *
 * Copied, not imported — the accepted cost recorded for the retailer portal in
 * docs/superpowers/plans/2026-08-24-marketplace-sp4b-retailer-portal.md applies here for the same
 * reason: @amana/ui ships React Native source that Metro transpiles, and a Next app cannot consume
 * it. The tokens are duplicated ONCE per portal; the drift table in UI-UX-DESIGN-BRIEF.md §9.2
 * tracks both copies. If those tokens change, this file changes with them.
 */
:root {
  --bg-base: #0d1b2a;
  --bg-surface: #152535;
  --bg-raised: #1c3147;
  --text-primary: #f5f0e8;
  --text-secondary: #8ba3b8;
  --text-muted: #5a8ca8;
  --accent: #c9a227;
  --accent-dim: rgba(201, 162, 39, 0.18);
  --debit: #ff6b6b;
  --credit: #52c49a;
  --border: rgba(255, 255, 255, 0.06);
  --radius: 10px;
  --serif: Georgia, 'Times New Roman', serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg-base); color: var(--text-primary); }
body { font: 15px / 1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
a { color: inherit; }

h1, h2, h3 { font-family: var(--serif); margin: 0; }
h1 { font-size: 26px; line-height: 1.2; }
h2 { font-size: 18px; margin-bottom: 8px; }
.sub { color: var(--text-secondary); margin: 4px 0 20px; max-width: 64ch; }

/* Shell: rail + content. The rail holds the person; attribution stays on screen. */
.shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.rail { background: var(--bg-surface); border-right: 1px solid var(--border); padding: 24px 18px; display: flex; flex-direction: column; gap: 6px; }
.rail .brand { font-family: var(--serif); font-size: 20px; margin-bottom: 18px; }
.rail a { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-radius: 8px; text-decoration: none; color: var(--text-secondary); }
.rail a[aria-current='page'] { background: var(--accent-dim); color: var(--accent); }
.rail .count { font-family: var(--serif); font-size: 18px; color: var(--accent); font-variant-numeric: tabular-nums; }
.rail .person { margin-top: auto; padding-top: 18px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-secondary); word-break: break-all; }
.rail .person strong { display: block; color: var(--text-primary); }
main { padding: 30px 34px 60px; max-width: 1080px; }

.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 14px; }
label { display: block; font-size: 12px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text-secondary); margin: 12px 0 6px; }
input, select, textarea { width: 100%; max-width: 420px; background: var(--bg-raised); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; font: inherit; }
input:focus, select:focus, textarea:focus, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button { font: inherit; font-weight: 600; background: var(--accent); color: var(--bg-base); border: 0; border-radius: 8px; padding: 9px 14px; cursor: pointer; }
button.secondary { background: var(--bg-raised); color: var(--text-primary); }
button.danger { background: transparent; color: var(--debit); border: 1px solid var(--debit); }
button:disabled { opacity: 0.55; cursor: default; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; color: var(--text-secondary); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--border); }
td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
.num, .mono { font-variant-numeric: tabular-nums; white-space: nowrap; }

.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; background: var(--bg-raised); color: var(--text-secondary); }
.pill.ok { background: rgba(82, 196, 154, 0.15); color: var(--credit); }
.pill.warn { background: var(--accent-dim); color: var(--accent); }
.pill.bad { background: rgba(255, 107, 107, 0.15); color: var(--debit); }

.banner { background: var(--bg-raised); border-left: 3px solid var(--accent); padding: 12px 14px; border-radius: 6px; margin-bottom: 16px; }
.banner.bad { border-left-color: var(--debit); }
.err { color: var(--debit); margin: 8px 0; }
.ok-msg { color: var(--credit); margin: 8px 0; }
.muted { color: var(--text-secondary); }
.center { max-width: 400px; margin: 11vh auto; }

/* The two-seat approval line. */
.approval { display: grid; grid-template-columns: 1fr auto; gap: 14px; }
.approval .what { font-family: var(--serif); font-size: 18px; }
.seats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
.seat { border: 1px dashed var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.seat.filled { border-style: solid; }
.seat .who { display: block; color: var(--text-primary); word-break: break-all; }
.code { font-family: var(--serif); font-size: 24px; letter-spacing: 0.04em; color: var(--accent); }

@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; }
  .rail { flex-direction: row; flex-wrap: wrap; }
  .rail .person { margin-top: 0; border-top: 0; width: 100%; }
  .seats { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

`app/icon.svg`: copy `apps/retailer-portal/app/icon.svg` verbatim (navy square, gold "A", `role="img" aria-label="Amana"`).

`app/health/route.ts`:

```ts
/** Fly's health check. Static on purpose — a portal that can render is a portal that is up. */
export const dynamic = 'force-dynamic';
export function GET(): Response {
  return Response.json({ status: 'ok' });
}
```

- [ ] **Step 3: Write the failing proxy test**

`apps/admin-portal/lib/proxy.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { proxyToBackend } from './proxy';

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  ) as unknown as typeof fetch;
}

describe('proxyToBackend', () => {
  it('forwards method, path, query, cookie and body to the backend origin', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = fakeFetch((url, init) => {
      seen.url = url;
      seen.init = init;
      return Response.json({ ok: true }, { status: 200 });
    });
    const req = new Request('https://admin.amana-ng.com/admin/iam/admins?x=1', {
      method: 'POST',
      headers: { cookie: 'amana_admin_session=abc', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@amana-ng.com' }),
    });
    const res = await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(res.status).toBe(200);
    expect(seen.url).toBe('http://localhost:3000/admin/iam/admins?x=1');
    expect(seen.init?.method).toBe('POST');
    const headers = new Headers(seen.init?.headers);
    expect(headers.get('cookie')).toBe('amana_admin_session=abc');
    expect(headers.get('content-type')).toBe('application/json');
    expect(await new Response(seen.init?.body as BodyInit).text()).toContain('a@amana-ng.com');
  });

  it('passes a 302 with Set-Cookie through untouched — the OAuth callback depends on it', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://admin.amana-ng.com',
            'set-cookie': 'amana_admin_session=tok; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        }),
    );
    const req = new Request('https://admin.amana-ng.com/admin/auth/callback?code=c&state=s');
    const res = await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://admin.amana-ng.com');
    expect(res.headers.get('set-cookie')).toContain('amana_admin_session=tok');
  });

  it('never follows redirects itself', async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 302, headers: { location: '/' } }));
    const req = new Request('https://admin.amana-ng.com/admin/auth/start');
    await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    const init = (fetchImpl as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]?.[1];
    expect(init?.redirect).toBe('manual');
  });

  it('adds the browser address as x-forwarded-for and drops hop-by-hop headers', async () => {
    let headers = new Headers();
    const fetchImpl = fakeFetch((_u, init) => {
      headers = new Headers(init.headers);
      return new Response('', { status: 204 });
    });
    const req = new Request('https://admin.amana-ng.com/retailers', {
      headers: { 'x-forwarded-for': '41.58.1.1', host: 'admin.amana-ng.com', connection: 'keep-alive' },
    });
    await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(headers.get('x-forwarded-for')).toBe('41.58.1.1');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('connection')).toBeNull();
  });

  it('answers 502 with a stable body when the backend is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const req = new Request('https://admin.amana-ng.com/admin/me');
    const res = await proxyToBackend(req, { backendOrigin: 'http://localhost:3000', fetchImpl });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'backend_unreachable' });
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL — `./proxy` does not exist. (Run `pnpm install` first so the new workspace package's deps link.)

- [ ] **Step 5: Implement the proxy and the three route modules**

`apps/admin-portal/lib/proxy.ts`:

```ts
/**
 * Same-origin proxy for the backend's staff routes.
 *
 * The API sets the staff session as a host-only `HttpOnly; Secure; SameSite=Lax` cookie with no
 * `domain`, so it belongs to whichever host the browser got the `Set-Cookie` from. For the
 * portal's own fetches to carry it, the portal host must BE that host — hence `/admin/*`,
 * `/vendors-admin/*` and `/retailers/*` are answered here and forwarded, and the browser never
 * talks to `api.amana-ng.com` directly.
 *
 * Written as an explicit handler rather than `next.config` rewrites because the one response that
 * matters most — the OAuth callback, a 302 that also carries the Set-Cookie — must pass through
 * byte-for-byte, and this function is the one place that guarantees it (and is tested for it).
 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'content-length',
]);

export type ProxyOptions = { backendOrigin: string; fetchImpl?: typeof fetch };

export async function proxyToBackend(request: Request, opts: ProxyOptions): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, opts.backendOrigin);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Fly stamps `fly-client-ip` with the portal machine, so the API's per-IP limiter on
  // /admin/auth/* sees one address for all staff. That is accepted (a handful of people, 60 per
  // 15 minutes); the browser's address travels in x-forwarded-for for logs.
  if (!headers.has('x-forwarded-for')) {
    const ip = request.headers.get('x-real-ip');
    if (ip) headers.set('x-forwarded-for', ip);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetchImpl(target.toString(), {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      // The backend's redirects are for the BROWSER (Google, then back to the portal). Following
      // them here would swallow the Set-Cookie on the callback and land the proxy on a page.
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: 'backend_unreachable' }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value);
  });
  // `Headers.forEach` folds multiple Set-Cookie values; use getSetCookie where the runtime has it.
  const cookies = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (cookies && cookies.length > 0) {
    out.delete('set-cookie');
    for (const c of cookies) out.append('set-cookie', c);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
```

Each of `app/admin/[...path]/route.ts`, `app/vendors-admin/[...path]/route.ts`, `app/retailers/[...path]/route.ts` is this exact file:

```ts
import { proxyToBackend } from '../../../lib/proxy';

export const dynamic = 'force-dynamic';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';

const handler = (request: Request): Promise<Response> =>
  proxyToBackend(request, { backendOrigin: BACKEND_ORIGIN });

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
```

`GET /retailers` (no sub-path) must also proxy: add `app/retailers/route.ts` with the same content (import path `../../lib/proxy`). Same for `app/admin/route.ts`? Not needed — nothing is mounted at bare `/admin`. `app/vendors-admin/route.ts` likewise not needed.

- [ ] **Step 6: Run the tests, typecheck, build**

Run: `pnpm install && pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm --filter @amana/admin-portal build`
Expected: 5 tests PASS; typecheck clean; `next build` succeeds and prints the `/health`, `/admin/[...path]` routes as dynamic.

- [ ] **Step 7: Smoke the proxy against the real backend**

With `pnpm --filter @amana/backend dev` running in another shell and `pnpm --filter @amana/admin-portal dev`:

```bash
curl -i http://localhost:3400/health
curl -i http://localhost:3400/admin/me           # expect 401 {"error":"admin_unauthorized"} FROM THE BACKEND
curl -i http://localhost:3400/admin/auth/start   # expect 302 with a Google Location
```

- [ ] **Step 8: Commit**

```bash
pnpm exec biome check apps/admin-portal
git add apps/admin-portal pnpm-lock.yaml
git commit -m "feat(admin-portal): scaffold, tokens, health check and a tested same-origin proxy"
```

---

### Task 4: The API layer, wire types and copy

**Files:**
- Create: `apps/admin-portal/lib/types.ts`, `lib/api.ts`, `lib/copy.ts`
- Test: `lib/api.test.ts`, `lib/copy.test.ts`

**Interfaces:**
- Produces:
  - `lib/types.ts`: `Me`, `Permission`, `Role`, `Approval`, `ApprovalKind`, `ApprovalOutcome`, `AdminSummary`, `RoleGrant`, `VendorSummary`, `ClaimAttempt`, `ConsentRow`, `Retailer`, `RetailerStatus`, `SPEND_CATEGORIES` (value/label list copied from `packages/types/src/categories.ts` — 11 entries).
  - `lib/api.ts`: `class ApiError extends Error { status: number; code: string; detail: string | null }`, `request<T>(path, init?)`, and `api = { me, signOut, approvals: { list(status), approve(id, reason), reject(id, reason), cancel(id) }, iam: { admins(), onboard(email), grants(id), grant(id, role, reason), revoke(id, role, reason) }, vendors: { queue(), search(status?, q?), get(id), proposeClaim(id, phone, category), setCategory(id, category), suspend(id), consents(id), revokeConsent(id, purpose), setEnforcement(householdId, enforced) }, retailers: { list(status), get(id), create(input), kyb(id, input), approve(id), suspend(id) } }`. `signInHref = '/admin/auth/start'`.
  - `lib/copy.ts`: `errorMessage(e: unknown): string`, `describeApproval(a: Approval, vendorName?: string): string`, `relativeTime(iso: string, now?: Date): string`, `maskPhone(phone: string): string`.

- [ ] **Step 1: Write the failing tests**

`lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, request } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses relative paths with same-origin credentials', async () => {
    const f = vi.fn(async () => json({ id: '1' }));
    vi.stubGlobal('fetch', f);
    await request('/admin/me');
    expect(f).toHaveBeenCalledWith('/admin/me', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('throws ApiError carrying the backend code and detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'conflict', detail: 'approval_not_pending' }, 409)));
    await expect(request('/x')).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      detail: 'approval_not_pending',
    } satisfies Partial<ApiError>);
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await request('/x', { method: 'POST' })).toBeUndefined();
  });

  it('posts JSON bodies', async () => {
    const f = vi.fn(async () => json({ approvalId: 'a', status: 'pending' }, 202));
    vi.stubGlobal('fetch', f);
    await api.iam.grant('u1', 'ops', 'why');
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ role: 'ops', reason: 'why' });
  });

  it('builds the vendor search query only from present params', async () => {
    const f = vi.fn(async () => json({ vendors: [] }));
    vi.stubGlobal('fetch', f);
    await api.vendors.search(undefined, 'tyres');
    expect(f.mock.calls[0]?.[0]).toBe('/vendors-admin/vendors?q=tyres');
  });
});
```

`lib/copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeApproval, errorMessage, maskPhone, relativeTime } from './copy';

describe('errorMessage', () => {
  it('never explains a 403 beyond permission', () => {
    expect(errorMessage(new ApiError(403, 'forbidden', null))).toBe("You don't have permission for that.");
  });
  it('names the decided-already case', () => {
    expect(errorMessage(new ApiError(409, 'conflict', 'approval_not_pending'))).toBe(
      'Someone already decided this one.',
    );
  });
  it('explains a lost backend', () => {
    expect(errorMessage(new ApiError(502, 'backend_unreachable', null))).toMatch(/could not reach/i);
  });
  it('falls back to a plain sentence', () => {
    expect(errorMessage(new Error('x'))).toBe('Something went wrong. Try again.');
  });
});

describe('describeApproval', () => {
  it('says what a role grant does', () => {
    expect(
      describeApproval({
        id: '1', kind: 'role_grant', status: 'pending', makerAdminUserId: 'm', makerEmail: 'a@amana-ng.com',
        checkerAdminUserId: null, checkerEmail: null, reason: null, decisionReason: null, decidedAt: null,
        expiresAt: '2026-09-14T00:00:00Z', createdAt: '2026-09-07T00:00:00Z',
        payload: { targetAdminUserId: 't', role: 'admin' },
      }, 'ada@amana-ng.com'),
    ).toBe('Make ada@amana-ng.com an admin');
  });
  it('says what a vendor claim does, with the phone masked', () => {
    expect(
      describeApproval({
        id: '1', kind: 'vendor_approve_claim', status: 'pending', makerAdminUserId: 'm', makerEmail: 'a@amana-ng.com',
        checkerAdminUserId: null, checkerEmail: null, reason: null, decisionReason: null, decidedAt: null,
        expiresAt: '2026-09-14T00:00:00Z', createdAt: '2026-09-07T00:00:00Z',
        payload: { vendorId: 'v', phone: '+2348031234567', category: 'food' },
      }, 'CORNER SHOP'),
    ).toBe("Give CORNER SHOP's account to +234 803 ••• 4567");
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  it('reads forwards and backwards', () => {
    expect(relativeTime('2026-09-13T12:00:00Z', now)).toBe('in 6 days');
    expect(relativeTime('2026-09-07T11:15:00Z', now)).toBe('45 minutes ago');
    expect(relativeTime('2026-09-07T11:59:40Z', now)).toBe('just now');
  });
});

describe('maskPhone', () => {
  it('keeps country code, prefix and last four', () => {
    expect(maskPhone('+2348031234567')).toBe('+234 803 ••• 4567');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Types**

`lib/types.ts`:

```ts
export type Role = 'owner' | 'admin' | 'ops' | 'support' | 'auditor';
export type Permission =
  | 'vendor.read' | 'vendor.write' | 'retailer.read' | 'retailer.write'
  | 'iam.read' | 'iam.write' | 'audit.read'
  | 'support.verify' | 'support.read' | 'money.operate';

export type Me = {
  id: string;
  email: string;
  displayName: string | null;
  roles: Role[];
  permissions: Permission[];
};

export type ApprovalKind = 'role_grant' | 'vendor_approve_claim';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type RoleGrantPayload = { targetAdminUserId: string; role: Role };
export type VendorClaimPayload = { vendorId: string; phone: string; category: string | null };

export type Approval = {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  payload: RoleGrantPayload | VendorClaimPayload;
  makerAdminUserId: string;
  makerEmail: string;
  checkerAdminUserId: string | null;
  checkerEmail: string | null;
  reason: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};

export type ApprovalOutcome =
  | { kind: 'role_grant' }
  | { kind: 'vendor_approve_claim'; publicCode: string; displayName: string | null };

export type AdminSummary = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'suspended';
  provisioningSource: 'config' | 'admin';
  lastSignedInAt: string | null;
  roles: Role[];
};

export type RoleGrant = {
  role: Role;
  granted: boolean;
  grantedByAdminUserId: string | null;
  source: 'config' | 'admin';
  reason: string | null;
  recordedAt: string;
};

export type VendorStatus = 'observed' | 'claimed' | 'suspended';
export type VendorSummary = {
  id: string;
  displayName: string;
  bankCode: string;
  accountNumberMasked: string;
  status: VendorStatus;
  category: string | null;
  categorySource: 'observed' | 'claimed' | 'ops';
  publicCode: string | null;
  promotedHouseholdCount: number;
  promotedAt: string;
  claimedAt: string | null;
};

export type ClaimAttempt = {
  id: string;
  vendorId: string;
  phone: string;
  status: 'pending' | 'verified' | 'expired' | 'rejected';
  ownershipProof: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
  vendor?: VendorSummary | null;
};

export type ConsentPurpose = 'service_terms' | 'lender_introduction';
export type ConsentRow = {
  id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  termsVersion: string | null;
  source: string;
  recordedAt: string;
};

export type RetailerStatus = 'applied' | 'kyb_pending' | 'approved' | 'suspended';
export type Retailer = {
  id: string;
  businessName: string;
  anchorBusinessCustomerId: string | null;
  payoutBankCode: string;
  payoutAccountNumber: string;
  onboardingStatus: RetailerStatus;
  ownerUserId: string | null;
  contactPhone: string | null;
  approvedAt: string | null;
  createdAt: string;
};

/** Copied from packages/types/src/categories.ts — the closed vocabulary both sides validate. */
export const SPEND_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'transport', label: 'Transport' },
  { value: 'food', label: 'Food & market' },
  { value: 'school', label: 'School' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'airtime_data', label: 'Airtime & data' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'cable_tv', label: 'Cable TV' },
  { value: 'health', label: 'Health & pharmacy' },
  { value: 'repairs', label: 'Repairs & maintenance' },
  { value: 'supplies', label: 'Business supplies' },
  { value: 'other', label: 'Other' },
];

export const ROLES: readonly Role[] = ['owner', 'admin', 'ops', 'support', 'auditor'];
```

- [ ] **Step 4: The API module**

`lib/api.ts`:

```ts
import type {
  AdminSummary, Approval, ApprovalOutcome, ApprovalStatus, ClaimAttempt, ConsentPurpose, ConsentRow,
  Me, Retailer, RetailerStatus, Role, VendorStatus, VendorSummary,
} from './types';

/**
 * The portal's API layer. Relative paths, same-origin credentials, no token store: the session is
 * a cookie the backend set on THIS host (see lib/proxy.ts), so the browser attaches it on its own.
 *
 * Deliberately not `@amana/api-client` — that client exists for bearer-token mobile apps, insists
 * on a token store, and never sends credentials. Teaching it cookies to serve one web app would
 * put risk into the two apps that move money for no mobile benefit. This is the recorded
 * exception to the retailer portal's "consume only the client" rule.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail: string | null,
  ) {
    super(`${status} ${code}${detail ? `: ${detail}` : ''}`);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    | ({ error?: string; detail?: string } & Record<string, unknown>)
    | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'unknown', body?.detail ?? null);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

/** Where sign-in begins. A plain link, not a fetch: the backend answers with a redirect to Google. */
export const signInHref = '/admin/auth/start';

export const api = {
  me: () => request<Me>('/admin/me'),
  signOut: () => post<void>('/admin/auth/logout'),

  approvals: {
    list: (status: 'pending' | 'decided' = 'pending') =>
      request<{ approvals: Approval[] }>(`/admin/approvals${qs({ status })}`),
    approve: (id: string, reason?: string) =>
      post<ApprovalOutcome>(`/admin/approvals/${id}/approve`, { reason }),
    reject: (id: string, reason?: string) => post<void>(`/admin/approvals/${id}/reject`, { reason }),
    cancel: (id: string) => post<void>(`/admin/approvals/${id}/cancel`),
  },

  iam: {
    admins: () => request<{ admins: AdminSummary[] }>('/admin/iam/admins'),
    onboard: (email: string) => post<{ id: string; email: string; roles: Role[] }>('/admin/iam/admins', { email }),
    grants: (id: string) => request<{ grants: import('./types').RoleGrant[] }>(`/admin/iam/admins/${id}/roles`),
    grant: (id: string, role: Role, reason?: string) =>
      post<{ approvalId: string; status: ApprovalStatus }>(`/admin/iam/admins/${id}/roles`, { role, reason }),
    revoke: (id: string, role: Role, reason?: string) =>
      post<void>(`/admin/iam/admins/${id}/roles/revoke`, { role, reason }),
  },

  vendors: {
    queue: () => request<{ attempts: ClaimAttempt[] }>('/vendors-admin/claim-queue'),
    search: (status?: VendorStatus, q?: string) =>
      request<{ vendors: VendorSummary[] }>(`/vendors-admin/vendors${qs({ status, q })}`),
    get: (id: string) =>
      request<{ vendor: VendorSummary; claimAttempts: ClaimAttempt[] }>(`/vendors-admin/vendors/${id}`),
    proposeClaim: (id: string, phone: string, category: string | null) =>
      post<{ approvalId: string; status: ApprovalStatus }>(`/vendors-admin/vendors/${id}/approve-claim`, { phone, category }),
    setCategory: (id: string, category: string | null) =>
      post<{ ok: true }>(`/vendors-admin/vendors/${id}/category`, { category }),
    suspend: (id: string) => post<{ ok: true }>(`/vendors-admin/vendors/${id}/suspend`),
    consents: (id: string) =>
      request<{ current: Partial<Record<ConsentPurpose, ConsentRow>>; history: ConsentRow[] }>(`/vendors-admin/vendors/${id}/consents`),
    revokeConsent: (id: string, purpose: ConsentPurpose) =>
      post<{ ok: true }>(`/vendors-admin/vendors/${id}/consents/revoke`, { purpose }),
    setEnforcement: (householdId: string, enforced: boolean | null) =>
      post<{ ok: true }>(`/vendors-admin/households/${householdId}/enforcement`, { enforced }),
  },

  retailers: {
    list: (status: RetailerStatus = 'applied') => request<Retailer[]>(`/retailers${qs({ status })}`),
    get: (id: string) => request<Retailer>(`/retailers/${id}`),
    create: (input: { businessName: string; payoutBankCode: string; payoutAccountNumber: string }) =>
      post<Retailer>('/retailers', input),
    kyb: (id: string, input: { bvn: string; rcNumber?: string; email?: string }) =>
      post<Retailer>(`/retailers/${id}/kyb`, input),
    approve: (id: string) => post<Retailer>(`/retailers/${id}/approve`),
    suspend: (id: string) => post<Retailer>(`/retailers/${id}/suspend`),
  },
};
```

(Replace the inline `import('./types').RoleGrant` with a named import at the top — it is written inline above only to keep the interface block readable. Biome's `useImportType` wants `import type { RoleGrant }`.)

- [ ] **Step 5: Copy**

`lib/copy.ts`:

```ts
import { ApiError } from './api';
import type { Approval, RoleGrantPayload, VendorClaimPayload } from './types';

/** Wire errors into sentences an operator can act on. Never a stack trace, never a reason a 403 withholds. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Your session has ended. Sign in again.';
    if (e.status === 403) return "You don't have permission for that.";
    if (e.status === 404) return "That record doesn't exist, or isn't yours to see.";
    if (e.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (e.status === 502) return 'Could not reach the Amana API. Try again in a moment.';
    if (e.code === 'validation_error') return 'Check the highlighted fields and try again.';
    if (e.code === 'anchor_unavailable') return 'The bank partner is unavailable. Nothing changed; try again later.';
    switch (e.detail) {
      case 'approval_not_pending': return 'Someone already decided this one.';
      case 'approval_expired': return 'This request expired before it was decided.';
      case 'not_claimable': return 'This vendor can no longer be claimed — it was suspended or claimed since the proposal.';
      case 'wrong_approval_kind': return 'This request is not the kind you can decide here.';
    }
    if (e.status === 409) return 'That change conflicts with the current state. Refresh and look again.';
  }
  return 'Something went wrong. Try again.';
}

export function maskPhone(phone: string): string {
  // +234 803 123 4567 → +234 803 ••• 4567. Keeps enough to recognise, hides enough to not dial.
  const m = phone.match(/^(\+\d{3})(\d{3})\d+(\d{4})$/);
  return m ? `${m[1]} ${m[2]} ••• ${m[3]}` : phone;
}

export function describeApproval(a: Approval, subjectName?: string): string {
  if (a.kind === 'role_grant') {
    const p = a.payload as RoleGrantPayload;
    const who = subjectName ?? 'this person';
    const article = p.role === 'owner' || p.role === 'admin' || p.role === 'ops' || p.role === 'auditor' ? 'an' : 'a';
    return `Make ${who} ${article} ${p.role}`;
  }
  const p = a.payload as VendorClaimPayload;
  const shop = subjectName ?? 'this vendor';
  return `Give ${shop}'s account to ${maskPhone(p.phone)}`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let text: string;
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) text = unit(Math.round(abs / 60_000), 'minute');
  else if (abs < 86_400_000) text = unit(Math.round(abs / 3_600_000), 'hour');
  else text = unit(Math.round(abs / 86_400_000), 'day');
  return diff > 0 ? `in ${text}` : `${text} ago`;
}
```

- [ ] **Step 6: Run, lint, commit**

Run: `pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm exec biome check apps/admin-portal`
Expected: all PASS.

```bash
git add apps/admin-portal
git commit -m "feat(admin-portal): cookie-authenticated API layer, wire types and operator copy"
```

---

### Task 5: Sign-in page, session shell and the rail

**Files:**
- Create: `lib/me.tsx`, `components/Rail.tsx`, `components/StatusPill.tsx`, `components/Confirm.tsx`, `app/sign-in/page.tsx`, `app/(portal)/layout.tsx`, `test/render.tsx`, `test/next.mock.tsx`
- Test: `app/sign-in/page.test.tsx`, `components/Rail.test.tsx`, `components/Confirm.test.tsx`

**Interfaces:**
- Produces: `MeProvider({ me, children })`, `useMe(): Me`, `can(me, permission): boolean`; `Rail({ pendingCount })`; `StatusPill({ tone: 'ok'|'warn'|'bad'|'neutral', children })`; `Confirm({ label, confirmLabel, onConfirm, tone?: 'danger', disabled? })` — renders a button; first click swaps it for "Yes, {confirmLabel}" + "Cancel"; `test/render.tsx` exports `render(ui)`, `byRole(root, 'button'|'link'|..., name?)`, `byLabel(root, label)`, `textContent(root)`, `click(instance)`, `change(instance, value)`, `flush()`; `test/next.mock.tsx` exports `Link`, `useRouter`, `usePathname`, `useSearchParams`, `useParams`, plus `__setPath(path)`, `__setSearch(qs)`, `__setParams(obj)`, `__router` (spy object).

- [ ] **Step 1: The test harness**

`test/next.mock.tsx`:

```tsx
import type { ReactNode } from 'react';
import { vi } from 'vitest';

let path = '/';
let search = '';
let params: Record<string, string> = {};
export const __router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
export const __setPath = (p: string) => { path = p; };
export const __setSearch = (s: string) => { search = s; };
export const __setParams = (p: Record<string, string>) => { params = p; };

export default function Link({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) {
  return <a href={href} {...rest}>{children}</a>;
}
export const useRouter = () => __router;
export const usePathname = () => path;
export const useSearchParams = () => new URLSearchParams(search);
export const useParams = () => params;
```

`test/render.tsx`:

```tsx
import type React from 'react';
import TestRenderer, { type ReactTestInstance, act } from 'react-test-renderer';

export type Rendered = { root: ReactTestInstance; unmount: () => void };

export function render(ui: React.ReactElement): Rendered {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(ui); });
  return { root: renderer.root, unmount: () => act(() => renderer.unmount()) };
}

/** Let pending promises inside effects settle. */
export async function flush(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const props = (n: ReactTestInstance) => (n.props ?? {}) as Record<string, unknown>;
const isHost = (n: ReactTestInstance) => typeof n.type === 'string';

/** Concatenated text under a node. */
export function textContent(node: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (c: ReactTestInstance | string) => {
    if (typeof c === 'string') out.push(c);
    else (c.children as Array<ReactTestInstance | string>).forEach(walk);
  };
  (node.children as Array<ReactTestInstance | string>).forEach(walk);
  return out.join('');
}

const ROLE_TAGS: Record<string, string[]> = {
  button: ['button'], link: ['a'], heading: ['h1', 'h2', 'h3'], row: ['tr'], textbox: ['input', 'textarea'], combobox: ['select'],
};

/** Web-flavoured byRole: host element type (or explicit role prop) plus accessible name. */
export function allByRole(root: ReactTestInstance, role: string, name?: string): ReactTestInstance[] {
  return root.findAll((n) => {
    if (!isHost(n)) return false;
    const p = props(n);
    const roleMatch = p.role === role || (ROLE_TAGS[role] ?? []).includes(n.type as string);
    if (!roleMatch) return false;
    if (name === undefined) return true;
    const accessible = (p['aria-label'] as string | undefined) ?? textContent(n).trim();
    return accessible === name;
  });
}
export function byRole(root: ReactTestInstance, role: string, name?: string): ReactTestInstance {
  const all = allByRole(root, role, name);
  if (all.length !== 1) throw new Error(`expected 1 ${role}${name ? ` "${name}"` : ''}, found ${all.length}`);
  return all[0] as ReactTestInstance;
}

/** The input a <label htmlFor> points at. */
export function byLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  const lab = root.find((n) => isHost(n) && n.type === 'label' && textContent(n).trim() === label);
  const id = props(lab).htmlFor as string;
  return root.find((n) => isHost(n) && props(n).id === id);
}

export function click(n: ReactTestInstance): void {
  act(() => { (props(n).onClick as ((e: unknown) => void) | undefined)?.({ preventDefault() {} }); });
}
export function submit(form: ReactTestInstance): void {
  act(() => { (props(form).onSubmit as ((e: unknown) => void) | undefined)?.({ preventDefault() {} }); });
}
export function change(n: ReactTestInstance, value: string): void {
  act(() => { (props(n).onChange as ((e: unknown) => void) | undefined)?.({ target: { value } }); });
}
```

- [ ] **Step 2: Write the failing tests**

`app/sign-in/page.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { __setSearch } from '../../test/next.mock';
import { byRole, render, textContent } from '../../test/render';
import SignInPage from './page';

describe('sign-in', () => {
  it('links to the backend start route', () => {
    __setSearch('');
    const { root } = render(<SignInPage />);
    const link = byRole(root, 'link', 'Sign in with Google');
    expect(link.props.href).toBe('/admin/auth/start');
  });
  it('explains a failed sign-in without saying why', () => {
    __setSearch('error=sign_in_failed');
    const { root } = render(<SignInPage />);
    const text = textContent(root);
    expect(text).toContain("Sign-in didn't complete");
    expect(text).toContain('amana-ng.com');
    expect(text).not.toMatch(/not provisioned|suspended|domain/i);
  });
});
```

`components/Rail.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { MeProvider } from '../lib/me';
import type { Me } from '../lib/types';
import { __setPath } from '../test/next.mock';
import { allByRole, byRole, render, textContent } from '../test/render';
import { Rail } from './Rail';

const me = (over: Partial<Me>): Me => ({
  id: 'u', email: 'ops@amana-ng.com', displayName: null, roles: ['ops'],
  permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'], ...over,
});

describe('Rail', () => {
  it('shows only the sections this person can use, and who they are', () => {
    __setPath('/ops/vendors');
    const { root } = render(<MeProvider me={me({})}><Rail pendingCount={2} /></MeProvider>);
    const names = allByRole(root, 'link').map((l) => textContent(l).replace(/\d+$/, '').trim());
    expect(names).toEqual(['Inbox', 'Vendors', 'Retailers']);
    expect(byRole(root, 'link', 'Vendors').props['aria-current']).toBe('page');
    expect(textContent(root)).toContain('ops@amana-ng.com');
    expect(textContent(root)).toContain('ops');
  });
  it('shows People to an admin and the pending count once', () => {
    __setPath('/');
    const { root } = render(<MeProvider me={me({ roles: ['admin'], permissions: ['iam.read', 'iam.write'] })}><Rail pendingCount={3} /></MeProvider>);
    expect(allByRole(root, 'link').map((l) => textContent(l))).toEqual(['Inbox3', 'People']);
  });
  it('a person with no role sees only the inbox', () => {
    const { root } = render(<MeProvider me={me({ roles: [], permissions: [] })}><Rail pendingCount={0} /></MeProvider>);
    expect(allByRole(root, 'link').map((l) => textContent(l))).toEqual(['Inbox']);
  });
});
```

`components/Confirm.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { allByRole, byRole, click, render } from '../test/render';
import { Confirm } from './Confirm';

describe('Confirm', () => {
  it('asks once, then acts', () => {
    const onConfirm = vi.fn();
    const { root } = render(<Confirm label="Suspend CORNER SHOP" confirmLabel="suspend" onConfirm={onConfirm} tone="danger" />);
    click(byRole(root, 'button', 'Suspend CORNER SHOP'));
    expect(onConfirm).not.toHaveBeenCalled();
    click(byRole(root, 'button', 'Yes, suspend'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('can be backed out of', () => {
    const { root } = render(<Confirm label="Revoke" confirmLabel="revoke" onConfirm={() => {}} />);
    click(byRole(root, 'button', 'Revoke'));
    click(byRole(root, 'button', 'Cancel'));
    expect(allByRole(root, 'button').map((b) => b.props.children)).toEqual(['Revoke']);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement**

`lib/me.tsx`:

```tsx
'use client';
import { type ReactNode, createContext, useContext } from 'react';
import type { Me, Permission } from './types';

const MeContext = createContext<Me | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside MeProvider');
  return me;
}

/** The only question a screen asks. Roles are shown about people; permissions decide what renders. */
export function can(me: Me, permission: Permission): boolean {
  return me.permissions.includes(permission);
}
```

`components/StatusPill.tsx`:

```tsx
import type { ReactNode } from 'react';
export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`pill${tone === 'neutral' ? '' : ` ${tone}`}`}>{children}</span>;
}
```

`components/Confirm.tsx`:

```tsx
'use client';
import { useState } from 'react';

/**
 * Inline click-through for actions that are immediate and hard to undo (suspend, revoke). Not a
 * modal: the question stays next to the thing it is about, and the first click already said what
 * would happen.
 */
export function Confirm(props: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={props.tone === 'danger' ? 'danger' : 'secondary'} disabled={props.disabled} onClick={() => setAsking(true)}>
        {props.label}
      </button>
    );
  }
  return (
    <span className="row">
      <button type="button" className={props.tone === 'danger' ? 'danger' : undefined} onClick={() => { setAsking(false); props.onConfirm(); }}>
        {`Yes, ${props.confirmLabel}`}
      </button>
      <button type="button" className="secondary" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}
```

`components/Rail.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { can, useMe } from '../lib/me';
import type { Permission } from '../lib/types';

const NAV: ReadonlyArray<{ href: string; label: string; needs: Permission[] }> = [
  { href: '/', label: 'Inbox', needs: [] },
  { href: '/ops/vendors', label: 'Vendors', needs: ['vendor.read'] },
  { href: '/ops/retailers', label: 'Retailers', needs: ['retailer.read'] },
  { href: '/people', label: 'People', needs: ['iam.read'] },
];

export function Rail({ pendingCount }: { pendingCount: number }) {
  const me = useMe();
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const signOut = async () => {
    try { await api.signOut(); } finally { router.replace('/sign-in'); }
  };
  return (
    <nav className="rail" aria-label="Sections">
      <div className="brand">Amana staff</div>
      {NAV.filter((n) => n.needs.every((p) => can(me, p))).map((n) => (
        <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}>
          {n.label}
          {n.href === '/' && pendingCount > 0 ? <span className="count" aria-label={`${pendingCount} waiting`}>{pendingCount}</span> : null}
        </Link>
      ))}
      <div className="person">
        <strong>{me.email}</strong>
        {me.roles.length ? me.roles.join(', ') : 'no role yet'}
        <div style={{ marginTop: 10 }}>
          <button type="button" className="secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </nav>
  );
}
```

`app/sign-in/page.tsx`:

```tsx
'use client';
import { useSearchParams } from 'next/navigation';
import { signInHref } from '../../lib/api';

export default function SignInPage() {
  const failed = useSearchParams().get('error') === 'sign_in_failed';
  return (
    <main className="center">
      <h1>Amana staff</h1>
      <p className="sub">Sign in with your amana-ng.com Google account. Nothing else is accepted.</p>
      {failed ? (
        <div className="banner bad">
          Sign-in didn't complete. Try again with your amana-ng.com account. If it keeps failing, an
          admin has to check that your access has been set up.
        </div>
      ) : null}
      <a href={signInHref} className="button-link">
        <button type="button">Sign in with Google</button>
      </a>
    </main>
  );
}
```

(Render the link as the accessible control: keep `<a href>` as the element with the name — put the text directly in the anchor styled as a button via a `.button-link` class in globals.css: `.button-link { display:inline-block; background: var(--accent); color: var(--bg-base); font-weight:600; padding: 9px 14px; border-radius: 8px; text-decoration:none; }`. Remove the nested `<button>` so the test's `byRole('link','Sign in with Google')` matches.)

`app/(portal)/layout.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Rail } from '../../components/Rail';
import { ApiError, api } from '../../lib/api';
import { MeProvider } from '../../lib/me';
import type { Me } from '../../lib/types';

/**
 * The signed-in shell. The guard is a convenience — every route it wraps is enforced by the
 * backend on every request. Its job is to send someone without a session to sign-in instead of
 * showing a page of failed requests, and to keep the person and their inbox count on screen.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState(0);

  const refreshCount = useCallback(async () => {
    try { setPending((await api.approvals.list('pending')).approvals.length); } catch { /* count is decoration */ }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await api.me();
        if (!alive) return;
        setMe(m);
        void refreshCount();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace('/sign-in');
      }
    })();
    return () => { alive = false; };
  }, [router, refreshCount]);

  if (!me) return <main className="center muted">Loading…</main>;
  return (
    <MeProvider me={me}>
      <div className="shell">
        <Rail pendingCount={pending} />
        <main>{children}</main>
      </div>
    </MeProvider>
  );
}
```

- [ ] **Step 5: Run, typecheck, build, commit**

Run: `pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm --filter @amana/admin-portal build && pnpm exec biome check apps/admin-portal`

```bash
git add apps/admin-portal
git commit -m "feat(admin-portal): sign-in, session shell and the rail that always shows who you are"
```

---

### Task 6: The inbox — two seats per decision

**Files:**
- Create: `components/ApprovalCard.tsx`, `app/(portal)/page.tsx`
- Test: `components/ApprovalCard.test.tsx`, `app/(portal)/page.test.tsx`

**Interfaces:**
- Consumes: `api.approvals.*`, `api.iam.admins()` (only when `can(me,'iam.read')`, to name role-grant targets), `api.vendors.get(id)` (only when `can(me,'vendor.read')`, to name claimed vendors), `describeApproval`, `relativeTime`, `errorMessage`, `useMe`, `can`.
- Produces: `ApprovalCard({ approval, subjectName, me, onDecided })` — decides via `api` itself, shows the outcome (a vendor `publicCode` is rendered in `.code` with the instruction to read it to the merchant).

- [ ] **Step 1: Write the failing tests**

`components/ApprovalCard.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, Me } from '../lib/types';
import { byRole, click, flush, render, textContent } from '../test/render';

vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, approvals: { approve: vi.fn(), reject: vi.fn(), cancel: vi.fn(), list: vi.fn() } } };
});
import { api } from '../lib/api';
import { ApprovalCard } from './ApprovalCard';

const ops: Me = { id: 'me', email: 'ops2@amana-ng.com', displayName: null, roles: ['ops'], permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'] };
const claim: Approval = {
  id: 'ap1', kind: 'vendor_approve_claim', status: 'pending', makerAdminUserId: 'm', makerEmail: 'ops1@amana-ng.com',
  checkerAdminUserId: null, checkerEmail: null, reason: null, decisionReason: null, decidedAt: null,
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(), createdAt: new Date().toISOString(),
  payload: { vendorId: 'v', phone: '+2348031234567', category: 'food' },
};

describe('ApprovalCard', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the maker seated and the checker seat empty, in plain words', () => {
    const { root } = render(<ApprovalCard approval={claim} subjectName="CORNER SHOP" me={ops} onDecided={() => {}} />);
    const text = textContent(root);
    expect(text).toContain("Give CORNER SHOP's account to +234 803 ••• 4567");
    expect(text).toContain('ops1@amana-ng.com');
    expect(text).toContain('needs a second person');
    expect(text).toContain('in 6 days');
  });

  it('approving fills the second seat and shows the code to read to the merchant', async () => {
    vi.mocked(api.approvals.approve).mockResolvedValue({ kind: 'vendor_approve_claim', publicCode: 'AMNV-7QK2H-9PZ0R', displayName: 'CORNER SHOP' });
    const onDecided = vi.fn();
    const { root } = render(<ApprovalCard approval={claim} subjectName="CORNER SHOP" me={ops} onDecided={onDecided} />);
    click(byRole(root, 'button', 'Approve'));
    await flush();
    expect(api.approvals.approve).toHaveBeenCalledWith('ap1', undefined);
    expect(textContent(root)).toContain('AMNV-7QK2H-9PZ0R');
    expect(textContent(root)).toContain('Read this code to the merchant');
    expect(textContent(root)).toContain('ops2@amana-ng.com');
    expect(onDecided).toHaveBeenCalled();
  });

  it('the maker gets Withdraw, not Approve', () => {
    const maker: Me = { ...ops, id: 'm', email: 'ops1@amana-ng.com' };
    const { root } = render(<ApprovalCard approval={claim} subjectName="CORNER SHOP" me={maker} onDecided={() => {}} />);
    expect(() => byRole(root, 'button', 'Approve')).toThrow();
    byRole(root, 'button', 'Withdraw');
  });

  it('someone without the deciding permission sees the line but no buttons', () => {
    const auditor: Me = { ...ops, id: 'a', email: 'aud@amana-ng.com', roles: ['auditor'], permissions: ['audit.read', 'iam.read', 'vendor.read', 'retailer.read'] };
    const { root } = render(<ApprovalCard approval={claim} subjectName="CORNER SHOP" me={auditor} onDecided={() => {}} />);
    expect(() => byRole(root, 'button', 'Approve')).toThrow();
    expect(() => byRole(root, 'button', 'Decline')).toThrow();
  });

  it('a decided-already conflict is explained, not thrown', async () => {
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.approvals.approve).mockRejectedValue(new ApiError(409, 'conflict', 'approval_not_pending'));
    const { root } = render(<ApprovalCard approval={claim} subjectName="CORNER SHOP" me={ops} onDecided={() => {}} />);
    click(byRole(root, 'button', 'Approve'));
    await flush();
    expect(textContent(root)).toContain('Someone already decided this one.');
  });
});
```

`app/(portal)/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../lib/me';
import type { Approval, Me } from '../../lib/types';
import { flush, render, textContent } from '../../test/render';

vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return { ...real, api: { ...real.api, approvals: { list: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn() }, iam: { ...real.api.iam, admins: vi.fn() }, vendors: { ...real.api.vendors, get: vi.fn() } } };
});
import { api } from '../../lib/api';
import InboxPage from './page';

const admin: Me = { id: 'me', email: 'admin2@amana-ng.com', displayName: null, roles: ['admin'], permissions: ['iam.read', 'iam.write'] };
const grant: Approval = {
  id: 'g1', kind: 'role_grant', status: 'pending', makerAdminUserId: 'm', makerEmail: 'admin1@amana-ng.com',
  checkerAdminUserId: null, checkerEmail: null, reason: 'joining ops', decisionReason: null, decidedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: new Date().toISOString(),
  payload: { targetAdminUserId: 't', role: 'ops' },
};

describe('inbox', () => {
  afterEach(() => vi.clearAllMocks());

  it('names the target of a role grant from the admin directory', async () => {
    vi.mocked(api.approvals.list).mockImplementation(async (s) => ({ approvals: s === 'pending' ? [grant] : [] }));
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [{ id: 't', email: 'ada@amana-ng.com', displayName: null, status: 'active', provisioningSource: 'admin', lastSignedInAt: null, roles: [] }] });
    const { root } = render(<MeProvider me={admin}><InboxPage /></MeProvider>);
    await flush();
    expect(textContent(root)).toContain('Make ada@amana-ng.com an ops');
    expect(textContent(root)).toContain('joining ops');
  });

  it('tells a person with no role what that means', async () => {
    vi.mocked(api.approvals.list).mockResolvedValue({ approvals: [] });
    const nobody: Me = { ...admin, roles: [], permissions: [] };
    const { root } = render(<MeProvider me={nobody}><InboxPage /></MeProvider>);
    await flush();
    expect(textContent(root)).toContain('no role yet');
    expect(textContent(root)).toContain('two');
  });

  it('separates waiting, yours, and decided', async () => {
    const mine = { ...grant, id: 'g2', makerAdminUserId: 'me', makerEmail: admin.email };
    const done = { ...grant, id: 'g3', status: 'rejected' as const, checkerEmail: 'x@amana-ng.com', decidedAt: new Date().toISOString() };
    vi.mocked(api.approvals.list).mockImplementation(async (s) => ({ approvals: s === 'pending' ? [grant, mine] : [done] }));
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [] });
    const { root } = render(<MeProvider me={admin}><InboxPage /></MeProvider>);
    await flush();
    const text = textContent(root);
    expect(text).toContain('Waiting for a second person');
    expect(text).toContain('Proposed by you');
    expect(text).toContain('Decided recently');
    expect(text).toContain('rejected');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL — components missing.

- [ ] **Step 3: Implement the card**

`components/ApprovalCard.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { describeApproval, errorMessage, relativeTime } from '../lib/copy';
import { can } from '../lib/me';
import type { Approval, ApprovalOutcome, Me } from '../lib/types';
import { StatusPill } from './StatusPill';

const decidingPermission = (a: Approval) => (a.kind === 'role_grant' ? 'iam.write' : 'vendor.write');

/**
 * One decision, two seats. The maker's seat is filled; the checker's is empty until someone who
 * is allowed to decide sits in it. Nothing else on the page changes when they do.
 */
export function ApprovalCard(props: { approval: Approval; subjectName?: string; me: Me; onDecided: () => void }) {
  const { approval: a, me } = props;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ApprovalOutcome | 'rejected' | 'cancelled' | null>(null);

  const isMaker = a.makerAdminUserId === me.id;
  const mayDecide = !isMaker && a.status === 'pending' && can(me, decidingPermission(a));
  const checkerEmail = outcome ? me.email : a.checkerEmail;

  const run = async (fn: () => Promise<ApprovalOutcome | 'rejected' | 'cancelled'>) => {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await fn());
      props.onDecided();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card approval">
      <div>
        <div className="what">{describeApproval(a, props.subjectName)}</div>
        {a.kind === 'vendor_approve_claim' && (a.payload as { category: string | null }).category ? (
          <div className="muted">Category: {(a.payload as { category: string | null }).category}</div>
        ) : null}
        {a.reason ? <div className="muted">“{a.reason}”</div> : null}
        <div className="seats">
          <div className="seat filled">
            proposed by <span className="who">{a.makerEmail}</span>
            <span className="muted">{relativeTime(a.createdAt)}</span>
          </div>
          <div className={`seat${checkerEmail ? ' filled' : ''}`}>
            {checkerEmail ? (
              <>decided by <span className="who">{checkerEmail}</span></>
            ) : (
              <>needs a second person<span className="muted">expires {relativeTime(a.expiresAt)}</span></>
            )}
          </div>
        </div>
        {outcome && typeof outcome === 'object' && outcome.kind === 'vendor_approve_claim' ? (
          <div className="banner" style={{ marginTop: 12 }}>
            Read this code to the merchant — it is shown nowhere else:
            <div className="code">{outcome.publicCode}</div>
          </div>
        ) : null}
        {outcome === 'rejected' ? <p className="ok-msg">Declined.</p> : null}
        {outcome === 'cancelled' ? <p className="ok-msg">Withdrawn.</p> : null}
        {a.status !== 'pending' ? (
          <div style={{ marginTop: 8 }}>
            <StatusPill tone={a.status === 'approved' ? 'ok' : a.status === 'expired' ? 'warn' : 'bad'}>{a.status}</StatusPill>
            {a.decisionReason ? <span className="muted"> “{a.decisionReason}”</span> : null}
          </div>
        ) : null}
        {error ? <p className="err">{error}</p> : null}
      </div>
      {a.status === 'pending' && !outcome ? (
        <div>
          {mayDecide ? (
            <>
              <label htmlFor={`reason-${a.id}`}>Reason (optional)</label>
              <input id={`reason-${a.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" disabled={busy} onClick={() => run(() => api.approvals.approve(a.id, reason || undefined))}>Approve</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => { await api.approvals.reject(a.id, reason || undefined); return 'rejected'; })}>Decline</button>
              </div>
            </>
          ) : null}
          {isMaker ? (
            <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => { await api.approvals.cancel(a.id); return 'cancelled'; })}>Withdraw</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement the page**

`app/(portal)/page.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../../components/ApprovalCard';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/copy';
import { can, useMe } from '../../lib/me';
import type { Approval, RoleGrantPayload, VendorClaimPayload } from '../../lib/types';

export default function InboxPage() {
  const me = useMe();
  const [pending, setPending] = useState<Approval[]>([]);
  const [decided, setDecided] = useState<Approval[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([api.approvals.list('pending'), api.approvals.list('decided')]);
      setPending(p.approvals);
      setDecided(d.approvals.slice(0, 20));
      // Name the subjects. Each lookup is gated on the permission that reads that record, and a
      // failed lookup leaves the id-less fallback wording ("this person", "this vendor").
      const all = [...p.approvals, ...d.approvals];
      const next: Record<string, string> = {};
      if (can(me, 'iam.read') && all.some((a) => a.kind === 'role_grant')) {
        try {
          for (const adm of (await api.iam.admins()).admins) next[adm.id] = adm.email;
        } catch { /* fallback wording */ }
      }
      if (can(me, 'vendor.read')) {
        const ids = [...new Set(all.filter((a) => a.kind === 'vendor_approve_claim').map((a) => (a.payload as VendorClaimPayload).vendorId))];
        await Promise.all(ids.map(async (id) => { try { next[id] = (await api.vendors.get(id)).vendor.displayName; } catch { /* fallback */ } }));
      }
      setNames(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [me]);

  useEffect(() => { void load(); }, [load]);

  const subjectOf = (a: Approval) =>
    a.kind === 'role_grant' ? names[(a.payload as RoleGrantPayload).targetAdminUserId] : names[(a.payload as VendorClaimPayload).vendorId];

  const waiting = pending.filter((a) => a.makerAdminUserId !== me.id);
  const mine = pending.filter((a) => a.makerAdminUserId === me.id);

  if (me.permissions.length === 0) {
    return (
      <>
        <h1>Inbox</h1>
        <div className="banner">
          You're signed in, but you have no role yet, so nothing here will work until you do. An admin
          has to grant one and a second admin has to approve it — it takes two people on purpose.
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Waiting for a second person</h1>
      <p className="sub">Each line is something one colleague proposed and a second must decide. Approving hands out access or a bank account; read the line before you sit in the seat.</p>
      {error ? <p className="err">{error}</p> : null}
      {waiting.length === 0 ? <p className="muted">Nothing is waiting for you.</p> : null}
      {waiting.map((a) => <ApprovalCard key={a.id} approval={a} subjectName={subjectOf(a)} me={me} onDecided={load} />)}

      <h2 style={{ marginTop: 28 }}>Proposed by you</h2>
      {mine.length === 0 ? <p className="muted">You have no open proposals.</p> : null}
      {mine.map((a) => <ApprovalCard key={a.id} approval={a} subjectName={subjectOf(a)} me={me} onDecided={load} />)}

      <h2 style={{ marginTop: 28 }}>Decided recently</h2>
      {decided.length === 0 ? <p className="muted">No decisions yet.</p> : null}
      {decided.map((a) => <ApprovalCard key={a.id} approval={a} subjectName={subjectOf(a)} me={me} onDecided={load} />)}
    </>
  );
}
```

- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm exec biome check apps/admin-portal`

```bash
git add apps/admin-portal
git commit -m "feat(admin-portal): the inbox — every decision shown as two seats, one of them empty"
```

---

### Task 7: Vendors — the claim queue and the vendor page

**Files:**
- Create: `app/(portal)/ops/vendors/page.tsx`, `app/(portal)/ops/vendors/[id]/page.tsx`
- Test: `app/(portal)/ops/vendors/page.test.tsx`, `app/(portal)/ops/vendors/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `api.vendors.*`, `SPEND_CATEGORIES`, `maskPhone`, `relativeTime`, `errorMessage`, `Confirm`, `StatusPill`, `can`, `useMe`, `useParams`, `Link`.

- [ ] **Step 1: Write the failing tests**

`app/(portal)/ops/vendors/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../lib/me';
import type { ClaimAttempt, Me, VendorSummary } from '../../../../lib/types';
import { allByRole, byLabel, byRole, change, click, flush, render, submit, textContent } from '../../../../test/render';

vi.mock('../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../lib/api')>();
  return { ...real, api: { ...real.api, vendors: { ...real.api.vendors, queue: vi.fn(), search: vi.fn(), proposeClaim: vi.fn() } } };
});
import { api } from '../../../../lib/api';
import VendorsPage from './page';

const ops: Me = { id: 'me', email: 'ops@amana-ng.com', displayName: null, roles: ['ops'], permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'] };
const vendor: VendorSummary = { id: 'v1', displayName: 'CORNER SHOP', bankCode: '058', accountNumberMasked: '••••6789', status: 'observed', category: null, categorySource: 'observed', publicCode: null, promotedHouseholdCount: 6, promotedAt: new Date().toISOString(), claimedAt: null };
const attempt: ClaimAttempt = { id: 'c1', vendorId: 'v1', phone: '+2348031234567', status: 'pending', ownershipProof: null, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), verifiedAt: null, createdAt: new Date().toISOString(), vendor };

describe('vendors', () => {
  afterEach(() => vi.clearAllMocks());

  it('lists the claim queue with the business named and the account masked', async () => {
    vi.mocked(api.vendors.queue).mockResolvedValue({ attempts: [attempt] });
    vi.mocked(api.vendors.search).mockResolvedValue({ vendors: [] });
    const { root } = render(<MeProvider me={ops}><VendorsPage /></MeProvider>);
    await flush();
    const text = textContent(root);
    expect(text).toContain('CORNER SHOP');
    expect(text).toContain('••••6789');
    expect(text).toContain('+234 803 ••• 4567');
  });

  it('proposes approval for a queued claim and points at the inbox', async () => {
    vi.mocked(api.vendors.queue).mockResolvedValue({ attempts: [attempt] });
    vi.mocked(api.vendors.search).mockResolvedValue({ vendors: [] });
    vi.mocked(api.vendors.proposeClaim).mockResolvedValue({ approvalId: 'ap', status: 'pending' });
    const { root } = render(<MeProvider me={ops}><VendorsPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Category for CORNER SHOP'), 'food');
    click(byRole(root, 'button', 'Propose approval for CORNER SHOP'));
    await flush();
    expect(api.vendors.proposeClaim).toHaveBeenCalledWith('v1', '+2348031234567', 'food');
    expect(textContent(root)).toContain('Proposed. A second ops colleague has to approve it in the inbox.');
  });

  it('searches vendors by name', async () => {
    vi.mocked(api.vendors.queue).mockResolvedValue({ attempts: [] });
    vi.mocked(api.vendors.search).mockResolvedValue({ vendors: [vendor] });
    const { root } = render(<MeProvider me={ops}><VendorsPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Search by name or code'), 'corner');
    submit(root.find((n) => typeof n.type === 'string' && n.type === 'form' && n.props['aria-label'] === 'Find a vendor'));
    await flush();
    expect(api.vendors.search).toHaveBeenLastCalledWith(undefined, 'corner');
    expect(allByRole(root, 'link', 'CORNER SHOP').length).toBe(1);
  });
});
```

`app/(portal)/ops/vendors/[id]/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../../lib/me';
import type { Me, VendorSummary } from '../../../../../lib/types';
import { __setParams } from '../../../../../test/next.mock';
import { byLabel, byRole, change, click, flush, render, textContent } from '../../../../../test/render';

vi.mock('../../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../../lib/api')>();
  return { ...real, api: { ...real.api, vendors: { ...real.api.vendors, get: vi.fn(), consents: vi.fn(), setCategory: vi.fn(), suspend: vi.fn(), revokeConsent: vi.fn(), setEnforcement: vi.fn() } } };
});
import { api } from '../../../../../lib/api';
import VendorPage from './page';

const ops: Me = { id: 'me', email: 'ops@amana-ng.com', displayName: null, roles: ['ops'], permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'] };
const vendor: VendorSummary = { id: 'v1', displayName: 'CORNER SHOP', bankCode: '058', accountNumberMasked: '••••6789', status: 'claimed', category: 'food', categorySource: 'claimed', publicCode: 'AMNV-7QK2H-9PZ0R', promotedHouseholdCount: 6, promotedAt: new Date().toISOString(), claimedAt: new Date().toISOString() };

describe('vendor page', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows identity, status and consents, with nothing unmasked', async () => {
    __setParams({ id: 'v1' });
    vi.mocked(api.vendors.get).mockResolvedValue({ vendor, claimAttempts: [] });
    vi.mocked(api.vendors.consents).mockResolvedValue({ current: { service_terms: { id: 'c', purpose: 'service_terms', granted: true, termsVersion: '2026-08-27.v1', source: 'claim', recordedAt: new Date().toISOString() } }, history: [] });
    const { root } = render(<MeProvider me={ops}><VendorPage /></MeProvider>);
    await flush();
    const text = textContent(root);
    expect(text).toContain('CORNER SHOP');
    expect(text).toContain('AMNV-7QK2H-9PZ0R');
    expect(text).toContain('claimed');
    expect(text).toContain('Service terms');
    expect(text).toContain('granted');
  });

  it('suspending asks first and names the consequence', async () => {
    __setParams({ id: 'v1' });
    vi.mocked(api.vendors.get).mockResolvedValue({ vendor, claimAttempts: [] });
    vi.mocked(api.vendors.consents).mockResolvedValue({ current: {}, history: [] });
    vi.mocked(api.vendors.suspend).mockResolvedValue({ ok: true });
    const { root } = render(<MeProvider me={ops}><VendorPage /></MeProvider>);
    await flush();
    click(byRole(root, 'button', 'Suspend CORNER SHOP'));
    expect(textContent(root)).toContain('stops new spends to this account at once');
    click(byRole(root, 'button', 'Yes, suspend'));
    await flush();
    expect(api.vendors.suspend).toHaveBeenCalledWith('v1');
  });

  it('sets a category, which outranks the merchant’s own', async () => {
    __setParams({ id: 'v1' });
    vi.mocked(api.vendors.get).mockResolvedValue({ vendor, claimAttempts: [] });
    vi.mocked(api.vendors.consents).mockResolvedValue({ current: {}, history: [] });
    vi.mocked(api.vendors.setCategory).mockResolvedValue({ ok: true });
    const { root } = render(<MeProvider me={ops}><VendorPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Category'), 'transport');
    click(byRole(root, 'button', 'Save category'));
    await flush();
    expect(api.vendors.setCategory).toHaveBeenCalledWith('v1', 'transport');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL — pages missing.

- [ ] **Step 3: Implement the queue + search page**

`app/(portal)/ops/vendors/page.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../../components/StatusPill';
import { api } from '../../../../lib/api';
import { errorMessage, maskPhone, relativeTime } from '../../../../lib/copy';
import { can, useMe } from '../../../../lib/me';
import { type ClaimAttempt, SPEND_CATEGORIES, type VendorStatus, type VendorSummary } from '../../../../lib/types';

const tone = (s: VendorStatus) => (s === 'claimed' ? 'ok' : s === 'suspended' ? 'bad' : 'neutral');

export default function VendorsPage() {
  const me = useMe();
  const [queue, setQueue] = useState<ClaimAttempt[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<VendorStatus | ''>('');
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try { setQueue((await api.vendors.queue()).attempts); } catch (e) { setError(errorMessage(e)); }
  }, []);
  const search = useCallback(async (s: VendorStatus | '', term: string) => {
    try { setVendors((await api.vendors.search(s || undefined, term || undefined)).vendors); } catch (e) { setError(errorMessage(e)); }
  }, []);

  useEffect(() => { void loadQueue(); void search('', ''); }, [loadQueue, search]);

  const propose = async (a: ClaimAttempt) => {
    setNotes((n) => ({ ...n, [a.id]: '' }));
    try {
      await api.vendors.proposeClaim(a.vendorId, a.phone, categories[a.id] || null);
      setNotes((n) => ({ ...n, [a.id]: 'Proposed. A second ops colleague has to approve it in the inbox.' }));
    } catch (e) {
      setNotes((n) => ({ ...n, [a.id]: errorMessage(e) }));
    }
  };

  const onSearch = (e: FormEvent) => { e.preventDefault(); void search(status, q); };

  return (
    <>
      <h1>Vendors</h1>
      <p className="sub">Claims waiting for a phone check, and every business the registry knows about.</p>
      {error ? <p className="err">{error}</p> : null}

      <h2>Claims to check</h2>
      {queue.length === 0 ? <p className="muted">No open claims. A claim appears here when a merchant starts one from a sticker or a call.</p> : null}
      {queue.map((a) => {
        const name = a.vendor?.displayName ?? 'Unknown vendor';
        return (
          <div className="card" key={a.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{name}</strong> <span className="muted mono">{a.vendor?.bankCode} {a.vendor?.accountNumberMasked}</span>
                <div className="muted">claimed by <span className="mono">{maskPhone(a.phone)}</span> · started {relativeTime(a.createdAt)} · expires {relativeTime(a.expiresAt)}</div>
              </div>
              {a.vendor ? <StatusPill tone={tone(a.vendor.status)}>{a.vendor.status}</StatusPill> : null}
            </div>
            {can(me, 'vendor.write') ? (
              <>
                <label htmlFor={`cat-${a.id}`}>Category for {name}</label>
                <select id={`cat-${a.id}`} value={categories[a.id] ?? ''} onChange={(e) => setCategories((c) => ({ ...c, [a.id]: e.target.value }))}>
                  <option value="">No category</option>
                  {SPEND_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <div className="row" style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => propose(a)}>Propose approval for {name}</button>
                  <span className="muted">Hands this account to the caller once a second colleague agrees.</span>
                </div>
                {notes[a.id] ? <p className={notes[a.id]?.startsWith('Proposed') ? 'ok-msg' : 'err'}>{notes[a.id]}</p> : null}
              </>
            ) : null}
          </div>
        );
      })}

      <h2 style={{ marginTop: 28 }}>Find a vendor</h2>
      <form onSubmit={onSearch} aria-label="Find a vendor" className="card">
        <label htmlFor="q">Search by name or code</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="CORNER SHOP or AMNV-…" />
        <label htmlFor="status">Status</label>
        <select id="status" value={status} onChange={(e) => setStatus(e.target.value as VendorStatus | '')}>
          <option value="">Any</option>
          <option value="observed">observed</option>
          <option value="claimed">claimed</option>
          <option value="suspended">suspended</option>
        </select>
        <div style={{ marginTop: 12 }}><button type="submit">Search</button></div>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Business</th><th>Account</th><th>Status</th><th>Category</th><th>Code</th><th>Households</th></tr></thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id}>
                <td><Link href={`/ops/vendors/${v.id}`}>{v.displayName}</Link></td>
                <td className="mono">{v.bankCode} {v.accountNumberMasked}</td>
                <td><StatusPill tone={tone(v.status)}>{v.status}</StatusPill></td>
                <td>{v.category ?? '—'}{v.category ? <span className="muted"> ({v.categorySource})</span> : null}</td>
                <td className="mono">{v.publicCode ?? '—'}</td>
                <td className="num">{v.promotedHouseholdCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Implement the vendor page**

`app/(portal)/ops/vendors/[id]/page.tsx`:

```tsx
'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirm } from '../../../../../components/Confirm';
import { StatusPill } from '../../../../../components/StatusPill';
import { api } from '../../../../../lib/api';
import { errorMessage, maskPhone, relativeTime } from '../../../../../lib/copy';
import { can, useMe } from '../../../../../lib/me';
import { type ClaimAttempt, type ConsentPurpose, type ConsentRow, SPEND_CATEGORIES, type VendorSummary } from '../../../../../lib/types';

const PURPOSES: ReadonlyArray<{ value: ConsentPurpose; label: string }> = [
  { value: 'service_terms', label: 'Service terms' },
  { value: 'lender_introduction', label: 'Lender introduction' },
];

export default function VendorPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [vendor, setVendor] = useState<VendorSummary | null>(null);
  const [attempts, setAttempts] = useState<ClaimAttempt[]>([]);
  const [consents, setConsents] = useState<{ current: Partial<Record<ConsentPurpose, ConsentRow>>; history: ConsentRow[] }>({ current: {}, history: [] });
  const [category, setCategory] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [enforced, setEnforced] = useState<'true' | 'false' | 'null'>('null');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      const v = await api.vendors.get(id);
      setVendor(v.vendor);
      setAttempts(v.claimAttempts);
      setCategory(v.vendor.category ?? '');
      setConsents(await api.vendors.consents(id));
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg({});
    try { await fn(); setMsg({ ok }); await load(); } catch (e) { setMsg({ err: errorMessage(e) }); }
  };

  if (!vendor) return <p className="muted">{msg.err ?? 'Loading…'}</p>;
  const write = can(me, 'vendor.write');

  return (
    <>
      <h1>{vendor.displayName}</h1>
      <p className="sub">
        <span className="mono">{vendor.bankCode} {vendor.accountNumberMasked}</span> · <StatusPill tone={vendor.status === 'claimed' ? 'ok' : vendor.status === 'suspended' ? 'bad' : 'neutral'}>{vendor.status}</StatusPill>
        {vendor.publicCode ? <> · code <span className="mono">{vendor.publicCode}</span></> : null}
        {' '}· seen by {vendor.promotedHouseholdCount} households
      </p>
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}

      <div className="card">
        <h2>Category</h2>
        <p className="muted">Currently {vendor.category ?? 'none'} ({vendor.categorySource}). A category set here outranks what the merchant chose.</p>
        {write ? (
          <>
            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">No category</option>
              {SPEND_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <div style={{ marginTop: 10 }}><button type="button" onClick={() => run(() => api.vendors.setCategory(id, category || null), 'Category saved.')}>Save category</button></div>
          </>
        ) : null}
      </div>

      <div className="card">
        <h2>Consents</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Purpose</th><th>State</th><th>Version</th><th>Recorded</th><th /></tr></thead>
          <tbody>
            {PURPOSES.map((p) => {
              const c = consents.current[p.value];
              return (
                <tr key={p.value}>
                  <td>{p.label}</td>
                  <td>{c ? <StatusPill tone={c.granted ? 'ok' : 'bad'}>{c.granted ? 'granted' : 'revoked'}</StatusPill> : <span className="muted">never given</span>}</td>
                  <td className="mono">{c?.termsVersion ?? '—'}</td>
                  <td className="muted">{c ? relativeTime(c.recordedAt) : '—'}</td>
                  <td>{write && c?.granted ? <Confirm label={`Revoke ${p.label.toLowerCase()}`} confirmLabel="revoke" tone="danger" onConfirm={() => run(() => api.vendors.revokeConsent(id, p.value), `${p.label} consent revoked.`)} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="muted">Revoking is immediate and takes one person: withdrawing consent must be as easy as giving it.</p>
      </div>

      <div className="card">
        <h2>Claim attempts</h2>
        {attempts.length === 0 ? <p className="muted">Nobody has tried to claim this account.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Phone</th><th>Status</th><th>Proof</th><th>Started</th></tr></thead>
            <tbody>{attempts.map((a) => (
              <tr key={a.id}><td className="mono">{maskPhone(a.phone)}</td><td><StatusPill tone={a.status === 'verified' ? 'ok' : a.status === 'pending' ? 'warn' : 'neutral'}>{a.status}</StatusPill></td><td>{a.ownershipProof ?? '—'}</td><td className="muted">{relativeTime(a.createdAt)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {write ? (
        <div className="card">
          <h2>Household enforcement</h2>
          <p className="muted">Whether registry categories apply to one household's rules. Inherit follows the global default.</p>
          <label htmlFor="household">Household id</label>
          <input id="household" value={householdId} onChange={(e) => setHouseholdId(e.target.value)} className="mono" />
          <label htmlFor="enforced">Enforcement</label>
          <select id="enforced" value={enforced} onChange={(e) => setEnforced(e.target.value as 'true' | 'false' | 'null')}>
            <option value="null">Inherit</option><option value="true">Enforce</option><option value="false">Never</option>
          </select>
          <div style={{ marginTop: 10 }}><button type="button" disabled={!householdId} onClick={() => run(() => api.vendors.setEnforcement(householdId, enforced === 'null' ? null : enforced === 'true'), 'Enforcement saved.')}>Save enforcement</button></div>
        </div>
      ) : null}

      {write && vendor.status !== 'suspended' ? (
        <div className="card">
          <h2>Suspend</h2>
          <p className="muted">Suspending {vendor.displayName} stops new spends to this account at once. It takes one person and there is no un-suspend button.</p>
          <Confirm label={`Suspend ${vendor.displayName}`} confirmLabel="suspend" tone="danger" onConfirm={() => run(() => api.vendors.suspend(id), `${vendor.displayName} suspended.`)} />
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm exec biome check apps/admin-portal`

```bash
git add apps/admin-portal
git commit -m "feat(admin-portal): vendor claim queue, search, and the vendor page with its one-person actions"
```

---

### Task 8: Retailers — list, create, KYB, approve, suspend

**Files:**
- Create: `app/(portal)/ops/retailers/page.tsx`, `app/(portal)/ops/retailers/[id]/page.tsx`
- Test: `app/(portal)/ops/retailers/page.test.tsx`, `app/(portal)/ops/retailers/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `api.retailers.*`, `Confirm`, `StatusPill`, `errorMessage`, `relativeTime`, `can`, `useMe`, `useParams`, `Link`.

- [ ] **Step 1: Write the failing tests**

`app/(portal)/ops/retailers/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../lib/me';
import type { Me, Retailer } from '../../../../lib/types';
import { allByRole, byLabel, byRole, change, click, flush, render, submit, textContent } from '../../../../test/render';

vi.mock('../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../lib/api')>();
  return { ...real, api: { ...real.api, retailers: { ...real.api.retailers, list: vi.fn(), create: vi.fn() } } };
});
import { api } from '../../../../lib/api';
import RetailersPage from './page';

const ops: Me = { id: 'me', email: 'ops@amana-ng.com', displayName: null, roles: ['ops'], permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'] };
const r: Retailer = { id: 'r1', businessName: 'Bola Tyres', anchorBusinessCustomerId: null, payoutBankCode: '058', payoutAccountNumber: '0123456789', onboardingStatus: 'applied', ownerUserId: null, contactPhone: null, approvedAt: null, createdAt: new Date().toISOString() };

describe('retailers', () => {
  afterEach(() => vi.clearAllMocks());

  it('lists by status, defaulting to applied', async () => {
    vi.mocked(api.retailers.list).mockResolvedValue([r]);
    const { root } = render(<MeProvider me={ops}><RetailersPage /></MeProvider>);
    await flush();
    expect(api.retailers.list).toHaveBeenCalledWith('applied');
    expect(allByRole(root, 'link', 'Bola Tyres').length).toBe(1);
  });

  it('switches status tabs', async () => {
    vi.mocked(api.retailers.list).mockResolvedValue([]);
    const { root } = render(<MeProvider me={ops}><RetailersPage /></MeProvider>);
    await flush();
    click(byRole(root, 'button', 'approved'));
    await flush();
    expect(api.retailers.list).toHaveBeenLastCalledWith('approved');
  });

  it('creates a retailer from the form', async () => {
    vi.mocked(api.retailers.list).mockResolvedValue([]);
    vi.mocked(api.retailers.create).mockResolvedValue({ ...r, id: 'r2' });
    const { root } = render(<MeProvider me={ops}><RetailersPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Business name'), 'Mama Put');
    change(byLabel(root, 'Payout bank code'), '058');
    change(byLabel(root, 'Payout account number'), '0123456789');
    submit(root.find((n) => typeof n.type === 'string' && n.type === 'form' && n.props['aria-label'] === 'Add a retailer'));
    await flush();
    expect(api.retailers.create).toHaveBeenCalledWith({ businessName: 'Mama Put', payoutBankCode: '058', payoutAccountNumber: '0123456789' });
    expect(textContent(root)).toContain('Added. Next: submit their KYB from their page.');
  });
});
```

`app/(portal)/ops/retailers/[id]/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../../lib/me';
import type { Me, Retailer } from '../../../../../lib/types';
import { __setParams } from '../../../../../test/next.mock';
import { byLabel, byRole, change, click, flush, render, submit, textContent } from '../../../../../test/render';

vi.mock('../../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../../lib/api')>();
  return { ...real, api: { ...real.api, retailers: { ...real.api.retailers, get: vi.fn(), kyb: vi.fn(), approve: vi.fn(), suspend: vi.fn() } } };
});
import { ApiError, api } from '../../../../../lib/api';
import RetailerPage from './page';

const ops: Me = { id: 'me', email: 'ops@amana-ng.com', displayName: null, roles: ['ops'], permissions: ['vendor.read', 'vendor.write', 'retailer.read', 'retailer.write'] };
const r: Retailer = { id: 'r1', businessName: 'Bola Tyres', anchorBusinessCustomerId: null, payoutBankCode: '058', payoutAccountNumber: '0123456789', onboardingStatus: 'applied', ownerUserId: null, contactPhone: null, approvedAt: null, createdAt: new Date().toISOString() };

describe('retailer page', () => {
  afterEach(() => vi.clearAllMocks());

  it('submits KYB and never echoes the BVN back', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue(r);
    vi.mocked(api.retailers.kyb).mockResolvedValue({ ...r, onboardingStatus: 'kyb_pending', anchorBusinessCustomerId: 'bc_1' });
    const { root } = render(<MeProvider me={ops}><RetailerPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Owner BVN'), '12345678901');
    submit(root.find((n) => typeof n.type === 'string' && n.type === 'form' && n.props['aria-label'] === 'Submit KYB'));
    await flush();
    expect(api.retailers.kyb).toHaveBeenCalledWith('r1', { bvn: '12345678901' });
    expect(textContent(root)).toContain('KYB submitted');
    expect(textContent(root)).not.toContain('12345678901');
  });

  it('explains an Anchor outage as retryable', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue(r);
    vi.mocked(api.retailers.kyb).mockRejectedValue(new ApiError(503, 'anchor_unavailable', null));
    const { root } = render(<MeProvider me={ops}><RetailerPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Owner BVN'), '12345678901');
    submit(root.find((n) => typeof n.type === 'string' && n.type === 'form' && n.props['aria-label'] === 'Submit KYB'));
    await flush();
    expect(textContent(root)).toContain('Nothing changed; try again later.');
  });

  it('a suspended retailer gets the asymmetric banner and no approve button', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue({ ...r, onboardingStatus: 'suspended', approvedAt: new Date().toISOString() });
    const { root } = render(<MeProvider me={ops}><RetailerPage /></MeProvider>);
    await flush();
    expect(textContent(root)).toContain('can still redeem vouchers already sold');
    expect(() => byRole(root, 'button', 'Approve without KYB')).toThrow();
  });

  it('approving asks first', async () => {
    __setParams({ id: 'r1' });
    vi.mocked(api.retailers.get).mockResolvedValue(r);
    vi.mocked(api.retailers.approve).mockResolvedValue({ ...r, onboardingStatus: 'approved' });
    const { root } = render(<MeProvider me={ops}><RetailerPage /></MeProvider>);
    await flush();
    click(byRole(root, 'button', 'Approve without KYB'));
    click(byRole(root, 'button', 'Yes, approve'));
    await flush();
    expect(api.retailers.approve).toHaveBeenCalledWith('r1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL.

- [ ] **Step 3: Implement the list page**

`app/(portal)/ops/retailers/page.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../../components/StatusPill';
import { api } from '../../../../lib/api';
import { errorMessage, relativeTime } from '../../../../lib/copy';
import { can, useMe } from '../../../../lib/me';
import type { Retailer, RetailerStatus } from '../../../../lib/types';

const STATUSES: RetailerStatus[] = ['applied', 'kyb_pending', 'approved', 'suspended'];
export const retailerTone = (s: RetailerStatus) => (s === 'approved' ? 'ok' : s === 'suspended' ? 'bad' : s === 'kyb_pending' ? 'warn' : 'neutral');

export default function RetailersPage() {
  const me = useMe();
  const [status, setStatus] = useState<RetailerStatus>('applied');
  const [rows, setRows] = useState<Retailer[]>([]);
  const [form, setForm] = useState({ businessName: '', payoutBankCode: '', payoutAccountNumber: '' });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async (s: RetailerStatus) => {
    try { setRows(await api.retailers.list(s)); } catch (e) { setMsg({ err: errorMessage(e) }); }
  }, []);
  useEffect(() => { void load(status); }, [load, status]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMsg({});
    try {
      await api.retailers.create(form);
      setForm({ businessName: '', payoutBankCode: '', payoutAccountNumber: '' });
      setMsg({ ok: 'Added. Next: submit their KYB from their page.' });
      setStatus('applied');
      await load('applied');
    } catch (err) { setMsg({ err: errorMessage(err) }); }
  };

  return (
    <>
      <h1>Retailers</h1>
      <p className="sub">Businesses selling on the marketplace. Only approved retailers can list items or take orders.</p>
      <div className="row" role="tablist" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={s === status} className={s === status ? undefined : 'secondary'} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Business</th><th>Payout account</th><th>Status</th><th>Added</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={4} className="muted">No retailers with status {status}.</td></tr> : null}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/ops/retailers/${r.id}`}>{r.businessName}</Link></td>
                <td className="mono">{r.payoutBankCode} ••••{r.payoutAccountNumber.slice(-4)}</td>
                <td><StatusPill tone={retailerTone(r.onboardingStatus)}>{r.onboardingStatus}</StatusPill></td>
                <td className="muted">{relativeTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can(me, 'retailer.write') ? (
        <form onSubmit={create} aria-label="Add a retailer" className="card" style={{ marginTop: 24 }}>
          <h2>Add a retailer</h2>
          <label htmlFor="businessName">Business name</label>
          <input id="businessName" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} required maxLength={200} />
          <label htmlFor="payoutBankCode">Payout bank code</label>
          <input id="payoutBankCode" value={form.payoutBankCode} onChange={(e) => setForm({ ...form, payoutBankCode: e.target.value })} required pattern="\d{3,6}" inputMode="numeric" />
          <label htmlFor="payoutAccountNumber">Payout account number</label>
          <input id="payoutAccountNumber" value={form.payoutAccountNumber} onChange={(e) => setForm({ ...form, payoutAccountNumber: e.target.value })} required pattern="\d{10}" inputMode="numeric" />
          <div style={{ marginTop: 12 }}><button type="submit">Add retailer</button></div>
        </form>
      ) : null}
    </>
  );
}
```

(Move `retailerTone` into `components/StatusPill.tsx` as a named export rather than exporting it from a page — Next warns on non-page exports from `page.tsx`. Import it in both retailer pages from there.)

- [ ] **Step 4: Implement the retailer page**

`app/(portal)/ops/retailers/[id]/page.tsx`:

```tsx
'use client';
import { useParams } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Confirm } from '../../../../../components/Confirm';
import { StatusPill, retailerTone } from '../../../../../components/StatusPill';
import { api } from '../../../../../lib/api';
import { errorMessage, relativeTime } from '../../../../../lib/copy';
import { can, useMe } from '../../../../../lib/me';
import type { Retailer } from '../../../../../lib/types';

export default function RetailerPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Retailer | null>(null);
  const [kyb, setKyb] = useState({ bvn: '', rcNumber: '', email: '' });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try { setR(await api.retailers.get(id)); } catch (e) { setMsg({ err: errorMessage(e) }); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg({});
    try { await fn(); setMsg({ ok }); await load(); } catch (e) { setMsg({ err: errorMessage(e) }); }
  };
  const submitKyb = (e: FormEvent) => {
    e.preventDefault();
    const input: { bvn: string; rcNumber?: string; email?: string } = { bvn: kyb.bvn };
    if (kyb.rcNumber) input.rcNumber = kyb.rcNumber;
    if (kyb.email) input.email = kyb.email;
    void run(async () => { await api.retailers.kyb(id, input); setKyb({ bvn: '', rcNumber: '', email: '' }); }, 'KYB submitted to the bank partner. The status moves to approved when they confirm.');
  };

  if (!r) return <p className="muted">{msg.err ?? 'Loading…'}</p>;
  const write = can(me, 'retailer.write');
  const s = r.onboardingStatus;

  return (
    <>
      <h1>{r.businessName}</h1>
      <p className="sub">
        <StatusPill tone={retailerTone(s)}>{s}</StatusPill> · payout <span className="mono">{r.payoutBankCode} ••••{r.payoutAccountNumber.slice(-4)}</span>
        {r.anchorBusinessCustomerId ? <> · bank customer <span className="mono">{r.anchorBusinessCustomerId}</span></> : null}
        {r.approvedAt ? <> · approved {relativeTime(r.approvedAt)}</> : null}
      </p>
      {s === 'suspended' ? (
        <div className="banner bad">
          <strong>Suspended.</strong> This business cannot list items or run deals. It can still redeem vouchers already sold — customers paid for those — and those payouts still reach it. There is no un-suspend: a suspended retailer re-applies and goes through KYB again.
        </div>
      ) : null}
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}

      {write && (s === 'applied' || s === 'kyb_pending') ? (
        <form onSubmit={submitKyb} aria-label="Submit KYB" className="card">
          <h2>Submit KYB</h2>
          <p className="muted">Sent to the bank partner. The BVN is not stored by Amana and is not shown again.</p>
          <label htmlFor="bvn">Owner BVN</label>
          <input id="bvn" value={kyb.bvn} onChange={(e) => setKyb({ ...kyb, bvn: e.target.value })} required pattern="\d{11}" inputMode="numeric" autoComplete="off" />
          <label htmlFor="rcNumber">RC number (optional)</label>
          <input id="rcNumber" value={kyb.rcNumber} onChange={(e) => setKyb({ ...kyb, rcNumber: e.target.value })} maxLength={50} />
          <label htmlFor="email">Business email (optional)</label>
          <input id="email" type="email" value={kyb.email} onChange={(e) => setKyb({ ...kyb, email: e.target.value })} />
          <div style={{ marginTop: 12 }}><button type="submit">Submit KYB</button></div>
        </form>
      ) : null}

      {write && (s === 'applied' || s === 'kyb_pending') ? (
        <div className="card">
          <h2>Approve without KYB</h2>
          <p className="muted">An ops override. The business goes live now and can take orders; use it only when KYB has been checked another way.</p>
          <Confirm label="Approve without KYB" confirmLabel="approve" onConfirm={() => run(() => api.retailers.approve(id), `${r.businessName} approved.`)} />
        </div>
      ) : null}

      {write && s !== 'suspended' ? (
        <div className="card">
          <h2>Suspend</h2>
          <p className="muted">Stops new listings, deals and purchases at once. Vouchers already sold stay redeemable. One person, immediate, no undo.</p>
          <Confirm label={`Suspend ${r.businessName}`} confirmLabel="suspend" tone="danger" onConfirm={() => run(() => api.retailers.suspend(id), `${r.businessName} suspended.`)} />
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Run, typecheck, lint, commit**

```bash
pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm exec biome check apps/admin-portal
git add apps/admin-portal
git commit -m "feat(admin-portal): retailers — list, add, KYB, approve and the suspend that keeps vouchers honoured"
```

---

### Task 9: People — onboarding, grants that take two, revocations that take one

**Files:**
- Create: `app/(portal)/people/page.tsx`, `app/(portal)/people/[id]/page.tsx`
- Test: `app/(portal)/people/page.test.tsx`, `app/(portal)/people/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `api.iam.*`, `ROLES`, `Confirm`, `StatusPill`, `errorMessage`, `relativeTime`, `can`, `useMe`.

- [ ] **Step 1: Write the failing tests**

`app/(portal)/people/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../lib/me';
import type { AdminSummary, Me } from '../../../lib/types';
import { allByRole, byLabel, change, flush, render, submit, textContent } from '../../../test/render';

vi.mock('../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../lib/api')>();
  return { ...real, api: { ...real.api, iam: { ...real.api.iam, admins: vi.fn(), onboard: vi.fn() } } };
});
import { api } from '../../../lib/api';
import PeoplePage from './page';

const admin: Me = { id: 'me', email: 'admin@amana-ng.com', displayName: null, roles: ['admin'], permissions: ['iam.read', 'iam.write'] };
const david: AdminSummary = { id: 'd', email: 'david@amana-ng.com', displayName: 'david williams', status: 'active', provisioningSource: 'config', lastSignedInAt: new Date().toISOString(), roles: ['owner', 'admin'] };

describe('people', () => {
  afterEach(() => vi.clearAllMocks());

  it('lists everyone with roles and marks the break-glass account', async () => {
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [david] });
    const { root } = render(<MeProvider me={admin}><PeoplePage /></MeProvider>);
    await flush();
    const text = textContent(root);
    expect(allByRole(root, 'link', 'david@amana-ng.com').length).toBe(1);
    expect(text).toContain('owner, admin');
    expect(text).toContain('seeded from config');
  });

  it('onboards by email and says the new person has no role yet', async () => {
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [] });
    vi.mocked(api.iam.onboard).mockResolvedValue({ id: 'n', email: 'ada@amana-ng.com', roles: [] });
    const { root } = render(<MeProvider me={admin}><PeoplePage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Work email'), 'ada@amana-ng.com');
    submit(root.find((n) => typeof n.type === 'string' && n.type === 'form'));
    await flush();
    expect(api.iam.onboard).toHaveBeenCalledWith('ada@amana-ng.com');
    expect(textContent(root)).toContain('no role yet');
  });

  it('an auditor sees the list but no onboarding form', async () => {
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [david] });
    const auditor: Me = { ...admin, roles: ['auditor'], permissions: ['audit.read', 'iam.read', 'vendor.read', 'retailer.read'] };
    const { root } = render(<MeProvider me={auditor}><PeoplePage /></MeProvider>);
    await flush();
    expect(root.findAll((n) => typeof n.type === 'string' && n.type === 'form')).toHaveLength(0);
  });
});
```

`app/(portal)/people/[id]/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeProvider } from '../../../../lib/me';
import type { AdminSummary, Me } from '../../../../lib/types';
import { __setParams } from '../../../../test/next.mock';
import { byLabel, byRole, change, click, flush, render, textContent } from '../../../../test/render';

vi.mock('../../../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../../../lib/api')>();
  return { ...real, api: { ...real.api, iam: { ...real.api.iam, admins: vi.fn(), grants: vi.fn(), grant: vi.fn(), revoke: vi.fn() } } };
});
import { api } from '../../../../lib/api';
import PersonPage from './page';

const admin: Me = { id: 'me', email: 'admin@amana-ng.com', displayName: null, roles: ['admin'], permissions: ['iam.read', 'iam.write'] };
const ada: AdminSummary = { id: 'a', email: 'ada@amana-ng.com', displayName: null, status: 'active', provisioningSource: 'admin', lastSignedInAt: null, roles: ['ops'] };

describe('person page', () => {
  afterEach(() => vi.clearAllMocks());

  it('proposing a grant says it needs a second admin', async () => {
    __setParams({ id: 'a' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [ada] });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [] });
    vi.mocked(api.iam.grant).mockResolvedValue({ approvalId: 'ap', status: 'pending' });
    const { root } = render(<MeProvider me={admin}><PersonPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Role to add'), 'support');
    change(byLabel(root, 'Why'), 'joining support');
    click(byRole(root, 'button', 'Propose'));
    await flush();
    expect(api.iam.grant).toHaveBeenCalledWith('a', 'support', 'joining support');
    expect(textContent(root)).toContain('Proposed. A second admin has to approve it in the inbox.');
  });

  it('the bootstrap account is told its grant applied at once', async () => {
    __setParams({ id: 'a' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [ada] });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [] });
    vi.mocked(api.iam.grant).mockResolvedValue({ approvalId: 'ap', status: 'approved' });
    const { root } = render(<MeProvider me={admin}><PersonPage /></MeProvider>);
    await flush();
    change(byLabel(root, 'Role to add'), 'support');
    click(byRole(root, 'button', 'Propose'));
    await flush();
    expect(textContent(root)).toContain('Applied at once');
  });

  it('revoking is immediate and asks first', async () => {
    __setParams({ id: 'a' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [ada] });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [{ role: 'ops', granted: true, grantedByAdminUserId: 'x', source: 'admin', reason: 'hired', recordedAt: new Date().toISOString() }] });
    vi.mocked(api.iam.revoke).mockResolvedValue(undefined);
    const { root } = render(<MeProvider me={admin}><PersonPage /></MeProvider>);
    await flush();
    click(byRole(root, 'button', 'Revoke ops'));
    click(byRole(root, 'button', 'Yes, revoke'));
    await flush();
    expect(api.iam.revoke).toHaveBeenCalledWith('a', 'ops', undefined);
  });

  it('you cannot change your own roles, and the page says so', async () => {
    __setParams({ id: 'me' });
    vi.mocked(api.iam.admins).mockResolvedValue({ admins: [{ ...ada, id: 'me', email: admin.email, roles: ['admin'] }] });
    vi.mocked(api.iam.grants).mockResolvedValue({ grants: [] });
    const { root } = render(<MeProvider me={admin}><PersonPage /></MeProvider>);
    await flush();
    expect(textContent(root)).toContain("You can't change your own roles");
    expect(() => byRole(root, 'button', 'Propose')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @amana/admin-portal test`
Expected: FAIL.

- [ ] **Step 3: Implement the list page**

`app/(portal)/people/page.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../components/StatusPill';
import { api } from '../../../lib/api';
import { errorMessage, relativeTime } from '../../../lib/copy';
import { can, useMe } from '../../../lib/me';
import type { AdminSummary } from '../../../lib/types';

export default function PeoplePage() {
  const me = useMe();
  const [admins, setAdmins] = useState<AdminSummary[]>([]);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try { setAdmins((await api.iam.admins()).admins); } catch (e) { setMsg({ err: errorMessage(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onboard = async (e: FormEvent) => {
    e.preventDefault();
    setMsg({});
    try {
      const created = await api.iam.onboard(email.trim());
      setEmail('');
      setMsg({ ok: `${created.email} can sign in now, but has no role yet. Open their page to propose one.` });
      await load();
    } catch (err) { setMsg({ err: errorMessage(err) }); }
  };

  return (
    <>
      <h1>People</h1>
      <p className="sub">Staff who can sign in. What each person can do comes from their roles, and a role takes two admins to give and one to take away.</p>
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Roles</th><th>Status</th><th>Last sign-in</th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/people/${a.id}`}>{a.email}</Link>{a.provisioningSource === 'config' ? <span className="muted"> · seeded from config</span> : null}</td>
                <td>{a.roles.length ? a.roles.join(', ') : <span className="muted">no role yet</span>}</td>
                <td><StatusPill tone={a.status === 'active' ? 'ok' : 'bad'}>{a.status}</StatusPill></td>
                <td className="muted">{a.lastSignedInAt ? relativeTime(a.lastSignedInAt) : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can(me, 'iam.write') ? (
        <form onSubmit={onboard} className="card" style={{ marginTop: 24 }} aria-label="Add a person">
          <h2>Add a person</h2>
          <p className="muted">They must have an amana-ng.com Google account. They start with no role.</p>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@amana-ng.com" />
          <div style={{ marginTop: 12 }}><button type="submit">Add person</button></div>
        </form>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Implement the person page**

`app/(portal)/people/[id]/page.tsx`:

```tsx
'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirm } from '../../../../components/Confirm';
import { StatusPill } from '../../../../components/StatusPill';
import { api } from '../../../../lib/api';
import { errorMessage, relativeTime } from '../../../../lib/copy';
import { can, useMe } from '../../../../lib/me';
import { type AdminSummary, ROLES, type Role, type RoleGrant } from '../../../../lib/types';

export default function PersonPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<AdminSummary | null>(null);
  const [grants, setGrants] = useState<RoleGrant[]>([]);
  const [role, setRole] = useState<Role | ''>('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      const [{ admins }, g] = await Promise.all([api.iam.admins(), api.iam.grants(id)]);
      setPerson(admins.find((a) => a.id === id) ?? null);
      setGrants(g.grants);
    } catch (e) { setMsg({ err: errorMessage(e) }); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const propose = async () => {
    if (!role) return;
    setMsg({});
    try {
      const res = await api.iam.grant(id, role, reason || undefined);
      setRole(''); setReason('');
      setMsg({ ok: res.status === 'approved' ? 'Applied at once — the seeded bootstrap account is exempt from the second approval until it is stood down.' : 'Proposed. A second admin has to approve it in the inbox.' });
      await load();
    } catch (e) { setMsg({ err: errorMessage(e) }); }
  };
  const revoke = async (r: Role) => {
    setMsg({});
    try { await api.iam.revoke(id, r, undefined); setMsg({ ok: `${r} revoked. It took effect immediately.` }); await load(); } catch (e) { setMsg({ err: errorMessage(e) }); }
  };

  if (!person) return <p className="muted">{msg.err ?? 'Loading…'}</p>;
  const self = person.id === me.id;
  const write = can(me, 'iam.write') && !self;

  return (
    <>
      <h1>{person.email}</h1>
      <p className="sub">
        <StatusPill tone={person.status === 'active' ? 'ok' : 'bad'}>{person.status}</StatusPill>
        {' '}· {person.roles.length ? person.roles.join(', ') : 'no role yet'}
        {person.provisioningSource === 'config' ? ' · seeded from config (break-glass)' : null}
        {' '}· last sign-in {person.lastSignedInAt ? relativeTime(person.lastSignedInAt) : 'never'}
      </p>
      {self ? <div className="banner">You can't change your own roles. That is invariant 1: nobody can, so the admin role cannot quietly become every other role.</div> : null}
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}

      {write ? (
        <div className="card">
          <h2>Add a role</h2>
          <p className="muted">Takes two admins: you propose, a different admin approves in the inbox. Nobody may hold both admin and owner.</p>
          <label htmlFor="role">Role to add</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="">Choose a role</option>
            {ROLES.filter((r) => !person.roles.includes(r)).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label htmlFor="reason">Why</label>
          <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <div style={{ marginTop: 12 }}><button type="button" disabled={!role} onClick={propose}>Propose</button></div>
        </div>
      ) : null}

      {write && person.roles.length ? (
        <div className="card">
          <h2>Remove a role</h2>
          <p className="muted">Immediate, one person. Removing access must never wait for a quorum.</p>
          <div className="row">
            {person.roles.map((r) => <Confirm key={r} label={`Revoke ${r}`} confirmLabel="revoke" tone="danger" onConfirm={() => revoke(r)} />)}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>History</h2>
        {grants.length === 0 ? <p className="muted">No role has ever been granted or revoked.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Change</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>{grants.slice().reverse().map((g, i) => (
              <tr key={`${g.recordedAt}-${i}`}>
                <td className="muted">{relativeTime(g.recordedAt)}</td>
                <td>{g.granted ? 'granted' : 'revoked'} <strong>{g.role}</strong></td>
                <td className="mono">{g.source === 'config' ? 'config seed' : (g.grantedByAdminUserId ?? '—')}</td>
                <td className="muted">{g.reason ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run, typecheck, build, lint, commit**

```bash
pnpm --filter @amana/admin-portal test && pnpm --filter @amana/admin-portal typecheck && pnpm --filter @amana/admin-portal build && pnpm exec biome check apps/admin-portal
git add apps/admin-portal
git commit -m "feat(admin-portal): people — onboarding, grants that take two, revocations that take one"
```

---

### Task 10: The browser probe — a real session, a real browser, no Google

**Files:**
- Create: `tools/demo/probe-admin-portal.mjs`
- Modify: `docs/runbook/admin-portal.md` is written in Task 12; this task only produces the script and runs it once.

**Interfaces:**
- Consumes: a running backend on `BACKEND_URL` (default `http://localhost:3000`) and portal on `PORTAL_URL` (default `http://localhost:3400`), Docker's `amana-postgres`, `playwright` (root devDep). Mints a session **directly in Postgres** the way `tests/helpers/admin-session.ts` does — inserts `admin_users` (if absent), `admin_role_grants` for `ops` + `admin`, and an `admin_sessions` row whose `token_hash` is `sha256(token)`, then sets the `amana_admin_session` cookie on the Playwright context for `localhost`.

- [ ] **Step 1: Write the probe**

`tools/demo/probe-admin-portal.mjs`:

```js
// Hand-run browser pass over the admin portal. Sign-in is Google's, which no script can drive, so
// this mints a session in Postgres exactly as the backend would after a callback and drops the
// cookie into the browser. Everything after that is real: proxy, cookie, permissions, screens.
//
//   pnpm --filter @amana/backend dev      # :3000
//   pnpm --filter @amana/admin-portal dev # :3400
//   node tools/demo/probe-admin-portal.mjs
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:3400';
const EMAIL = process.env.PROBE_EMAIL ?? 'probe-ops@amana-ng.com';

const psql = (sql) =>
  execFileSync('docker', ['exec', 'amana-postgres', 'psql', '-U', 'amana', '-d', 'amana_dev', '-tA', '-c', sql]).toString().trim();

function mintSession() {
  const id = psql(`INSERT INTO admin_users (email, status, provisioning_source) VALUES ('${EMAIL}', 'active', 'admin')
    ON CONFLICT (email) DO UPDATE SET status='active' RETURNING id`);
  for (const role of ['ops', 'admin']) {
    psql(`INSERT INTO admin_role_grants (admin_user_id, role, granted, source, reason) VALUES ('${id}', '${role}', true, 'config', 'probe')`);
  }
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  psql(`INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at) VALUES ('${randomUUID()}', '${id}', '${hash}', now() + interval '1 hour')`);
  return token;
}

let failed = 0;
async function step(label, fn) {
  try { await fn(); console.log(`ok   ${label}`); }
  catch (e) { failed++; console.log(`FAIL ${label}: ${e.message}`); }
}

const token = mintSession();
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: 'amana_admin_session', value: token, url: PORTAL, httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const bad = [];
page.on('pageerror', (e) => bad.push(`pageerror ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400 && !/\?_rsc=/.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });

await step('sign-in page renders and links to /admin/auth/start', async () => {
  await page.goto(`${PORTAL}/sign-in`, { waitUntil: 'load' });
  const href = await page.getByRole('link', { name: 'Sign in with Google' }).getAttribute('href');
  if (href !== '/admin/auth/start') throw new Error(`href ${href}`);
});
await step('inbox shows the signed-in person through the proxy', async () => {
  await page.goto(PORTAL, { waitUntil: 'load' });
  await page.getByText(EMAIL).waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { name: 'Waiting for a second person' }).waitFor();
});
await step('vendors, retailers and people render', async () => {
  for (const [name, heading] of [['Vendors', 'Vendors'], ['Retailers', 'Retailers'], ['People', 'People']]) {
    await page.getByRole('link', { name }).click();
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
  }
});
await step('sign out clears the session', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in/);
  await page.goto(PORTAL, { waitUntil: 'load' });
  await page.waitForURL(/\/sign-in/);
});
await step('no console errors or 4xx/5xx during the pass', async () => {
  const unexpected = bad.filter((b) => !/401 .*\/admin\/me/.test(b));
  if (unexpected.length) throw new Error(unexpected.join('; '));
});

await browser.close();
process.exit(failed);
```

- [ ] **Step 2: Run it**

With both dev servers running (backend needs `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` only for the real Google leg, which this probe does not touch):

Run: `node tools/demo/probe-admin-portal.mjs`
Expected: five `ok` lines, exit 0. Fix anything it finds before moving on — the retailer portal's probe found nine such bugs.

- [ ] **Step 3: Commit**

```bash
pnpm exec biome check tools/demo/probe-admin-portal.mjs
git add tools/demo/probe-admin-portal.mjs
git commit -m "test(admin-portal): browser probe that mints a real session and walks every screen"
```

---

### Task 11: Deployment — Dockerfile, Fly config, gated CI job

**Files:**
- Create: `apps/admin-portal/Dockerfile`, `fly.admin.toml`
- Modify: `.dockerignore` (add `**/.next`), `.github/workflows/ci.yml` (add `deploy-admin`)

- [ ] **Step 1: Dockerfile**

`apps/admin-portal/Dockerfile`:

```dockerfile
# Build context is the repo root (fly.admin.toml sets the dockerfile path).
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/admin-portal/package.json apps/admin-portal/package.json
RUN pnpm install --frozen-lockfile --filter @amana/admin-portal...
COPY apps/admin-portal apps/admin-portal
RUN pnpm --filter @amana/admin-portal build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=3400 HOSTNAME=0.0.0.0
WORKDIR /app
# `output: 'standalone'` emits a self-contained server plus the minimal node_modules it needs.
COPY --from=builder /repo/apps/admin-portal/.next/standalone ./
COPY --from=builder /repo/apps/admin-portal/.next/static ./apps/admin-portal/.next/static
COPY --from=builder /repo/apps/admin-portal/public ./apps/admin-portal/public
EXPOSE 3400
CMD ["node", "apps/admin-portal/server.js"]
```

(Standalone output in a pnpm monorepo places `server.js` under `apps/admin-portal/` inside the standalone tree; verify the path after the first `next build` by running `find apps/admin-portal/.next/standalone -name server.js`. If there is no `public/` directory, create an empty one with a `.gitkeep` so the COPY does not fail.)

- [ ] **Step 2: Fly config**

`fly.admin.toml`:

```toml
app = 'amana-admin'
primary_region = 'jnb'

[build]
  dockerfile = 'apps/admin-portal/Dockerfile'

[env]
  NODE_ENV = 'production'
  PORT = '3400'
  # The API the proxy forwards to. Public hostname on purpose: the cookie is scoped to the PORTAL
  # host, so what the browser sees is admin.amana-ng.com and this hop is server-to-server.
  BACKEND_ORIGIN = 'https://api.amana-ng.com'

[http_service]
  internal_port = 3400
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  # One warm machine: the OAuth callback traverses this app, and a cold start inside Google's
  # redirect makes sign-in look broken. Not the API's "no cold starts for money" reason.
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = '10s'
    interval = '15s'
    method = 'GET'
    path = '/health'
    timeout = '3s'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '512mb'
```

- [ ] **Step 3: `.dockerignore` and CI**

Append to `.dockerignore`:

```
**/.next
```

In `.github/workflows/ci.yml`, after `deploy-staging`:

```yaml
  deploy-admin:
    needs: build-and-test
    runs-on: ubuntu-24.04
    # Flip the repository variable ADMIN_PORTAL_DEPLOY to 'true' once `fly apps create amana-admin`,
    # the cert and the DNS record exist (docs/runbook/admin-portal.md). Until then this job is skipped
    # rather than failing every push.
    if: github.ref == 'refs/heads/main' && github.event_name == 'push' && vars.ADMIN_PORTAL_DEPLOY == 'true'
    steps:
      - uses: actions/checkout@v6
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.admin.toml --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_ADMIN }}
```

- [ ] **Step 4: Build the image locally**

Run from the repo root: `docker build -f apps/admin-portal/Dockerfile -t amana-admin:local .`
Then: `docker run --rm -p 3401:3400 -e BACKEND_ORIGIN=http://host.docker.internal:3000 amana-admin:local` and in another shell `curl -i http://localhost:3401/health` → 200, `curl -i http://localhost:3401/admin/me` → 401 from the backend (proves the proxy works from inside the image).
Expected: both succeed. Stop the container.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/Dockerfile fly.admin.toml .dockerignore .github/workflows/ci.yml
git commit -m "build(admin-portal): standalone Docker image, Fly config for amana-admin, gated deploy job"
```

---

### Task 12: Documentation — runbook, plan status, design brief, flows, index

**Files:**
- Create: `docs/runbook/admin-portal.md`
- Modify: `docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md` (Task 5 status + a *Decided during Task 5* table copied from this plan's decisions), `docs/business/UI-UX-DESIGN-BRIEF.md` (new §10 admin portal, and add the admin portal's token copy to the §9.2 drift table), `docs/business/APP-FLOW.md` (new §9 staff flows: sign-in, the two-seat approval, claim → propose → approve, retailer lifecycle, onboarding + grant), `docs/product/README.md` (design system and user-flow rows: note the 2026-09-07 additions), `CLAUDE.md` (the apps list now includes `apps/admin-portal` and `apps/retailer-portal`; add `admin-portal.md` to the runbook list; note the proxy and the no-secrets rule), `docs/runbook/go-live-checklist.md` (§6: `admin.amana-ng.com` CNAME + cert as an item; `ADMIN_PORTAL_DEPLOY` variable).

- [ ] **Step 1: The runbook**

`docs/runbook/admin-portal.md` must contain, in this order, each as a section:

1. **What it is** — one paragraph: the staff portal, `apps/admin-portal`, port 3400, Next.js 14, no secrets, proxies `/admin/*`, `/vendors-admin/*`, `/retailers/*` to the API so the host-only session cookie works. Link the A1 plan and this plan.
2. **Run it locally** — the exact commands:
   ```
   docker compose up -d
   # backend, with the Workspace OAuth app so the real Google leg works:
   $env:GOOGLE_OAUTH_CLIENT_ID = '…'; $env:GOOGLE_OAUTH_CLIENT_SECRET = '…'
   pnpm --filter @amana/backend dev            # :3000
   pnpm --filter @amana/admin-portal dev       # :3400
   ```
   then open `http://localhost:3400`, which redirects to `/sign-in`; sign in as an amana-ng.com account that has been onboarded. Note that in dev the Google callback goes straight to `:3000` (that is the registered localhost redirect URI), which sets a `localhost` cookie the `:3400` portal's proxied requests then carry — cookies ignore the port.
3. **Tests** — `pnpm --filter @amana/admin-portal test`, and the probe: `node tools/demo/probe-admin-portal.mjs` with what it mints and why (no Google in a script).
4. **Permissions and what renders** — a table: section → permission (`Inbox` any session, scoped per kind; `Vendors` `vendor.read`, actions `vendor.write`; `Retailers` `retailer.read`/`retailer.write`; `People` `iam.read`/`iam.write`). State the two Task 5 permission changes (inbox scoped per kind; reject needs the deciding permission).
5. **Deploy** — the ops steps Alex performs once, in order: `fly apps create amana-admin`, `fly secrets` (none — say so explicitly), `fly deploy --config fly.admin.toml` for the first deploy, `fly certs add admin.amana-ng.com --app amana-admin`, the **Namecheap** CNAME (`admin` → `amana-admin.fly.dev`), then set the GitHub repository variable `ADMIN_PORTAL_DEPLOY=true` and the secret `FLY_API_TOKEN_ADMIN` (an app-scoped token). Then Cloudflare Access is a later, separate gate (not configured; DNS is not on Cloudflare — see google-workspace-setup.md).
6. **After the first sign-in** — point at the break-glass stand-down ceremony in `google-workspace-setup.md`, and say it is now done from `/people/<david's id>`: the second admin revokes `admin` from david@ on his page.
7. **Known limits** — no pagination anywhere (API caps at 200); the `/admin/auth/*` rate limit is one bucket for all staff behind the proxy (60 per 15 min); no admin suspend over HTTP; no audit-log screen yet (`audit.read` has no endpoint; Task 6/7); no money surfaces (Task 7).

- [ ] **Step 2: Plan status**

In the A1 plan, change Task 5's heading to `### Task 5 — The portal UI ✅ built 2026-09-07` and replace its one-line body with three lines: what shipped (the app, the two backend changes, the deploy config), a pointer to this plan for the decisions, and the sentence "Two permission rules changed in this task — see *Decided during Task 5*." Add the *Decided during Task 5 (2026-09-07)* table containing the **PLAN CHANGE** rows and the same-origin/hosting rows from this plan's decisions table, verbatim.

- [ ] **Step 3: Design brief, flows, index, CLAUDE.md, checklist**

Write §10 of the design brief following §9's structure exactly (10.1 the duplication, 10.2 add a row to the drift table for `apps/admin-portal/app/globals.css` with the same values and `--serif` as the one addition, 10.3 the vocabulary additions `.rail`, `.approval`, `.seat`, `.code`, `.banner`, 10.4 the rules: gold in three places only; every action names its consequence; two seats; status is colour plus a word; no money shown). Write APP-FLOW §9 in the file's ASCII-tree notation for the five flows listed above. Update the README rows with a dated note. Update CLAUDE.md's monorepo line ("Three apps" → "Five apps: `apps/{backend,principal,agent,retailer-portal,admin-portal}`") and add the runbook to the Docs paragraph. Add the two checklist items.

- [ ] **Step 4: Validate tables and commit**

Run: `python3 tools/docs/validate-tables.py` (if `python3` is not on PATH on Windows, run `py -3 tools/docs/validate-tables.py`; CI runs it regardless).

```bash
git add docs CLAUDE.md
git commit -m "docs: admin portal runbook, A1 Task 5 status and decisions, design brief §10, staff flows"
```

---

### Task 13: Finish — full verification and the PR

- [ ] **Step 1: Everything green**

```bash
pnpm exec biome check .
pnpm typecheck
pnpm build
pnpm --filter @amana/admin-portal test
pnpm --filter @amana/backend test     # ~14 min; run via PowerShell Start-Process with output to a file (see memory: long test runs)
```

Expected: all pass, including the backend coverage gate (new backend code is small and fully route-tested).

- [ ] **Step 2: Push and open a draft PR**

Branch `worktree-a1-task5-admin-portal` → `main`. Title: `feat(admin-portal): the staff portal — inbox, vendors, retailers, people (A1 Task 5)`. Body: what shipped, the two plan changes, the deploy steps that remain for Alex (Fly app, cert, CNAME, repo variable + secret), and the probe result. Do **not** merge.

---

## Self-review

**Spec coverage.** Task 5 as specified: sign-in ✔ (Task 5), ops surfaces ✔ (Tasks 7, 8), IAM screens ✔ (Task 9), approvals inbox ✔ (Task 6), tokens duplicated in CSS ✔ (Task 3), Fly beside the API ✔ (Task 11), `admin.amana-ng.com` ✔ (Task 11 + runbook), renders from permissions ✔ (every page uses `can`), invariants respected in copy and controls (self-edit blocked ✔ Task 9; grants two-person ✔ Tasks 6, 9; revocation immediate ✔ Task 9; least privilege stated ✔ Task 6 banner; bootstrap exemption surfaced ✔ Task 9). Support (Task 6 of the sub-plan) and money (Task 7) are explicitly out of scope and stated as such in the runbook.

**Placeholders.** None: every step has its code or its exact command. Two places instruct the executor to verify a path (`standalone/server.js`, `public/`) and one to move an export (`retailerTone`) — those are checks, not gaps.

**Type consistency.** `Approval` (types.ts) matches the Task 1 route response field for field, including `makerEmail`, `checkerEmail`, `decisionReason`, `decidedAt`. `VendorSummary` matches `vendor-summary.ts`. `ClaimAttempt.vendor` matches the enriched queue. `api.approvals.list(status)` matches `?status=`. `describeApproval(a, subjectName)` is called with that signature in Tasks 6 and 10. `Confirm` props are used identically in Tasks 7, 8, 9. `byRole(root, role, name)` and `byLabel` are used as defined in Task 5's harness.
