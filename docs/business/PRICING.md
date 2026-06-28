# Amana — Pricing & Monetisation Decision

**Status:** Proposed (pending two confirmations — see Open Items)
**Date:** 2026-06-28
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
- **Top-ups and internal master→sub-wallet allocation: free to the user.**
- **VTU / bills** (airtime, data, electricity) is a **secondary** revenue line via aggregator
  commission — load-bearing for household economics.
- **Float** (interest on idle balances) is treated as **upside, not foundation** — and may not
  be available to us (see Open Items).

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
| Stamp duty (CBN) on a transfer > ₦10,000 | **₦50** |
| KYC onboarding | Tier 2 ₦50 · Tier 3 ₦200 · Business ₦1,000 |

**Key facts that drive everything:**
1. The **₦50 NIP per spend** is ~80% of our cost and scales linearly with usage.
2. The **control layer is free** — sub-wallets are ledger entries in one master wallet
   (decision #7), so allocating and enforcing limits are book transfers (₦0). We only pay when
   money actually leaves to a vendor.
3. The **₦500 inflow cap** means large, infrequent top-ups are cheaper per naira than many
   small ones.

---

## 3. Unit economics

### Cost per user / month
| Persona | Spends/mo | NIP | + inflow + stamp | **Total cost** |
|---|---|---|---|---|
| Household | 20 | ₦1,000 | +₦250 | **₦1,250** |
| SMB (owner + ~5 staff) | 150 | ₦7,500 | +₦2,500 | **₦10,000** |
| Shop (heavy owner) | 400 | ₦20,000 | +₦10,000 | **₦30,000** |

### Net margin per user / month (VTU on @3%, float off)
| Persona | ₦80 | ₦90 | ₦100 | ₦120 |
|---|---|---|---|---|
| Household (5 free, lifetime) | — | — | **~₦1,230** | — |
| Household (10 free/mo) | ₦30 | ₦130 | ₦230 | ₦430 |
| SMB | ₦4,100 | ₦5,600 | ₦7,100 | ₦10,100 |
| Shop | ₦5,000 | ₦9,000 | ₦13,000 | ₦21,000 |

**Break-even per spend (after VTU credit):** Household ₦77 · SMB ₦53 · Shop ₦68 →
**₦80 is the hard floor** at which every persona is profitable.

### Portfolio — 1,000 Household + 80 SMB + 20 Shop, per month
| Fee | Monthly | Annual |
|---|---|---|
| ₦80 | ₦458k | ₦5.5M |
| ₦90 | ₦758k | ₦9.1M |
| **₦100** | **₦1.06M** | **₦12.7M** |
| ₦120 | ₦1.66M | ₦19.9M |

≈ **+₦3.6M/yr per ₦10** on the fee (near-linear).

---

## 4. The fee: why ₦100

- **Floor + margin:** ₦50 covers the NIP cost; the other ₦50 prices the control/audit layer
  that is the product. Below ₦77, households run at a loss.
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

**Cost of a *monthly* free tier (per 1,000 households):**
| Monthly free spends | Household margin | Subsidy given away |
|---|---|---|
| 0 | ₦1,230/mo | — |
| 3 | ₦930/mo | ₦3.6M/yr |
| 5 | ₦730/mo | ₦6.0M/yr |
| 10 | ₦230/mo | **₦12.0M/yr** |

10 free/month is a permanent **50% discount** (households do ~20 spends/mo) that donates the
entire consumer segment's profit. Activation only needs 2–3 successful payments.

**Decision:** **first 5 spends free *lifetime* (one-time onboarding), then ₦100.** ~₦250 one-time
cost/household; households profit from month 2. *Alternative if ongoing goodwill is wanted: 3
free/month (₦3.6M/yr subsidy).*

---

## 6. Strategic takeaways

- **Small businesses are the P&L; households are the funnel.** At ₦100, ~**78% of profit comes
  from the ~9% of accounts that are businesses** (SMB + Shop). GTM should hunt shops and SMBs;
  households are cheap, viral, VTU-subsidised reach.
- **VTU is load-bearing for household economics** — the ~₦480/mo VTU credit is what keeps
  households healthy. Securing a good airtime/data/bills aggregator deal matters.
- **Float is upside, not foundation** — even at 8% p.a. it's ~₦53/mo on a household's small
  balance. It only matters at large accumulated AUM.
- **Nudge larger, less-frequent top-ups** — the ₦500 inflow cap rewards it (~₦1,250/mo saved at
  SMB volume).

---

## 7. Open items (confirm before launch)

1. **Float / interest on balances** — confirm *in writing* with Anchor whether Amana may earn
   yield on held customer balances (NDIC-insured deposit accounts suggest it accrues to the
   partner bank). This is the swing factor for how generous any free tier can be.
2. **VTU / bills commission** — not in the Anchor money-movement schedule; secure a separate
   aggregator deal and confirm the net margin (assumed 3% here).
3. **Revisit at scale** — re-run this model with real funding/spend distributions once there is
   live data; the persona parameters below are estimates.

---

## Appendix — model assumptions

| Persona | Funds/mo | Loads/mo | Spends/mo | Spends >₦10k | VTU throughput/mo | Avg balance |
|---|---|---|---|---|---|---|
| Household | ₦40,000 | 4 | 20 | 1 | ₦16,000 | ₦8,000 |
| SMB | ₦350,000 | 12 | 150 | 15 | ₦70,000 | ₦60,000 |
| Shop | ₦1,000,000 | 20 | 400 | 100 | ₦100,000 | ₦150,000 |

VTU net margin assumed **3%**; float assumed **0** (pending confirmation). All figures
illustrative — see Open Item 3.
