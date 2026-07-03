# BaaS Provider Comparison — Anchor vs Alternatives

**Status:** Decision research (deep-research, 2026-07-03)
**Owner:** Alex
**Question:** Should Amana stay on Anchor or switch, optimising cost-first, performance-tiebreaker?
**Method:** Multi-source web research + 3-vote adversarial verification (104 agents, 22 sources
fetched, 90 claims → 25 verified → 21 confirmed / 4 refuted). Cost-first; sub-ledger accounts a
hard gate.

## Recommendation: **STAY with Anchor**

No competitor demonstrated **both** (a) a *proven* API sub-ledger primitive **and** (b) a *published*
price advantage large enough to overcome the one-directional migration cost (adapter rewrite,
re-KYC of existing Tier 2/3 customers, virtual-account re-provisioning, webhook re-wiring). Anchor
natively provides exactly Amana's primitive and its pricing is fully published and competitive; most
competitors' real prices are behind sales gates, so a switch would be a bet on unverified savings.

## Hard gate — who supports the sub-ledger / master-plus-sub-wallet model

| Provider | Sub-ledger? | Evidence / caveat |
|---|---|---|
| **Anchor** (incumbent) | ✅ native | "Sub Accounts under your deposit account, instantly and on-demand," each with its **own virtual NUBAN**, tied to a customer. Free **Book Transfer** master→sub. (Onboarding needs an FBO root configured with Anchor.) |
| **Bloc** | ✅ | Many wallets on one "Main Balance" settlement account; distinguishes real NUBAN VAs from internal-ledger wallets. **Refuted:** each wallet does *not* auto-get its own funding NUBAN (sub-wallets are ledger entries). |
| **Sudo Africa** | ✅ (likely) | Create-Account API has a `wallet` type requiring `customerId`. Full internal-book-transfer topology under one master not fully confirmed from public docs. |
| **Lenco** | ✅ (partial) | "Unlimited sub-accounts," each gets its **own NUBAN**; API exposes accounts + sub-accounts. **But** BaaS/API commercial terms are unpublished (only dashboard-tier pricing). |
| **Fincra** | ❌ refuted | NUBAN collections yes; but the **main-account + sub-account hierarchy claim was REFUTED (0-3)**. Non-viable-without-re-architecting until confirmed. |
| Squad/Providus, Maplerad, Mono | ⚠️ unverified | Sub-ledger primitive not independently verified in surviving claims. |

> **Note on Amana's actual model:** our sub-wallets are **ledger entries in one master wallet**
> (decision #7, limits-only funds model) — we allocate via book transfer, we do **not** need a
> per-sub-wallet funding NUBAN. So Bloc/Sudo's ledger-entry wallets actually fit our design too;
> Anchor's per-sub-account NUBAN is *more* than we require. This doesn't change the recommendation
> (Anchor still wins on published pricing + already-integrated), but it means the viable set is
> genuinely Anchor / Bloc / Sudo / Lenco, not Anchor-only.

## Cost — Anchor is the only fully-published, competitive schedule

A confident per-persona / blended-portfolio cost delta **could not be computed** — most competitor
pricing is sales-gated or unpublished. What's verified:

| Dimension | Anchor (published) | Competitors |
|---|---|---|
| VA create / maintenance / book transfer | ₦0 / ₦0 / **₦0** | Best competitors match ₦0 book transfer; not cheaper |
| Inflow (collections) | 0.5% capped ₦500 | Unpublished for Squad/FW; Fincra headline 1%/₦300 |
| **NIP payout (out)** | **₦50 flat** | Fincra **1%** (dearer than ₦50 above ~₦5,000); Squad/FW **not published** |
| KYC | ₦50 / ₦200 / ₦1,000 | Not comparably published |
| VAS commissions | airtime/data **2%**, electricity **1%**, cable **up to 1.5%** | Flutterwave lists categories but **publishes no %**; others unpublished |

**Directional read:** Anchor's **₦50 flat payout beats Fincra's 1%** on the small outbound spends
that dominate Amana's volume (150–400 spends/mo per SMB/shop), and its ₦0 book transfer matches the
best. So a switch is unlikely to yield a cost win big enough to justify migration risk.

## Refuted claims (adversarial verification caught these)
- Fincra main-account + sub-account hierarchy → **0-3 refuted** (doesn't clearly pass the gate).
- Lenco "free transfers undercut Anchor's ₦50 NIP payout" → **0-3 refuted** (dashboard cashback, not a BaaS payout rate).
- Bloc each wallet auto-gets a dedicated funding NUBAN → **1-2 refuted**.
- Fincra pricing wholly sales-gated → **0-3** (a headline 1%/₦300 does exist on its blog).

## Confidence & caveats
- **High confidence** on capability facts (Anchor/Bloc/Sudo/Fincra from primary API docs).
- **Medium/low** on prices: Fincra 1%/₦300 and Lenco "free" are **marketing pages**, not API fee
  schedules; Squad & Flutterwave payout/commission rates are **behind sales gates**. Any competitor
  cost delta is an estimate, not a verified figure.
- BaaS fees are negotiated at volume — headline ≠ contract.
- NDIC-insurance / CBN-licence-type reliability comparison was **not** resolved by surviving claims (open).

## What would change the answer (next steps if you want certainty)
1. Request **actual contracted quotes** from **Bloc, Sudo, Lenco** (NIP payout, collection %, VAS
   commissions) at Amana's projected volumes, and put them beside Anchor's known numbers.
2. Confirm **NDIC insurance + partner bank / licence type** for any shortlisted provider.
3. Only then quantify the per-persona / portfolio delta and weigh it against migration cost.

## Small reconciliation for PRICING.md
Anchor's **docs** say electricity **1%** and cable **up to 1.5%**; our `PRICING.md` (from Anchor's
emailed note) says electricity 0.5–1% cap ₦1,000, cable 1.2% cap ₦1,500. Minor; our emailed note is
the more specific/contracted figure, but worth a one-line confirm with Anchor.

## Sources (primary)
Anchor sub-account, book-transfer, bill-payment docs; Bloc wallet docs; Sudo create-account;
Fincra virtual-account API + pricing; Lenco developer + pricing; Squad transfer API; Flutterwave
bill-payment docs. (Full list in the research transcript.)
