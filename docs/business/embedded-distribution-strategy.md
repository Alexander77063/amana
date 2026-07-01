# Amana — Embedded Distribution Strategy

**Status:** Direction agreed (brainstorm 2026-07-01); pre-implementation
**Date:** 2026-07-01
**Owner:** Alex
**Related:** `PRICING.md` (core spend-fee model), `anchor-pricing-note-2026-06-30.md` §3 (VAS commissions)

## The idea in one line

Use Amana as a **trusted, contextual distribution channel** — earning partner revenue by
connecting users to genuinely useful services — **not** an ad-supported app. Embedded
distribution, not display banners.

## Why (and the honest caveat)

Amana already earns commission on airtime/data/bills (VAS) via Anchor. That same surface can carry
more services and partner-funded offers, opening a second revenue line beyond the ₦100 spend fee.

**But distribution is a *scale* lever, not a launch lever.** Every model below scales with
**audience size**, not fee cleverness. At the launch cohort (~1,100 accounts) the entire
distribution line is a rounding error next to the core spend-fee profit (~₦24.4M/yr, `PRICING.md`).
It becomes a real pillar at 10×/100× (commission alone could reach ₦50M+/yr at 100×). **Decision:
build the rails now, monetise the promotional layer as the audience grows — do not let distribution
distract from the core spend-fee engine pre-scale.**

## Framing: distribution, not advertising

The line we hold: in a **deal**, a partner spends money to give the **user** something (real
value); in **paid placement**, a partner spends money to change **what Amana shows** (advertising).
We lean hard toward the former. Amana's entire brand is *control and trust over money* — cluttering
it with ads that push consumption (especially to agents spending controlled funds) would be
self-defeating.

## The wedge: expand VAS

Start where we already have rails and commission: extend the existing airtime/data/electricity/TV
catalog into more paid services — **transport, education/school fees, subscriptions, gift cards,
government payments**. Same Anchor VAS integration, no new compliance, proves the model fast.
VAS purchases are simply **controlled spends** (category-locked, limited), so this fits the product
rather than fighting it.

## Revenue model — three layers, not three choices

| Layer | What it is | On screen | Who pays | Decision |
|---|---|---|---|---|
| **1. Commission (base)** | Aggregator spread on each purchase (2% airtime/data today) | Neutral catalog, all options equal | Nobody extra | **Build.** The base. |
| **2. Partner-funded deals** | Partner funds a discount/cashback/bonus | Offer badged on a biller ("10% bonus data this week") | The **partner** (marketing budget) — user gets more value | **Build up to this.** The sweet spot: user value + partner budgets, brand-safe. |
| **3. Paid placement** | Partner pays to be the default/featured option | "Featured"/pre-selected slot | The **partner** pays Amana | **Deferred.** Only with scale + guardrails (labelled sponsored, never worst-priced). |

## Guardrails (non-negotiable)

- **Agents get the catalog; principals get the offers.** Agents may *use* VAS within their
  category-locks and limits (utility, on-brand). Promotions/deals are **principal-facing or
  principal-approved** — never proactively upsold to an agent (pushing consumption of someone
  else's money is brand-corrosive).
- **Any sponsored placement is clearly labelled and never the worst-priced option** for the user.
- **Targeting is contextual, not surveillance** — use the category-lock signal Amana already owns
  (a "transport" sub-wallet is a known, consented intent), not cross-app tracking. NDPR-friendly by
  construction.

## The moat beyond VAS (where this is really going)

VAS is the safe wedge, but it is **not** the differentiator — every wallet does VAS. Amana's unique
distribution asset is the **controlled-spend context**: category-locks reveal intent, and there is
a trusted **principal** relationship. The long-term prize is **contextual, principal-facing
distribution**:

- **Curated vendor marketplace** — turn vendors/stickers/recents into a vetted directory where
  category-locked sub-wallets surface relevant, approved merchants + deals.
- **Embedded financial products** — distribute partners' insurance, savings, school-fee financing
  to principals for referral commission (needs NAICOM/CBN-regulated partners; heaviest compliance).

These are **future layers**, sequenced after the VAS wedge proves the model and the audience grows.

## Rails this builds on (already in the codebase)

- **VAS/Anchor bill payment** — existing commission integration (extend it).
- **Rules engine `category` kind** — category-locked sub-wallets = the targeting signal.
- **Vendors / stickers / recents** (`modules/vendors`, `modules/sticker`) — seed of a curated
  merchant directory.
- **Notifications** (`modules/notifications`) — delivery channel for principal-facing offers.

## Sequencing

1. **Now (rails):** expand the VAS catalog (commission base). Low-risk, extends existing integration.
2. **Next (partner revenue):** add the partner-funded **deals** layer, principal-facing.
3. **At scale:** consider paid placement (guard-railed); build the curated marketplace.
4. **Later / heaviest:** embedded regulated financial products.

## Non-goals / deferred

- Display/programmatic banner ads — rejected outright (brand-corrosive).
- Paid placement — deferred until scale + guardrails.
- Promoting anything to agents beyond the passive catalog.
- Cross-app / surveillance-based targeting.

## Open questions

1. Which VAS categories to launch first (transport vs education vs gift cards) — sequence by
   demand + aggregator availability via Anchor.
2. Do we mark up the user on expanded VAS, or pass Anchor's commission as our only take?
   (Default: no user markup — keep it appealing; take the commission.)
3. Deal mechanics — does the partner-funded discount settle through Anchor VAS, or a separate
   promo-credit flow? (Integration question for the build spec.)
4. NDPR review scope for any contextual targeting before deals go live.

## Next step

When ready to build, the **VAS-expansion wedge** gets its own implementation spec + plan (schema
for a services catalog, the deals layer, principal/agent surfacing per the guardrails). This
document is the strategy of record; it is not itself an implementation plan.
