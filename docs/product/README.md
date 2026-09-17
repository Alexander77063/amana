# Amana — product foundation docs

The ten documents every project must carry, where each one actually lives, and — the part that
matters — **how far each has drifted from the product that exists today**.

A stale document is more dangerous than a missing one: a missing one sends you to the code, a stale
one gets believed. So status here is not decoration. If a row says STALE, treat its contents as
history rather than specification until it is refreshed.

**Reference date for this audit: 2026-08-25.** The MVP requirement docs were written 2026-05-13.
**124 feature commits have landed since**, including the whole marketplace (SP1–SP5b), digital VAS,
retailer onboarding with Anchor Business KYB, and the retailer portal.

**Re-audited 2026-09-09, and four rows had drifted again in fifteen days.** Sub-plan A1 — the
admin portal and IAM — shipped between 2026-08-28 and 2026-09-09 and was **absent from every one
of these documents**: no requirements in the RRD, no flow in APP-FLOW, and ten tables missing from
the schema doc. The 2026-08-25 refresh was real and its work stands; what it could not do was stay
true through a subsystem that landed after it. All four are now corrected — see *The 2026-09-09
re-audit*, below.

**Amended 2026-09-16 — the first of these is now a machine.** `tools/docs/validate_schema_doc.py`
runs in CI on every push and fails the build when `database-schema.md` disagrees with
`apps/backend/src/db/schema/*.ts`. Row 6 is therefore the only row here that can no longer go stale
quietly; the other nine still depend on someone updating them in the same commit. The guard's first
catch was a stale figure inside the schema doc's own section warning about stale figures. See
*The mechanised check*, below.

**Re-checked 2026-09-14, at the PR #65 merge — and the fourth instance was already written.**
The admin portal's branch predated that re-audit and carried its own docs; merging `main` into it
turned up a requirement that said the portal does not exist. See *The 2026-09-14 merge*, below.

The four May documents were refreshed on 2026-08-25 — the same day this index first recorded them
as stale. Each carries a banner naming what changed and what was already right; none was rewritten
from scratch. See *What refreshing them involved*, below.

## The set

