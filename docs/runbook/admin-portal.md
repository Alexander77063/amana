# Admin portal (sub-plan A1 Task 5)

## What it is

`apps/admin-portal` is the staff portal: a Next.js 14 App Router app on port **3400** where Amana's
own people work the maker-checker approvals inbox, the vendor registry, retailer onboarding and
staff access. It **holds no secrets** — no OAuth client, no `JWT_SECRET`, no admin key — and its
entire configuration is one server-side variable, `BACKEND_ORIGIN`. Sign-in, permissions and every
write happen on the API; the portal only renders what `/admin/me` says this person may do.

It exists on its own origin for one mechanical reason. The API sets the staff session as a
**host-only** `HttpOnly; Secure; SameSite=Lax` cookie with no `domain` attribute, so the cookie
belongs to whichever host issued it. For the portal's own `fetch` calls to carry it, the portal host
has to *be* that host — so `/admin/*`, `/vendors-admin/*` and `/retailers/*` are answered by the
portal and forwarded to the API, and the browser never talks to the API host directly.

Those three prefixes are proxied by **explicit Route Handlers**, not `next.config` `rewrites()`:
`app/admin/[...path]/route.ts`, `app/vendors-admin/[...path]/route.ts`,
`app/retailers/[...path]/route.ts` and — because a Next catch-all does not match zero segments —
`app/retailers/route.ts` for the bare `/retailers` list and create endpoints. All four are three
lines over the shared `lib/proxy.ts`. The choice cost a little ceremony and bought the one thing
that mattered: the OAuth callback is a `302` that also carries `Set-Cookie`, and a handler that
copies status, `set-cookie` (via `getSetCookie`, because `Headers.forEach` folds duplicates) and
`location` by hand is a function that can be unit-tested for exactly that, which a rewrite is not.
`redirect: 'manual'` is load-bearing there: following the redirect inside the proxy would swallow
the cookie and land the server on a page meant for the browser. An unreachable backend answers
`502 {"error":"backend_unreachable"}` rather than a Next stack trace.

- Sub-plan: [`docs/superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md`](../superpowers/plans/2026-08-28-sub-plan-a1-admin-portal-iam.md)
- Task 5 build plan: [`docs/superpowers/plans/2026-09-07-a1-task5-admin-portal-ui.md`](../superpowers/plans/2026-09-07-a1-task5-admin-portal-ui.md)
- Google Workspace + OAuth app: [`google-workspace-setup.md`](./google-workspace-setup.md)

## Run it locally

```powershell
docker compose up -d

# Backend, with the Workspace OAuth app so the real Google leg works:
$env:GOOGLE_OAUTH_CLIENT_ID = '…'
$env:GOOGLE_OAUTH_CLIENT_SECRET = '…'
pnpm --filter @amana/backend dev            # :3000

pnpm --filter @amana/admin-portal dev       # :3400
```

Open `http://localhost:3400`. With no session the shell's `/admin/me` call 401s and it redirects to
`/sign-in`; sign in with an `amana-ng.com` account that has already been onboarded — the portal
refuses everything else, and so does the backend.

**In dev the Google callback lands on `:3000`, not `:3400`,** because that is the redirect URI
registered with Google for localhost. It works anyway: cookies ignore the port, so the `localhost`
cookie the backend sets is sent by the `:3400` portal's proxied requests. It is the one place where
dev and production differ in shape rather than in configuration, and it is worth knowing before you
debug a session that "should not" be there.

`BACKEND_ORIGIN` defaults to `http://localhost:3000` in each Route Handler, so nothing needs setting
locally. It is read at module scope, server-side only — never `NEXT_PUBLIC_*`, which would ship the
API origin to the browser and invite someone to call it directly, losing the cookie that is the
whole point of the proxy.

## Tests

```bash
pnpm --filter @amana/admin-portal test      # vitest run
pnpm --filter @amana/admin-portal typecheck
pnpm exec biome check apps/admin-portal
```

The app declares a `test` script deliberately: `turbo run test` picks up any package that has one,
and the retailer portal — which has none — is silently skipped by CI. Staff tooling that can hand a
merchant's bank account to a phone number gets tests.

What is covered is logic and rendered output, not a real browser: `lib/proxy.test.ts` (header
stripping, manual redirects, multiple `Set-Cookie`s, the 502 on an unreachable backend),
`lib/api.test.ts`, `lib/copy.test.ts` (error copy, phone masking, the approval sentences), the
components, and the screens, rendered with `react-test-renderer` against the mocks in `test/`.

