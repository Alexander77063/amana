# Amana — product foundation docs

The ten documents every project must carry, where each one actually lives, and — the part that
matters — **how far each has drifted from the product that exists today**.

A stale document is more dangerous than a missing one: a missing one sends you to the code, a stale
one gets believed. So status here is not decoration. If a row says STALE, treat its contents as
history rather than specification until it is refreshed.

**Reference date for this audit: 2026-08-25.** The MVP requirement docs were written 2026-05-13.
**124 feature commits have landed since**, including the whole marketplace (SP1–SP5b), digital VAS,
retailer onboarding with Anchor Business KYB, and the retailer portal.

**All ten rows are now current.** The four May documents were refreshed on 2026-08-25 — the same
day this index first recorded them as stale. Each carries a banner naming what changed and what was
already right; none was rewritten from scratch. See *What refreshing them involved*, below.

## The set

| # | Required | Lives at | Status |
|---|---|---|---|
| 1 | **PRD** | [`docs/business/PDR.md`](../business/PDR.md) | ✅ **CURRENT** — v1.1, refreshed 2026-08-25. Marketplace, VAS, the control fusion and the retailer as a second customer added; the May problem statement and market analysis were still right and stand unchanged. |
| 2 | **TRD** | [`docs/business/RRD.md`](../business/RRD.md) + [`docs/adr/`](../adr/) | ✅ **CURRENT** — refreshed 2026-08-25. Retailer auth (AUTH-10–14), the `merchant` rule and the six rule kinds (RULE-9–14), and new §1.12–1.14 for VAS, marketplace and retailer onboarding. The five ADRs still hold. |
| 3 | **MVP scope** | [`mvp-scope.md`](./mvp-scope.md) | ✅ **CURRENT** — rewritten 2026-08-25. The MVP shipped; this now states what is in, what is deliberately out, and where the cut line moved. |
| 4 | **User flow** | [`docs/business/APP-FLOW.md`](../business/APP-FLOW.md) | ✅ **CURRENT** — refreshed 2026-08-25. Added §3.6 VAS, §6 marketplace incl. the control fusion drawn as a two-column sequence, §7 retailer portal. The principal and agent wallet flows were accurate and are unchanged. |
| 5 | **Design system** | [`packages/ui`](../../packages/ui) (source of truth) + [`UI-UX-DESIGN-BRIEF.md`](../business/UI-UX-DESIGN-BRIEF.md) + [`brand.md`](../brainstorm/brand.md) | ✅ **CURRENT** — v1.1, refreshed 2026-08-25. The brief's palette and typeface were **wrong**, not merely incomplete — §3 and §4 are corrected to the shipped tokens, and §9 covers the retailer portal. Details below. |
| 6 | **Database schema** | [`database-schema.md`](./database-schema.md) | ✅ **CURRENT** — rewritten 2026-08-25 from `apps/backend/src/db/schema/`. Supersedes `BACKEND-SCHEMA.md`, which predates five of the fifteen schema files. |
| 7 | **Monetisation** | [`docs/business/PRICING.md`](../business/PRICING.md) | ✅ **CURRENT** — 2026-07-01, confirmed against Anchor's real pricing schedule. The most load-bearing document here. |
| 8 | **Launch plan** | [`launch-plan.md`](./launch-plan.md) | ✅ **NEW** — 2026-08-25. Was a genuine gap; `go-live-checklist.md` covers ops readiness only, not sequence, gates or rollback. |
| 9 | **User acquisition** | [`user-acquisition.md`](./user-acquisition.md) | ✅ **NEW** — 2026-08-25, building on [`embedded-distribution-strategy.md`](../business/embedded-distribution-strategy.md). |
| 10 | **Growth plan** | [`growth-plan.md`](./growth-plan.md) | ✅ **NEW** — 2026-08-25. Was a genuine gap. |

## Why several of these live in `docs/business/`

They were written before this index existed, and they are good. Moving them would break every link
that points at them and would gain nothing. **Extend the real document; do not write a second copy.**
Two versions of a PRD drift within a week, and then neither can be trusted — which is precisely the
failure this index exists to prevent.

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

The refresh was scoped as "add a note about the retailer portal". Checking the brief against
`packages/ui/src/theme/tokens.ts` before writing that note found that **v1.0's entire palette and
typeface never shipped**: it specified a green (`#1A6B4A`) and off-white system set in Inter, and
`#1A6B4A` appears **nowhere** in `packages/ui` or either app. What shipped is dark navy and gold in
Georgia + Plus Jakarta Sans. Anyone designing from that brief would have produced work that could
not be built.

The old values are kept in the brief as *superseded* rather than deleted, so a v1.0 mock can be
recognised for what it is.

Auditing the portal's duplicated tokens the same way found a third thing: its `--border` alpha had
been copied as `0.08` against a source of `0.06`. Invisible in review, invisible in a screenshot,
and found only by reading the two files side by side. Fixed. **The lesson generalises — "add a
note" is not a safe scope for a document nobody has diffed against the code.**

## Related operational docs

These are not part of the ten but are where the detail actually lives:

- [`runbook/funds-model.md`](../runbook/funds-model.md) — the limits-only sub-wallet model and money flows
- [`runbook/marketplace-buyer.md`](../runbook/marketplace-buyer.md) — browse filtering, the merchant rule, the category-vs-section distinction
- [`runbook/retailer-onboarding.md`](../runbook/retailer-onboarding.md) — retailer state machine, KYB, the portal
- [`runbook/vas.md`](../runbook/vas.md) — airtime, data, electricity, cable
- [`runbook/go-live-checklist.md`](../runbook/go-live-checklist.md) — pre-production secrets and gates
- [`brainstorm/locked-decisions.md`](../brainstorm/locked-decisions.md) — the numbered decisions the code cites