| # | Required | Lives at | Status |
|---|---|---|---|
| 1 | **PRD** | [`docs/business/PDR.md`](../business/PDR.md) | ✅ **CURRENT** — v1.1, refreshed 2026-08-25. Marketplace, VAS, the control fusion and the retailer as a second customer added; the May problem statement and market analysis were still right and stand unchanged. |
| 2 | **TRD** | [`docs/business/RRD.md`](../business/RRD.md) + [`docs/adr/`](../adr/) | ✅ **CURRENT** — refreshed 2026-08-25, **§1.15 admin portal & IAM added 2026-09-09** (17 requirements, IAM-1–17; the subsystem had none at all), **amended 2026-09-14** for the admin portal: IAM-17 said there was no admin client and is rewritten, and IAM-18–20 record Task 5's per-kind inbox, decline-needs-the-deciding-permission and masked vendor reads. **IAM-21–26 added 2026-09-16** for A1 Task 6 — the indistinguishable start, number matching and the two attempt budgets, operator-bound sessions, the database-counted caps and their explicit 429, principals-and-agents-only, and the fields the start response must omit. **IAM-27–34 added 2026-09-17** for A1 Task 7 — `money.operate` is not standing power; elevation *unlocks* a held permission and never grants one (so an `admin` is refused even holding a valid elevation); one transaction per elevation, single-use, and still live after a *failed* attempt; the operator supplies authority and a reason but never the outcome; a failed Anchor call is never read as absence; the force path reverses but never settles; no money operation writes its own ledger entries; and every branch is audited including refusals. Plus a staff-auth row in §2.2. Retailer auth (AUTH-10–14), the `merchant` rule and the six rule kinds (RULE-9–14), and new §1.12–1.14 for VAS, marketplace and retailer onboarding. The five ADRs still hold. |
| 3 | **MVP scope** | [`mvp-scope.md`](./mvp-scope.md) | ✅ **CURRENT** — rewritten 2026-08-25. The MVP shipped; this now states what is in, what is deliberately out, and where the cut line moved. |
| 4 | **User flow** | [`docs/business/APP-FLOW.md`](../business/APP-FLOW.md) | ✅ **CURRENT** — refreshed 2026-08-25, amended 2026-08-26, 08-27, 09-07, 09-09, **09-14**, **09-16** and **09-17**. **§9.9 added 2026-09-17** — resolving a stuck transaction behind JIT elevation (A1 Task 7), including why the surface exists at all: the sweep abandons transfers Anchor has no record of, so that money is unreachable by any automated path. **§9.8 added 2026-09-16** — the support arc, with the three start branches drawn converging on one boxed note: the operator's screen cannot tell a stranger's number from a customer who did not answer, and that equivalence is the security property rather than a UI accident. **§9 is one section written on two branches and merged 2026-09-14**: the 2026-09-09 audit's admin & ops arc (staff SSO, the five roles, the append-only grant log, maker-checker) underneath the 2026-09-07 staff portal flows (A1 Task 5 — sign-in, the two-seat approval, claim → propose → approve, the retailer lifecycle, onboarding and role grants). The audit had documented it "as an API surface because `apps/` contains no admin client" — true of `main` that day, false once PR #65 merged; removed. The portal pass also found two **false** passages and fixed them in place: §8.4 claimed the ops surfaces used `ADMIN_API_KEY` and had "no UI" (the secret was deleted in A1 Task 4 and a UI now exists), and §7.1's ops column said the same. **§8 vendor arc added 2026-08-27**: the passive registry, the claim rail (post-Gate-3 two-step shape) and the payable code — SP-V1/V2/V3 had shipped with no flow documented at all, and §7.1 covers a different rail with a different actor. Added §3.6 VAS, §6 marketplace incl. the control fusion drawn as a two-column sequence, §7 retailer portal; SP-V3's vendor-code scan branch added to §3.2. **Correction:** the 2026-08-25 note claimed the principal *and* agent wallet flows were accurate. The agent ones were. §1.1's `PayTab` and all of §2.5 (principal direct spend) describe screens that do not exist in `apps/principal/src/`; both are now marked NOT BUILT in place. |
| 5 | **Design system** | [`packages/ui`](../../packages/ui) (source of truth) + [`UI-UX-DESIGN-BRIEF.md`](../business/UI-UX-DESIGN-BRIEF.md) + [`brand.md`](../brainstorm/brand.md) | ✅ **CURRENT** — v1.1, refreshed 2026-08-25, extended 2026-09-07. The brief's palette and typeface were **wrong**, not merely incomplete — §3 and §4 are corrected to the shipped tokens, and §9 covers the retailer portal. Details below. **§10.6 added 2026-09-17** for money operations (A1 Task 7): the screen offers no settle-or-reverse choice because Anchor decides, which is the control itself rather than a simplification; and each refusal gets copy naming what to do instead — notably `anchor_unreachable`, which tells the operator *not* to retry, contradicting the natural instinct on purpose. **§10.5 added 2026-09-16** for support verification (A1 Task 6): `.code` gains a second use for the match number — the same semantic as the minted voucher code, a value read aloud once, so not a fourth spend of gold — plus the rule that the screen never names the rail, and that every panel states its omissions. **§10 added 2026-09-07** for the admin portal (A1 Task 5): the two-seat approval line, gold spent in exactly three places, every action naming its consequence. §9.2's drift table now tracks **two** duplicated token copies rather than one — the admin portal's differs from the retailer portal's by a single line, `--serif: Georgia`. |
| 6 | **Database schema** | [`database-schema.md`](./database-schema.md) | ✅ **CURRENT — and now machine-checked.** Rewritten 2026-08-25, **refreshed 2026-09-09**: it had gone from 30 tables to 40 with **ten undocumented**, and 35 migrations to 49. It superseded `BACKEND-SCHEMA.md` for predating five schema files, then came to predate ten itself in fifteen days. **Amended 2026-09-16**: `tools/docs/validate_schema_doc.py` now fails CI when this document and `apps/backend/src/db/schema/*.ts` disagree, so its counts and its table list can no longer drift silently. That guard's first catch was in this file's own "Keeping this current" section — it still said the inventory regex "gives 30" and that a single-line grep "undercounts by eight", 2026-08-25 figures that survived the 09-09 refresh which corrected the header to 40. **And then the same paragraph went stale again the very next day** — A1 Task 6's migration made it 41 tables and 16 multi-line declarations, and the guard said nothing, because it checks the count CLAIM and the table names and this was neither. That is the prose-shaped hole named below, demonstrated on the smallest possible scale by the person who had just written about it. **Amended 2026-09-17**: A1 Task 7 added `admin_elevations` (migration `0050`), and the guard did its job — it failed the build on the table count, the migration count and the undocumented table before a word was written. It also surfaced a *second*, older drift while there: the migrations figure appears twice in that document and the prose copy had been stale since before Task 6. Now 42 tables and 51 migrations. |
| 7 | **Monetisation** | [`docs/business/PRICING.md`](../business/PRICING.md) | ✅ **CURRENT** — 2026-07-01, confirmed against Anchor's real pricing schedule. The most load-bearing document here. **§8 added 2026-08-27** — adjacent revenue from operational by-products (the merchant cash-flow graph, category codes, verified-payee identity), explicitly marked strategy rather than model, with the `observed`/`claimed` consent boundary written down. |
| 8 | **Launch plan** | [`launch-plan.md`](./launch-plan.md) | ✅ **NEW** — 2026-08-25. Was a genuine gap; `go-live-checklist.md` covers ops readiness only, not sequence, gates or rollback. |
| 9 | **User acquisition** | [`user-acquisition.md`](./user-acquisition.md) | ✅ **NEW** — 2026-08-25, building on [`embedded-distribution-strategy.md`](../business/embedded-distribution-strategy.md). |
| 10 | **Growth plan** | [`growth-plan.md`](./growth-plan.md) | ✅ **NEW** — 2026-08-25. Was a genuine gap. |

