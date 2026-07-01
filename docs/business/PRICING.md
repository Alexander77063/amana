# Amana — Pricing & Monetisation Decision

**Status:** Confirmed against Anchor's pricing schedule (2026-06-30); EMTL & inflow-cap
treatment settled (2026-07-01) — see §7
**Date:** 2026-06-28 (revised 2026-06-30, 2026-07-01)
**Owner:** Alex
**Supersedes:** the implicit subscription assumption in earlier planning docs

---

## 1. Decision summary

Amana monetises the **external spend** — the one event that costs us money — not the
subscription, not the top-up.

- **Per-spend fee: ₦100** on every vendor payout (NIP out). Covers Anchor's ₦50 NIP cost + a
  ₦50 margin for the control layer. Optionally **segment-differentiated**: households ₦80,
  businesses ₦100.
- **Free onboarding grant:** first **5 spends free, lifetime** (not monthly), then ₦100.
- **Top-ups and internal master→sub-wallet allocation: free to the user** — Amana absorbs
  Anchor's 0.5% inflow fee, **capped at ₦6,000 per wallet per month** (pure whale insurance:
  set above a heavy shop's ₦5,000 gross inflow, so it is **invisible to every modeled persona**
  and only bites funders above ~₦1.2M/mo — see §3, §7 #5).
- **EMTL (the ₦50 FIRS levy on transfers over ₦10,000): a user pass-through, not our cost** — on
  a spend over ₦10k we add ₦50 on top of the platform fee and remit it; it never touches our
  margin (see §2).
- **VTU / bills** (airtime, data, electricity, cable TV) is a **secondary** revenue line via
  **Anchor's own VAS APIs** (no separate aggregator needed) — load-bearing for household
  economics. Confirmed commissions: airtime/data **2%**, electricity 0.5–1% (cap ₦1,000), cable
  TV 1.2% (cap ₦1,500).
- **Float** (interest on idle balances) is treated as **upside, not foundation** — Anchor has
  **confirmed it is not part of the standard offering** (case-by-case only), so it cannot be
  banked on at launch (see §7).

We do **not** charge a subscription (Nigerian recurring-debit rails are weak and the prepaid,
pay-per-use mental model dominates) and we do **not** charge per top-up (we already pay Anchor
0.5% on inflow, and the ₦500 cap rewards larger loads — a top-up fee discourages the one
behaviour we most want).

---

## 2. Anchor cost structure (the constraint)

From Anchor's pricing schedule:

| Action | Anchor charges Amana |
|---|---|
| Account / virtual account creation, maintenance, statements | **₦0** |
| **Top-up** — inflow via virtual NUBAN | **0.5%, capped ₦500** per load |
| **Internal allocation** — master → sub-wallet (book transfer) | **₦0** |
| **Spend** — pay a vendor (NIP out) | **₦50 flat** |
| EMTL (FIRS e-money transfer levy) on a transfer over ₦10,000 — *user pass-through, not Amana margin* | **₦50** |
| KYC onboarding | Tier 2 ₦50 · Tier 3 ₦200 · Business ₦1,000 |

**Confirmed by Anchor (2026-06-30), now locked in:** name enquiry / account resolution is
**free**; **failed transfers are not charged** (only successful NIP transfers cost ₦50);
**no monthly platform fee** on the BaaS product (the $500/mo platform fee applies only to the
separate USD-card product — irrelevant unless Amana issues cards); **no reserved or minimum
balance** requirement. Volume-tier NIP discounts are available after ~120 days of live volume
(commercial review) — not assumed in this model.

