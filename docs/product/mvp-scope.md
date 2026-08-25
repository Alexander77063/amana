# Amana — MVP scope

**Date:** 2026-08-25 · **Supersedes** the scope sections of `PDR.md` and `RRD.md` (both 2026-05-13)

The MVP those documents describe **shipped**. This states what is in the product now, what is
deliberately out, and — the useful part — where the cut line moved and why.

## The one-sentence product

A principal funds one wallet; every person who spends from it gets their own limits, category locks
and time windows; payments reach any Nigerian bank account by NIP transfer, and a curated
marketplace turns those same controls outward.

## In scope, and shipped

**The wallet (the original MVP).** Phone-OTP auth for principal and agent; household provisioning
with a real fundable account at Anchor; sub-wallets as spending envelopes, not accounts; a
double-entry ledger in bigint kobo with append-only postings; NIP transfers out with name
resolution before money moves; receipts carrying the NIBSS session ID.

**The control layer.** A rule engine with six kinds — `limit`, `category`, `time_window`,
`allowlist`, `anomaly_threshold`, `merchant` — evaluated on every spend. Over-limit or out-of-rule
spends are **held for the principal**, not refused: the bump flow. Time windows evaluate in
`Africa/Lagos`, not UTC.

**Digital VAS.** Airtime, data, electricity and cable, paid straight to the biller through Anchor's
VAS APIs. Load-bearing for household unit economics (see `PRICING.md` §5) and subject to the same
category locks as any other spend.

**The marketplace.** A curated catalogue of local businesses. Buyers browse only what their rules
already permit, buy a voucher, and show a code at the counter; the retailer is paid on redemption,
not on sale.

**The control fusion.** Approving a merchant **writes a rule** into the same rule set that holds the
limit and the category lock, enforced by the same engine. This is the piece that is hard to copy and
the reason the marketplace is not a bolt-on.

**The supply side.** Retailer onboarding through Anchor Business KYB with an ops-driven state
machine, and a retailer portal (Next.js) for storefront, deals, redemption, orders and earnings.

## Deliberately out

Each of these is a decision, not an omission:

| Not building | Why |
|---|---|
| **Bumping an out-of-rule marketplace purchase** | `bump_pending` comes from the transaction lifecycle, which the purchase path does not enter, and resume has no route back into a catalogue buy. It rejects instead. Spec §8 wants the bump eventually; that needs marketplace wired into the bump workflow. |
| **Goods, inventory, delivery** | Services only. Inventory is a different product with different failure modes. |
| **Funded-campaign deals** | `deal_type` has only `markdown`. Partner-funded budgets are a v2 revenue line. |
| **Sponsored placement** | Would require the §8 guardrails — labelled, never the worst-priced option — before any of it ships. |
| **Multi-staff retailer logins** | One owner per retailer, enforced by a unique index. Roles are a real feature, not a flag. |
| **USSD** | For both feature-phone buyers and retailer redemption. A telco integration, not UI. |
| **Rich analytics** | v1 is counts. |
| **Cross-app tracking for targeting** | Contextual only, from the category lock the parent already set. NDPR-friendly by construction, and a permanent constraint rather than a phase. |

## Where the cut line moved

The May documents drew the line at **the wallet**: fund, delegate, spend, control. Everything else
was "later".

It moved because the control layer turned out to be the asset, not the wallet. Once rules were
enforced on every spend, two things followed almost mechanically:

1. **VAS** — a spend is a spend. Airtime bought outside the rules was a hole, not a feature gap;
   closing it made VAS part of the primitive rather than an adjacent product.
2. **The marketplace** — if the parent already expresses what may be bought, the same expression can
   decide *where*. Approving a merchant became a rule, and distribution became something the control
   layer earns rather than something bolted beside it.

The line now sits at **money leaving the household**. Anything that moves money out is in scope and
must pass the engine. Anything that only moves money in, or only reports, can wait.

## What "done" means for the next slice

There is no separate MVP milestone left to hit — the product is in pre-production. Readiness is now
governed by [`go-live-checklist.md`](../runbook/go-live-checklist.md) and the
[launch plan](./launch-plan.md), not by scope.