## Why several of these live in `docs/business/`

They were written before this index existed, and they are good. Moving them would break every link
that points at them and would gain nothing. **Extend the real document; do not write a second copy.**
Two versions of a PRD drift within a week, and then neither can be trusted — which is precisely the
failure this index exists to prevent.

## The 2026-09-09 re-audit — the same failure, fifteen days later

**Reference date: 2026-09-09.** 39 commits since the 2026-08-27 amendment, of which 11 touched
`apps/` or `packages/`. One subsystem accounts for almost all of it: **sub-plan A1, the admin
portal and IAM** — staff identity on Google Workspace SSO, five fixed roles, an append-only grant
log, maker-checker on the actions that create authority, and the deletion of the shared ops secret.

It was in **none** of the ten documents. Specifically, and each of these was checked rather than
assumed:

| Document | What was missing |
|---|---|
| TRD (`RRD.md`) | A grep for staff identity, Workspace SSO, maker-checker or `admin_role` returned **zero** matches |
| User flow (`APP-FLOW.md`) | Sections ran 1–8, ending at the vendor arc. No admin section existed |
| Schema (`database-schema.md`) | Claimed *30 tables, 29 enums, 35 migrations*. Reality: **40 tables, 40 enums, 49 migrations**, with ten tables undocumented |

The ten missing tables: `admin_users`, `admin_sessions`, `admin_auth_requests`,
`admin_role_grants`, `admin_approvals`, `user_consents`, `vendor_consents`, `vendors`,
`vendor_observations`, `vendor_claim_attempts`.

### The uncomfortable pattern

This is the **third** time the same shape of defect has been recorded in this index.

1. `BACKEND-SCHEMA.md` was superseded for predating five schema files.
2. The vendor arc (SP-V1/V2/V3) shipped with **no flow documented at all**, caught 2026-08-27.
3. The admin arc shipped with no flow, no requirements and no schema — caught today.

The schema document written *to fix* problem 1 became problem 3 in fifteen days. The flow section
added *to fix* problem 2 was followed by the identical gap in the very next subsystem.