> **The ₦50 EMTL — treatment DECIDED (2026-07-01): user pass-through, not an Amana cost.**
> Anchor's note (`anchor-pricing-note-2026-06-30.md`) calls it a "₦50 stamp duty ... on transfers
> over ₦10,000"; correctly it is the FIRS **Electronic Money Transfer Levy** (EMTL, Finance Act
> 2020) — a statutory levy remitted to FIRS, not an Anchor margin. **Decision:** Amana treats
> EMTL as a **pass-through add-on charged to the end user on a spend over ₦10,000** — we collect
> the ₦50 from the wallet on that spend and remit it; it is **added on top of**, never netted out
> of, our ₦100 platform fee (of which ₦50 is Anchor's NIP and ₦50 is Amana's margin). On the
> **inbound** side, EMTL on a top-up over ₦10k is collected by Anchor from the **account holder**
> directly — also not Amana's cost. **Net effect: EMTL leaves Amana's cost model entirely** (the
> "+stamp" line is out of the §3 cost tables, which are re-cut accordingly). *Operational confirm
> still open with
> Anchor (Open Item #4):* on an outbound >₦10k transfer, does Anchor **auto-deduct** the ₦50, or
> must Amana collect + remit it? **Implementation note:** a >₦10k spend must debit the wallet
> spend + ₦100 fee + ₦50 EMTL — the transactions module reserves **all three** against the
> sub-wallet balance/limit.

**Key facts that drive everything:**
1. The **₦50 NIP per spend** is ~80% of our cost and scales linearly with usage.
2. The **control layer is free** — sub-wallets are ledger entries in one master wallet
   (decision #7), so allocating and enforcing limits are book transfers (₦0). We only pay when
   money actually leaves to a vendor.
3. The **₦500 inflow cap** means large, infrequent top-ups are cheaper per naira than many
   small ones.

---

## 3. Unit economics

> **Re-cut 2026-07-01** — the driver of these numbers is **EMTL becoming a user pass-through**,
> out of Amana cost (Shop −₦5,000/mo, SMB −₦750/mo, Household −₦50/mo). The inflow-absorption cap
> (**₦6,000/wallet/mo**) is deliberately set as pure tail insurance — it is **invisible to all
> three modeled personas** (even a heavy shop's gross inflow is ₦5,000), so it does not move the
> tables. EMTL removal alone drops the binding break-even from ₦70 to **₦58** and lifts ₦100
> portfolio profit from ₦21.9M to **₦24.4M/yr**.

### Cost per user / month (Amana cost; EMTL excluded, inflow absorbed in full below the ₦6k/mo cap)
| Persona | Spends/mo | NIP | + inflow | **Total cost** |
|---|---|---|---|---|
| Household | 20 | ₦1,000 | +₦200 | **₦1,200** |
| SMB (owner + ~5 staff) | 150 | ₦7,500 | +₦1,750 | **₦9,250** |
| Shop (heavy owner) | 400 | ₦20,000 | +₦5,000 *(under the ₦6k cap)* | **₦25,000** |

### Net margin per user / month (VTU @2%, float off, EMTL passed through, inflow capped)
| Persona | ₦80 | ₦90 | ₦100 | ₦120 |
|---|---|---|---|---|
| Household (5 free, lifetime — *the decision*) | ₦720 | ₦920 | **₦1,120** | ₦1,520 |
| Household (10 free/mo) | −₦80 | ₦20 | ₦120 | ₦320 |
| SMB | ₦4,150 | ₦5,650 | ₦7,150 | ₦10,150 |
| Shop | ₦9,000 | ₦13,000 | ₦17,000 | ₦25,000 |

Figures are steady-state (the lifetime free grant is exhausted by month 2). Removing EMTL from
cost adds ₦50/mo (Household), ₦750/mo (SMB) and ₦5,000/mo (Shop) versus the prior revision; the
₦6,000/mo inflow cap is invisible to all three personas (each funds under ₦1.2M/mo), so it does
not appear in these numbers — it only protects against abnormally heavy funders.

**Break-even per spend (after VTU credit), on the decided 5-free-lifetime model:**
Household ₦44 · SMB ₦52 · **Shop ₦58** → **₦80 remains the hard floor**, now with **~₦22 of
cushion** (was ₦10). Shop is still the binding persona, but EMTL removal widened the gap. Note: a
*10-free/month* tier would push Household break-even to **₦88** — above ₦80 — an independent,
fresh reason the monthly free tier was rejected in §5.

### Portfolio — 1,000 Household + 80 SMB + 20 Shop, per month (VTU @2%)

**Decided model (5 free lifetime, steady state):**
| Fee | Monthly | Annual |
|---|---|---|
| ₦80 | ₦1.23M | ₦14.8M |
| ₦90 | ₦1.63M | ₦19.6M |
| **₦100** | **₦2.03M** | **₦24.4M** |
| ₦120 | ₦2.83M | ₦34.0M |

**Conservative floor (10 free/month — the prior revision's basis, kept for comparison):**
| Fee | Monthly | Annual |
|---|---|---|
| ₦80 | ₦432k | ₦5.2M |
| ₦90 | ₦732k | ₦8.8M |
| **₦100** | **₦1.03M** | **₦12.4M** |
| ₦120 | ₦1.59M | ₦19.1M |

**Slope differs by basis** (it is set by *billable* spend volume): **+₦4.8M/yr per ₦10** on the
decided 5-free-lifetime model (households bill all ~20 spends), **+₦3.6M/yr per ₦10** on the
conservative 10-free/month basis (households bill only ~10). At ₦100 the decided model yields
**₦24.4M/yr** (was ₦21.9M before EMTL removal); the conservative floor is **₦12.4M/yr**.

### Funding-fee models considered (2026-07-01)

Whether to keep absorbing Anchor's 0.5% inflow fee in full was tested against two alternatives:

| Model | User pays to fund | Profit @₦100 | Verdict |
|---|---|---|---|
| **A. Absorb 100% (chosen)** | ₦0 — top-ups free | ₦24.4M/yr | **Chosen.** Free funding is the headline appeal; every naira loaded lands. Whale exposure is bounded by the ₦6k/mo cap (Open Item #5). |
| B. Split 50/50 | 0.25% of every load (HH ₦100 · SMB ₦875 · Shop ₦2,500/mo) | ₦27.0M/yr | Rejected. Charges a funding fee where competitors (Opay/PalmPay/Moniepoint) are free, and breaks the "every naira is yours" clarity central to a controlled-spend wallet — for +₦2.6M/yr. |
| C. Hybrid: free up to ₦2k gross/mo, split above | Only heavy shops (~₦1,500/mo) | ₦24.7M/yr | Rejected. +₦0.3M/yr over A isn't worth an asterisk on "free." |

**Decision:** keep top-ups free (A), and make the absorption **visible** as a benefit rather than
leaving it silent — the **Fee Cover** feature surfaces the lifetime bank fees Amana has covered per
principal ("₦X in bank fees covered"), turning a cost we already bear into a selling point. Spec:
`docs/superpowers/specs/2026-07-01-fee-cover-design.md`.

---

## 4. The fee: why ₦100

- **Floor + margin:** ₦50 covers the NIP cost; the other ₦50 prices the control/audit layer
  that is the product. With EMTL passed through, the binding break-even is **₦58** (the Shop
  persona) — ₦100 clears every persona with ~₦42 of headroom.
- **Market-acceptable:** ₦100 is a normal Nigerian transfer / POS-withdrawal fee. Framed
  honestly ("covers the bank transfer + service"), it doesn't read as gouging.
- **Competitive reality:** generic wallets (Opay, PalmPay, Moniepoint) undercut on transfer
  fees because they subsidise via float / lending. Amana is **not** a generic wallet — the fee
  buys *controlled, audited* spend. We cannot race them to ₦0 without a float/credit engine, and
  we should not try.
- **Segment option:** households ₦80 (competitive, acquisition) + businesses ₦100 (ROI obvious,
  won't churn on ₦20) captures a competitive consumer price *and* full business margin.

---

## 5. The free tier: onboarding grant, not monthly allowance

Each free spend is **hard cash** (₦50 to Anchor), so a free tier is genuinely expensive here —
unlike digital freemium.

**Cost of a *monthly* free tier (per 1,000 households, VTU @2%):**
| Monthly free spends | Household margin | Subsidy given away |
|---|---|---|
| 0 | ₦1,120/mo | — |
| 3 | ₦820/mo | ₦3.6M/yr |
| 5 | ₦620/mo | ₦6.0M/yr |
| 10 | ₦120/mo | **₦12.0M/yr** |

10 free/month is a permanent **50% discount** (households do ~20 spends/mo) that donates the
entire consumer segment's profit. Activation only needs 2–3 successful payments.

**Decision:** **first 5 spends free *lifetime* (one-time onboarding), then ₦100.** ~₦250 one-time
cost/household; households profit from month 2. *Alternative if ongoing goodwill is wanted: 3
free/month (₦3.6M/yr subsidy).*

---

## 6. Strategic takeaways

- **Businesses win per account; households are now a real P&L line, not just a funnel.** At ₦100
  each SMB nets **₦7,150/mo** and each Shop **₦17,000/mo** — 6× and 15× a household's ₦1,120 — so
  GTM still hunts shops and SMBs for margin density. But because the book is ~91% households, the
  *portfolio* split is **~55% household / 45% business** (Shop alone 17%). *(Corrects an earlier
  "~78% from businesses" figure that didn't reconcile with the model tables — the real prior split
  was ~59/41; EMTL removal lifted Shop margin ~42% and nudged businesses to 45%.)*
- **VTU is load-bearing for household economics** — the ~₦320/mo VTU credit (airtime/data at
  Anchor's confirmed 2%) is what keeps household margin healthy. Anchor serves VAS directly, so
  **no separate aggregator is needed**; the rate is confirmed, not assumed. (The 3%→2% haircut was
  the biggest change in the 2026-06-30 revision; EMTL removal + the inflow cap headline 2026-07-01.)
- **Float is upside, not foundation** — even at 8% p.a. it's ~₦53/mo on a household's small
  balance. It only matters at large accumulated AUM.
- **Nudge larger, less-frequent top-ups** — Anchor's ₦500 per-load cap rewards it (~₦1,250/mo
  saved at SMB volume by consolidating 12 loads into 1); it also keeps heavy funders under our
  ₦2,000/mo absorption cap, so fewer users ever see the inflow pass-through.

---

## 7. Open items (confirm before launch)

1. ~~**Float / interest on balances**~~ — **RESOLVED (2026-06-30):** Anchor confirmed yield-sharing
   is **not part of the standard offering** — case-by-case only (judged on average float balance,
   duration held, transaction volume, partnership scope). Treat float as **₦0 at launch**; pursue
   a bespoke arrangement only once AUM is material. *Still worth a written, specific ask* once
   balances are real — it remains the swing factor for free-tier generosity.
2. ~~**VTU / bills commission**~~ — **RESOLVED (2026-06-30):** Anchor serves VAS **directly via
   API** — no separate aggregator needed. Confirmed: airtime/data **2%**, electricity 0.5–1%
   (cap ₦1,000), cable TV 1.2% (cap ₦1,500). Model updated to **2%** (was an assumed 3%); treat
   2% as a *ceiling*, since electricity/TV are lower and capped.
3. **Revisit at scale** — re-run this model with real funding/spend distributions once there is
   live data; the persona parameters below are estimates.
4. ~~**EMTL treatment**~~ — **DECIDED (2026-07-01):** pass-through add-on to the end user on
   spends over ₦10k; **not an Amana cost** (out of §3). *Operational confirm still open:* whether
   Anchor **auto-deducts** the ₦50 on an outbound >₦10k transfer or expects Amana to collect +
   remit — folded into `anchor-float-yield-request.md`. Inbound EMTL is Anchor-collected from the
   account holder. Non-blocking (mechanics only, not P&L).
5. ~~**Inflow-absorption cap**~~ — **DECIDED (2026-07-01):** **monthly per-wallet ceiling of
   ₦6,000** on the Anchor 0.5% inflow fee Amana absorbs; excess passes to the wallet. A monthly
   per-wallet cap (not a per-load fee) is the only instrument that bounds *total* per-wallet
   exposure — a per-load cap misses high-frequency sub-threshold funders. Set at **₦6,000**
   (above a heavy shop's ₦5,000 gross monthly inflow) it is **pure tail insurance: invisible to
   all three modeled personas**, so §1's "no top-up fee" promise holds for every normal user and
   only funders above ~₦1.2M/mo ever pay. *(A tighter ₦2,000 cap was considered for cost-recovery
   — it would claw ~₦3,000/mo from each Shop and lift ₦100 portfolio profit ₦24.4M→₦25.1M/yr, but
   it taxes the priority-acquisition persona and breaks §1, so it was rejected.)* *Implementation:*
   track absorbed inflow fees per wallet per calendar month; once ≥ ₦6,000, add the incremental
   0.5% to the top-up debit.

---

## Appendix — model assumptions

| Persona | Funds/mo | Loads/mo | Spends/mo | Spends >₦10k | VTU throughput/mo | Avg balance |
|---|---|---|---|---|---|---|
| Household | ₦40,000 | 4 | 20 | 1 | ₦16,000 | ₦8,000 |
| SMB | ₦350,000 | 12 | 150 | 15 | ₦70,000 | ₦60,000 |
| Shop | ₦1,000,000 | 20 | 400 | 100 | ₦100,000 | ₦150,000 |

VTU net margin **2%** (Anchor-confirmed: airtime/data 2%; electricity 0.5–1% and cable TV 1.2%
are lower and capped, so 2% is a ceiling); float **0** (Anchor-confirmed: not standard); EMTL
**removed from Amana cost** (decided pass-through to the end user, Open Item #4) — the "Spends
>₦10k" column now only sizes the user-borne levy, not our P&L; inflow fee absorbed by Amana up to
**₦6,000/wallet/mo** (Open Item #5 — invisible to all three personas here). All figures
illustrative — see Open Items 3–5.
