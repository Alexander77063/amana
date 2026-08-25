# Amana — product foundation docs

The ten documents every project must carry, where each one actually lives, and — the part that
matters — **how far each has drifted from the product that exists today**.

A stale document is more dangerous than a missing one: a missing one sends you to the code, a stale
one gets believed. So status here is not decoration. If a row says STALE, treat its contents as
history rather than specification until it is refreshed.

**Reference date for this audit: 2026-08-25.** The MVP requirement docs were written 2026-05-13.
**124 feature commits have landed since**, including the whole marketplace (SP1–SP5b), digital VAS,
retailer onboarding with Anchor Business KYB, and the retailer portal. None of that exists in the
May documents.

## The set

| # | Required | Lives at | Status |
|---|---|---|---|
| 1 | **PRD** | [`docs/business/PDR.md`](../business/PDR.md) | ⚠️ **STALE** — 2026-05-13. Describes the MVP wallet only. No marketplace, VAS, retailers or the control fusion. |
| 2 | **TRD** | [`docs/business/RRD.md`](../business/RRD.md) + [`docs/adr/`](../adr/) | ⚠️ **STALE** — 2026-05-13 for the requirements; the five ADRs still hold. Stack and integrations are current; module inventory is not. |
| 3 | **MVP scope** | [`mvp-scope.md`](./mvp-scope.md) | ✅ **CURRENT** — rewritten 2026-08-25. The MVP shipped; this now states what is in, what is deliberately out, and where the cut line moved. |
| 4 | **User flow** | [`docs/business/APP-FLOW.md`](../business/APP-FLOW.md) | ⚠️ **STALE** — covers principal + agent wallet flows. Missing: buyer marketplace, retailer portal, VAS. |
| 5 | **Design system** | [`packages/ui`](../../packages/ui) (source of truth) + [`UI-UX-DESIGN-BRIEF.md`](../business/UI-UX-DESIGN-BRIEF.md) + [`brand.md`](../brainstorm/brand.md) | ⚠️ **PARTIAL** — tokens and components are real and shipped; the brief predates the retailer portal, which duplicates the tokens in CSS because it cannot import React Native source. |
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

## What refreshing the stale ones involves

Not a rewrite. Each needs the same treatment:

- **PRD** — a section on the marketplace and the control fusion, and on the retailer as a second
  customer with its own surface. The problem statement and the market analysis still hold.
- **TRD** — the current module inventory, the three actor kinds (`principal`, `agent`, `retailer`),
  and the rule engine's six kinds including `merchant`.
- **User flow** — three new flows: buyer browse → buy → voucher; retailer onboard → KYB → redeem →
  earnings; the fusion (parent approves a shop → the agent's catalogue narrows).
- **Design brief** — record that the retailer portal is Next.js and duplicates the tokens, and that
  the duplication is the accepted cost of that platform decision.

## Related operational docs

These are not part of the ten but are where the detail actually lives:

- [`runbook/funds-model.md`](../runbook/funds-model.md) — the limits-only sub-wallet model and money flows
- [`runbook/marketplace-buyer.md`](../runbook/marketplace-buyer.md) — browse filtering, the merchant rule, the category-vs-section distinction
- [`runbook/retailer-onboarding.md`](../runbook/retailer-onboarding.md) — retailer state machine, KYB, the portal
- [`runbook/vas.md`](../runbook/vas.md) — airtime, data, electricity, cable
- [`runbook/go-live-checklist.md`](../runbook/go-live-checklist.md) — pre-production secrets and gates
- [`brainstorm/locked-decisions.md`](../brainstorm/locked-decisions.md) — the numbered decisions the code cites