**A dated audit is not a mechanism.** Each of these was found by someone deciding to look, and
between decisions the documents drift at the speed the code ships. The standing rule is that a
document is updated *in the same commit as the change that invalidates it* — an A1 PR should have
carried its own RRD requirements, its own APP-FLOW section and its own schema rows, and none of
them did. Until that holds, expect a fourth instance.

The cheap partial guard already exists and works:
[`tools/docs/validate-tables.py`](../../tools/docs/validate-tables.py) catches malformed tables
across every Markdown file under `docs/`. **A comparable check for the schema doc is mechanisable** — the table count and
names can be diffed against `apps/backend/src/db/schema/*.ts` in CI, which would have caught this
one the day A1 merged.

### The mechanised check — built 2026-09-16

**The sentence above is no longer a suggestion.**
[`tools/docs/validate_schema_doc.py`](../../tools/docs/validate_schema_doc.py) runs on every push in
the `docs` CI job and fails the build when `database-schema.md` and the code disagree. It checks
three things: the **count claim** (`**N tables, N enums, N migrations.**`) against what is measured;
every `pgTable` in the schema appearing as a backticked name **somewhere** in the doc — the check
that catches the recorded defect; and every table the "Tables by domain" lists actually existing, so
a dropped one cannot linger. It has 18 tests of its own, which CI runs first, because a guard nobody
tests can pass while checking nothing.

Two deliberate properties. A `pgTable(` call whose name is not a literal string **fails the build**
rather than being skipped — silently under-counting would make the guard worse than none. And if the
count sentence is reworded away or duplicated, that **also** fails, rather than the check quietly
switching itself off.

**It caught something on its first run**, in the one place that is almost funny: the schema doc's
"Keeping this current" section, the paragraph that exists to warn about stale numbers, said the
inventory regex "gives 30" and a single-line grep "undercounts by eight". Both were 2026-08-25
figures that survived the 2026-09-09 refresh which corrected the header to 40. It is 40, and the
undercount is 15.

**What it does not close.** This is the table-shaped hole only. The 2026-09-14 instance below was a
false *sentence* — "There is no admin client application … `[NO UI]`" — merging cleanly into the
branch that builds that client. No table was involved and no count moved, so this guard would have
said nothing. Grepping the merged tree for the claims an incoming branch falsifies is still a human
job. **Three of the four recorded instances are now mechanised; the fourth is not.**

### One code comment corrected while auditing

`apps/backend/src/middleware/admin-session.ts` still said the session auth and the shared
`x-admin-api-key` "live side by side deliberately until Task 4". Task 4 shipped: `admin-auth.ts` is
deleted and `ADMIN_API_KEY` is gone from `env.ts` rather than deprecated. The comment described a
transitional state that no longer exists, in the file whose whole purpose is that it no longer
exists.

## The 2026-09-14 merge — the fourth instance, caught at the merge

The 09-09 re-audit ended *"expect a fourth instance"*. It had already been written. PR #65 (A1
Task 5, the admin portal) branched before that audit and **did** carry its own docs, as the
standing rule asks — an APP-FLOW §9, a design brief §10, a runbook. Meanwhile the audit, on
`main`, wrote a *different* §9 for the same subsystem and recorded — correctly, for `main`, that
day — that no admin client existed. Merging `main` into the PR conflicted in APP-FLOW and in this
index. That was the easy part.

**The dangerous part merged cleanly.** `RRD.md` IAM-17 — *"There is no admin client application
… `[NO UI]`"* — was never touched by the PR, so git applied it without a word, into the branch that
builds that client. So were two present-tense "the 13 ops endpoints" code comments, which the
portal's two vendor reads had made 15. **A conflict-free merge is evidence that two texts did not
collide, not that either is still true.**

Resolved as a union rather than a pick: one §9 with the audit's IAM model underneath the portal's
flows, IAM-17 rewritten, IAM-18–20 added for the permission changes Task 5 made to the backend,
and both comments corrected. The mechanisable guard named above would not have caught this one —
it diffs table names, and nothing here was a table. What catches it is grepping the merged tree
for every claim the incoming branch falsifies (`no admin`, `NO UI`, the old endpoint count).

## What refreshing them involved — done 2026-08-25