> **The browser probe (`tools/demo/probe-admin-portal.mjs`) is not in the repo yet** — it is Task 10
> of the build plan and has not been committed. When it lands it mints a staff session **directly in
> Postgres** (an `admin_users` row, `admin_role_grants`, and an `admin_sessions` row whose
> `token_hash` is `sha256(token)`) and drops the cookie into Playwright, because Google sign-in is
> the one leg no script can drive. Everything after the cookie is real: proxy, session, permissions,
> screens.

### A gotcha anyone adding a page will hit

`/sign-in` reads `?error=sign_in_failed` — the query the backend redirects to when the Google leg
fails — and shows a banner. The banner is wrapped in `<Suspense fallback={null}>` because Next 14
**refuses to build** a client page that calls `useSearchParams` without a boundary: the hook opts the
page out of static prerendering, and Next wants that opt-out scoped rather than applied to the whole
page. Splitting it is also the better outcome, not just the permitted one — the sign-in link sits in
the static shell and is there the instant the page paints, while only the failure banner waits.

## Permissions and what renders

The rail is built from **permissions, never role names** (`lib/me.tsx`'s `can()`): a section whose
first request would 403 is not shown at all. Role names appear in exactly one place — as information
about a person. The portal keeps no copy of the role matrix; `/admin/me` returns the permissions and
every screen renders from them, which is why the matrix can change without a portal deploy.

| Section | Route | To see it | To act |
|---|---|---|---|
| Inbox | `/` | any signed-in session — the list is scoped per kind | `iam.write` to decide a role grant; `vendor.write` to decide a vendor claim; the maker may always withdraw their own |
| Vendors | `/ops/vendors`, `/ops/vendors/[id]` | `vendor.read` | `vendor.write` — propose a claim approval, set a category, suspend, revoke a consent, flip a household's enforcement |
| Retailers | `/ops/retailers`, `/ops/retailers/[id]` | `retailer.read` | `retailer.write` — create, submit KYB, approve, suspend |
| People | `/people`, `/people/[id]` | `iam.read` | `iam.write` — onboard, propose a grant, revoke |

Two permission rules **changed in Task 5**, because the contract survey found gaps no UI could work
around. Both are backend changes; they are recorded here because they are the reason the inbox
behaves the way it does.

1. **The inbox is scoped per kind, not gated as a whole.** `GET /admin/approvals` used to require
   `iam.read`. `ops` does not hold it — so the only role that works vendor-claim approvals could not
   see the queue at all, got a 403, and had to be handed approval ids out of band. A queue nobody can
   see is not a control. Now `visibleKinds()` (`admin-approval.service.ts`) shows `role_grant` to
   anyone with `iam.read` **or** `iam.write`, and `vendor_approve_claim` to anyone with `vendor.read`
   **or** `vendor.write`, **plus every proposal you made yourself** — a maker keeps sight of their own
   request even after losing the permission that let them make it, because withdrawing it is still
   theirs to do. Someone with no matching permission gets an empty list rather than a 403: an empty
   inbox is a true statement about their work.
2. **Rejecting needs the same permission as approving that kind.** `iam.read` used to be enough to
   reject anything, which meant `auditor` — specified as "writes nothing, anywhere" — could decline a
   vendor claim that the `ops` admin who works the queue could not. The permission to decline is the
   permission to decide, so `reject` now dispatches on kind exactly as `approve` does, through
   `REJECT_PERMISSION` in `admin-approval-dispatch.service.ts`. Maker-cannot-be-checker still applies,
   and `cancel` deliberately keeps no permission check at all — withdrawing your own proposal is
   refused to anyone who is not its maker, and to nobody else.

The list also gained `?status=pending|decided` and now returns `makerEmail`, `checkerEmail`,
`decisionReason` and `decidedAt` — the fields the two-seat card needs to name both people without a
second round trip per row.

Alongside them, ops gained a way to see the business it is deciding about:
`GET /vendors-admin/vendors` (optional `status`, optional `q` matching the display name
case-insensitively or the public code exactly, newest promotion first, capped at 200) and
`GET /vendors-admin/vendors/:id` (the vendor plus its claim attempts). `GET
/vendors-admin/claim-queue` rows now carry a `vendor` summary as well. All three go through
`apps/backend/src/lib/vendor-summary.ts`, which masks the account number to `••••1234` — ops never
needs the full number, and the claim already carries the bank identity. The cutover test
(`tests/routes/admin-cutover.test.ts`), which presents the deleted `x-admin-api-key` to every ops
endpoint and requires each to refuse it, now enumerates **15** endpoints rather than 13.

## Deploy

> **Not in the repo yet.** `apps/admin-portal/Dockerfile`, `fly.admin.toml` and the CI job are Task
> 11 of the build plan and are not committed. Treat this section as the sequence to follow once they
> land, not as a description of files you can read today.

The portal is its own Fly app rather than a process group on `amana-api`, because the OAuth redirect
URI registered with Google points at the **portal** host and the session cookie is host-only — the
portal host is the one that must forward `/admin/*`.

```bash
fly apps create amana-admin                          # region jnb

# Secrets: NONE. Not an omission — the portal holds nothing worth stealing, and the day someone
# adds a secret here is the day this app stops being safe to redeploy casually.
# BACKEND_ORIGIN=https://api.amana-ng.com is a plain [env] value in fly.admin.toml, not a secret.

fly deploy --config fly.admin.toml                   # first deploy
fly certs add admin.amana-ng.com --app amana-admin
```

`fly.admin.toml` goes at the repo root beside `fly.toml` and `fly.staging.toml`; the Dockerfile is
`apps/admin-portal/Dockerfile`, built with the **repo root** as context, because a pnpm workspace app
cannot be built from its own directory. Internal port **3400**, health check `/health` (a static
`{"status":"ok"}` — a portal that can render is a portal that is up), 512 MB, and
`min_machines_running = 1`. That last one is not the API's "no cold starts" argument: a cold portal
stalls Google's redirect inside the sign-in's ten-minute TTL, and the operator sees a failure that
was really a boot.

**DNS is at Namecheap** — not Bluehost, not Cloudflare. Add a CNAME `admin` →
`amana-admin.fly.dev`, then `fly certs add` as above and wait for the cert to validate. Cloudflare
Access, which the sub-plan lists as a second independent gate in front of the app, is **not
configured and cannot be while DNS lives elsewhere**; it is a later, separate decision. See
[`google-workspace-setup.md`](./google-workspace-setup.md).

Then turn CI on: repository **variable** `ADMIN_PORTAL_DEPLOY=true` and repository **secret**
`FLY_API_TOKEN_ADMIN` (an app-scoped token, not the org token). The `deploy-admin` job is gated on
both so it does not fail every push in the window between merging the config and doing the ops steps
— a red CI everyone has learned to ignore is worse than no CI.

## After the first sign-in

The config-seeded bootstrap account `david@amana-ng.com` holds **both** `owner` and `admin`, which
is what makes the very first grant possible at all and what makes it a break-glass account. Standing
it down is the ceremony in
[`google-workspace-setup.md` → "After the first sign-in"](./google-workspace-setup.md): david@
onboards a real admin, and that second admin — **not david@** — revokes david@'s `admin` role,
restoring segregation of duties.

That ceremony is written there as `curl`. It is now doable from the portal: the second admin opens
`/people`, opens david@'s page, and revokes `admin` there. Revocation is immediate and needs no
second person; only *granting* is maker-checked, because a grant creates standing and a revocation
removes it, and delay is harmful in only one of those directions.

## Known limits

- **No pagination, anywhere — and the lists do not even fail the same way.** The vendor search, the
  claim queue and the inbox are capped server-side at 200 rows (`vendorsRepo.search`,
  `listPendingForOps`, `listForActor`); `/people` and `/ops/retailers` are capped at **nothing at
  all** (`adminUsersRepo.listAll`, `retailersRepo.listByOnboardingStatus`), and the portal renders
  whatever comes back. At a handful of staff and the volumes this launches at, a "Load more" nobody
  needs is a control that will rot untested — but the two shapes go wrong differently and both go
  wrong quietly. A capped list shows 200 things and implies that is all of them; an uncapped one
  keeps working until the day a retailer status has ten thousand rows behind it and the page stops
  rendering. The uncapped pair is the more urgent of the two, because the cap is at least a decision.
- **The `/admin/auth/*` rate limit is one bucket for all staff.** It is keyed per IP
  (`RATE_LIMIT_AUTH_PER_IP` = 60 per `RATE_LIMIT_WINDOW_SECONDS` = 900s), and behind the proxy every
  sign-in arrives from the portal machine. Accepted for a team this size; the browser's own address
  travels in `x-forwarded-for` for logs. It needs re-keying before staff numbers grow, or the first
  time anyone hits a 429 at sign-in.
- **No way to suspend an admin over HTTP.** `admin_users.status` is enforced everywhere — a suspended
  account's live sessions stop working at the next request, not at expiry — but `/admin/iam` exposes
  list, onboard, read roles, grant and revoke, and nothing else. Suspension is still a database
  write. Removing someone urgently is done in Google Workspace, which is the identity boundary
  anyway; this is a gap in the portal, not in the control.
- **No audit-log screen.** `audit.read` exists in the permission matrix and `auditor` holds it, but
  no endpoint consumes it, so there is nothing for the portal to render. The `audit_log` table is
  immutable and complete — it is only unreachable over HTTP.
- **No money and no support surfaces.** JIT elevation for `money.operate` is Task 7 of the sub-plan
  and support verification is Task 6; neither has a screen here, and the portal displays no money at
  all.