Not a rewrite. Each got the same treatment: a dated banner saying what changed and, just as
importantly, **what was already right**, then new sections appended in the document's own notation.
A refresh that silently replaces everything destroys the reader's ability to tell which parts had
been load-bearing all along.

- **PRD** — the marketplace and the control fusion, the retailer as a second customer with its own
  surface, and a shipped-since-MVP table. The problem statement and market analysis were untouched.
- **TRD** — retailer auth requirements, the `merchant` rule and the empty-vs-absent distinction,
  Lagos-timezone evaluation, and three new subsystem sections.
- **User flow** — the three missing flows, drawn in the file's existing ASCII-tree notation. The
  fusion is deliberately drawn as **two columns**, principal beside agent, because the ordering
  between them *is* the product claim — the catalogue narrows because a rule was written.
- **Design brief** — the one that turned up a real problem. See below.

### The design brief was wrong, not just incomplete

The refresh was scoped as "add a note about the retailer portal". Diffing the brief against
`packages/ui/src/theme/tokens.ts` before writing that note found that **v1.0's entire palette and
typeface never shipped**: it specified a green (`#1A6B4A`) and off-white system set in Inter, and
`#1A6B4A` appears **nowhere** in `packages/ui` or either app. What shipped is dark navy and gold in
Georgia + Plus Jakarta Sans. Anyone designing from that brief would have produced work that could
not be built.

Because §3 and §4 were dead, everything downstream that cited them was dead too. §5 Component
Patterns specified primary buttons as white-on-`--amana-green`; they ship gold-on-navy. §6 screens
cited a `display` type token that does not exist. Four things were not merely stale but **false**:

| Said | Actually |
|---|---|
| §3/§4 — green + off-white, Inter | Navy + gold, Georgia + Plus Jakarta Sans |
| §5.1 — primary button is white on green | Gold ground, `bg.base` text (white on `#C9A227` fails AA) |
| §6.2 — SubWalletDetail shows a **balance card** | Sub-wallets are **limits-only**; a sub-wallet balance is structurally always ₦0.00, and the app rendered exactly that until it was fixed. It shows a spend summary. |
| §8 — "Dark mode: not in MVP scope. Light mode only." | Dark ships, and follows the OS. This was the most misleading line in the document. |

Old values are kept as *superseded* rather than deleted, so a v1.0 mock can be recognised for what
it is.

Two more problems surfaced from auditing rather than reading. The portal's duplicated tokens had
copied `--border` as alpha `0.08` against a source of `0.06` — invisible in review, invisible in a
screenshot, found only by diffing the two files. And **every table in the design brief was missing
its `|---|` delimiter row** — all six of them rendered as literal pipe text rather than tables, in
the one document written to be handed to an outside design agency.

Worth admitting: the tables added during this refresh had *copied the broken pattern*, because it
looked like house style. Four more, propagated by the very pass that was meant to fix the document.
A sweep then found 37 more across four other files. All 44 fixed, and now checked by
[`tools/docs/validate-tables.py`](../../tools/docs/validate-tables.py) — a rendering bug that is
invisible in an editor and obvious in a browser needs a machine, not a reader.

**"Add a note" is not a safe scope for a document nobody has diffed against the code.**

## Related operational docs

These are not part of the ten but are where the detail actually lives:

- [`runbook/funds-model.md`](../runbook/funds-model.md) — the limits-only sub-wallet model and money flows
- [`runbook/marketplace-buyer.md`](../runbook/marketplace-buyer.md) — browse filtering, the merchant rule, the category-vs-section distinction
- [`runbook/retailer-onboarding.md`](../runbook/retailer-onboarding.md) — retailer state machine, KYB, the portal
- [`runbook/vas.md`](../runbook/vas.md) — airtime, data, electricity, cable
- [`runbook/admin-portal.md`](../runbook/admin-portal.md) — the staff portal: the same-origin proxy, what each permission renders, the two Task 5 permission changes, the deploy sequence and the known limits
- [`runbook/go-live-checklist.md`](../runbook/go-live-checklist.md) — pre-production secrets and gates
- [`brainstorm/locked-decisions.md`](../brainstorm/locked-decisions.md) — the numbered decisions the code cites
