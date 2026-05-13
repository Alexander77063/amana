# Amana — Business Plan, Case, and Financial Model

**Status:** v1 draft. Authored 2026-05-03.
**Authors:** Alexander Adegbola.
**Scope:** the full commercial picture — strategy, market, GTM, revenue and cost build, unit economics, P&L, ROI, scenarios, SWOT, risks, milestones, funding, exit.
**Currency note:** all figures in NGN unless noted. USD parity assumed at **₦1,600 / $1** (mid-2026 rate). Every USD figure is a divide-by-1,600 of the NGN line.

---

## 1. Executive summary

Amana is a phone-to-phone controlled-spend wallet for Nigeria. A principal (parent or business owner) funds a master wallet and issues sub-wallets to dependents — domestic staff, school-going children, ageing parents, ride-hailing drivers, kitchen staff, foremen — with real-time limits, category locks, time-window rules, and a one-tap "request bump" exception flow. Vendors are paid via standard NIP transfer; vendors never install Amana.

Amana is **the first product purpose-built for delegated, controlled household and small-business spending in Nigeria** — a daily, multi-billion-naira behavioural pattern that is currently solved with cash, debit cards, or unconstrained bank transfers, none of which give the principal control or auditability.

| Metric (Base case) | Year 1 | Year 3 | Year 5 |
|---|---|---|---|
| Paying households | 3,000 | 60,000 | 500,000 |
| Paying SMBs | 200 | 5,000 | 35,000 |
| Annual revenue (NGN) | ₦144 M | ₦3.26 B | ₦28.6 B |
| Annual revenue (USD) | $0.09 M | $2.04 M | $17.9 M |
| EBITDA | (₦1.78 B) | (₦3.74 B) | +₦9.6 B |
| Cumulative cash burn | ₦1.78 B | ₦8.3 B | ₦7.5 B (recovering) |

**Funding plan:** $250K pre-seed → $2M seed → $5M Series A → $10M Series B. Total ≈ **$17.25M** raised over five years, **break-even in Q4 Year 4 / Q1 Year 5**, **investor payback in Year 6–7** at a 5–7× revenue multiple exit (estimated $120–250M valuation at Year 5–6).

**Why this works:** Nigeria's middle-class households and SMBs have a structurally identical spending pattern (principal-funds-agent) that no incumbent has segmented around. Opay, Palmpay, Moniepoint, Kuda all sell the *same wallet to everyone*. Amana sells the *primitive of delegated control* — a deeper product with a moat built on segment ownership, rule-engine sophistication, and brand depth, not on price or rails (we share NIP rails with everyone).

**Why now:** NIBSS NIP penetration crossed ~95% of bank accounts in 2024–25; instant-transfer is now the default consumer payment expectation. NIN enrolment is ~70% adult-population. Anchor and Bloc have matured BaaS into a 4–6 month integration. The infrastructure tax that killed earlier delegated-wallet attempts (paystack-era 2018–2020) is now zero. The behavioural backlog — household financial control without arguing — is unaddressed.

---

## 2. Business case

### 2.1 The problem

Nigerian middle-class principals (parents, spouses, business owners) routinely hand cash or unconstrained bank transfers to dependents and staff for legitimate household and operational spend. The status quo:

| Mechanism | Control | Auditability | Speed | Trust cost |
|---|---|---|---|---|
| Cash | None | Zero | Instant | High (counting, accusations) |
| Debit card | None (PIN ≠ rule) | Statement only | Instant | High (loss, fraud) |
| Bank transfer to staff | None | Sender statement | Instant | High (no category, no limit) |
| WhatsApp + bank app | None | Screenshots | Slow + manual | Very high (he-said-she-said) |
| **Amana** | **Rules** | **Real-time, signed audit log** | **Instant** | **Low (rules don't argue)** |

Every Nigerian middle-class household with a domestic staff member, a school-going child, or an ageing parent has had this conversation: *"What did you do with the ₦15,000 I gave you yesterday?"* It is the single most frequent source of low-grade household friction around money. SMB owners have the same conversation about kitchen staff and dispatch riders.

### 2.2 The solution

A wallet structured around *delegated authority* (Decision #7): one master wallet, N sub-wallets that are ledger entries inside it, real-time rule evaluation per transaction, in-app "bump" for exceptions, principal-controlled visibility and instant suspend.

Three differentiating mechanics:

1. **Phone-to-phone pairing** — NFC tap (Android), QR (cross-platform), SMS deep-link (remote). The mechanic is intentionally physical-feeling. (Decision #6)
2. **Rule engine sophistication** — five evaluator kinds, priority-ordered, all-denials collected, replay-corpus tested. Already shipped at v0.0.3-control. (Sub-plan 3)
3. **Bump exception flow** — the only surviving form of the original "double-handshake" magic, used for over-limit / out-of-rule spends. One-shot consumable token. (Decision #5, Sub-plan 3)

### 2.3 Why incumbents haven't done this

| Incumbent | Why they don't do delegated spend |
|---|---|
| Opay / Palmpay / Moniepoint | Card-and-merchant DNA. Optimising for agent banking volume, not household control. Sub-wallets would cannibalise their own card base. |
| Kuda / FairMoney | Single-user neobank thesis. Multi-user is an org-wide pivot, not a feature. |
| GTBank / Access mobile apps | Locked into a one-customer-one-account regulatory model. Sub-wallet would require a CBN re-papering they have no commercial reason to pursue. |
| Family-bank features (e.g. Sterling Specta, Carbon family) | Treated as a card/savings product, not a spend-control product. No rule engine. No exception flow. |

The market has segments without products and products without segments. Amana is the segment-first play.

### 2.4 Wedge → expansion narrative

```
Households (wedge)            →  SMBs (volume play)        →  B2B disbursement (Year 3+)
─────────────────────────────────────────────────────────────────────────────────────
3K → 500K paying              200 → 35K paying              Adjacent product, not pivoted
Family + Household plans      Business plan (₦10K/mo)      Per-rep allowance APIs
~₦3K ARPU/mo                  ~₦15–18K ARPU/mo             Negotiated B2B contracts
Distribution: schools, HR,    Distribution: industry         Distribution: enterprise
property managers, referral   associations, CAC + sales      sales, partnerships
```

The same software primitive (principal funds, agents spend within rules, principal controls) serves all three without a re-architecture. The brand foundation ("trust before transaction", "the rules you shouldn't have to argue about") reads naturally across all three contexts.

---

## 3. Market analysis

### 3.1 TAM / SAM / SOM (Nigeria)

Top-down, conservative figures, 2026 baseline.

**Total addressable market — paying customers**

| Segment | Definition | Population | Penetration assumption | TAM customers |
|---|---|---|---|---|
| Households | Middle-class HHs with dependents *and* staff or kids on allowance | ~6 M HHs | 100% | 6,000,000 |
| SMBs (delegated-spend) | SMBs with 3+ field/operational staff | ~1.2 M SMBs | 100% | 1,200,000 |
| **Total TAM customers** | | | | **7.2 M** |

**TAM revenue (annual)**

| Segment | Customers | Avg ARPU/mo | Annual TAM revenue (NGN) |
|---|---|---|---|
| Households | 6,000,000 | ₦2,800 | ₦201.6 B |
| SMBs | 1,200,000 | ₦16,000 | ₦230.4 B |
| **Total annual TAM** | | | **₦432 B (~$270M)** |

**SAM (serviceable, 5-year horizon)** — limit to Lagos + Abuja + 5 Tier-2 cities (PH, IB, Kano, Kaduna, Benin), with smartphones and Tier-2 KYC eligibility. Roughly 35% of TAM.

**Annual SAM ≈ ₦151 B (~$94M).**

**SOM (Year 5 base case)** — 500K households + 35K SMBs = ~7.5% of SAM customer count, ₦28.6 B (~$17.9 M) annual revenue. 6.6% of SAM revenue.

**Sanity check:** This is in the same order of magnitude as Carbon (Nigerian fintech) ARR at year 5 (~$15–20M reported pre-2024), and ~1/10 of Opay's processing revenue. Not an outlier.

### 3.2 Demand evidence

- 2024 EFInA Access to Financial Services in Nigeria survey: 64% of banked Nigerian principals report "regularly giving money to staff or family for spending on the household's behalf." Only 8% report any tooling other than cash or transfer.
- 2023 CBN financial-stability report: ~17% YoY growth in NIP volume; instant-transfer is the default. The rail is ready.
- Anecdotal but high-signal: every Lagos middle-class WhatsApp group has a recurring complaint about staff spend control. Verbal demand is universal in target ICP interviews.

### 3.3 Competitive map

| Player | Product | Strength | Why they don't beat us in our segment |
|---|---|---|---|
| **Opay** | Wallet + agent banking | Distribution, brand | No delegated-spend. Card-and-merchant focus. |
| **Palmpay** | Wallet | UX, marketing | Single-user. No rule engine. |
| **Moniepoint** | Agent banking → MMO | Largest agent network | B2B agent-banking, not household control. |
| **Kuda** | Neobank | Brand among young professionals | Single-user. No rule engine. Burning cash. |
| **Carbon** | Lending + wallet | Older brand | Pivoting; no household play. |
| **PiggyVest / Cowrywise** | Savings | Sticky users | Different problem (savings, not spend). |
| **Sterling Specta / Carbon Family** | Family-card features | Bank trust | Card-bolt-on, no rule engine, no bump flow. |
| **WhatsApp + bank app** | Status quo | Free, ubiquitous | Zero control, zero auditability. *Real* competitor. |

The real competitor is **inertia**. The job is to make Amana 10× less friction than the WhatsApp + bank-app workflow for a principal who already has the muscle memory.

### 3.4 SWOT

**Strengths**
- Deep product (rule engine, bump flow, anomaly scoring, audit) — already shipped at v0.0.3-control.
- Segment-first thesis (no incumbent is segmented around delegated spend).
- Pan-Nigerian brand (*Amana* — Hausa, Arabic-rooted, "trust, safekeeping").
- Modern monorepo, type-system parity backend↔mobile, swappable BaaS adapter.
- Founder operating in-segment (lived experience of the problem).

**Weaknesses**
- BaaS dependency (Anchor primary, Bloc redundancy plumbed but unproven).
- No CBN MMO licence at MVP — Tier-2 cap of ₦300K constrains principal balance.
- Distribution is unproven; school/HR/property-manager partnerships are theoretical.
- Brand new — no name recognition outside our own circle yet.
- Single-region (af-south, Cape Town) hosting until CBN data-residency review closes.

**Opportunities**
- Underserved 7M+ customer segment with no incumbent play.
- B2B disbursement adjacency at Year 3+ (per-rep allowance APIs).
- Insurance / lending overlay on principal-funded sub-wallet behavioural data (Year 4+).
- Cross-border remittance-to-controlled-wallet (UK/US diaspora funding household sub-wallets) — natural extension at Year 3.
- White-label to banks who can't or won't build it (Year 4+).

**Threats**
- Incumbent fast-follow (Opay or Moniepoint launches a "family wallet" feature).
- CBN policy shift (Tier-2 cap reduction; sub-wallet re-papering required).
- BaaS partner outage / commercial dispute / shutdown (mitigation: Bloc redundancy plumbed, but switch-cost is real).
- NGN devaluation (USD-denominated infra and tooling costs increase faster than NGN ARPU).
- Fraud / AML incident in first 24 months erodes brand permanently.
- Smartphone penetration plateau in Tier-2 cities below assumed 35%.

---

## 4. Product and operating model (summary — full spec lives in `docs/superpowers/specs/2026-05-03-amana-design.md`)

| Dimension | Choice (locked) |
|---|---|
| Wallet structure | Delegated authority — one master wallet, sub-wallets as ledger entries |
| Spend rail | NIP at MVP; card v1.5; cash-in v2 (only if unbanked-principal wedge opens) |
| Vendor capture | NQR + smart recents at MVP; Amana Receive sticker (NFC) at v1.1 |
| KYC | Principal Tier-2 (BVN+NIN, ₦300K cap); Agent NIN-only |
| BaaS | Anchor primary; Bloc redundancy; Sudo for cards (v1.5) |
| Licensing | Hybrid — BaaS at MVP, own CBN MMO licence Year 3+ |
| Tech stack | TS + Hono + Drizzle + Postgres + RN/Expo, monorepo, AWS af-south |
| Hosting | AWS af-south (Cape Town) at MVP; Lagos DC option held in reserve |

The control plane (rule engine, bump, anomaly, audit) is already shipped and tested at v0.0.3-control. Sub-plans 4–8 ship vendor capture, lifecycle, mobile apps, and pre-launch hardening before public launch.

---

## 5. Stages and roadmap

### Stage 0 — Bootstrap (DONE — pre-seed equivalent, founder-funded)

| Milestone | Status |
|---|---|
| Brainstorm + 18 locked decisions | ✅ Done |
| Design spec | ✅ Done |
| Phase 0 monorepo bootstrap | ✅ v0.0.1-bootstrap |
| Identity + Wallet Ledger + BaaS Adapter | ✅ v0.0.2-core |
| Rule Engine + Bump + Anomaly + Audit | ✅ v0.0.3-control |
| Cumulative spend | ~₦4 M (founder time, infra, tooling) |

### Stage 1 — MVP build (Months 1–6, $250K pre-seed)

| Milestone | Owner | Output |
|---|---|---|
| Sub-plan 4 (vendor capture + lifecycle + NIP-out) | 1 senior backend | v0.0.4 |
| Sub-plan 5 (notifications + reconciliation) | 1 senior backend | v0.0.5 |
| Sub-plan 6 (Principal mobile app) | 2 RN engineers | v0.0.6 |
| Sub-plan 7 (Agent mobile app) | (parallel, same team) | v0.0.7 |
| Sub-plan 8 (chaos suite, replay corpus, pen-test) | 1 senior + ext. pen-test | v0.0.8 |
| Anchor production go-live + CBN sandbox approval | Founder + legal | Live integration |
| Brand ID, app store submissions, marketing site | 1 designer + 1 PM | Launch-ready |

**Headcount end of Stage 1:** 8 full-time (founder + 5 eng + 1 designer + 1 ops/legal/PM).
**Cumulative spend end of Stage 1:** ~₦240 M (~$150K).
**Exit criteria:** 209→500+ tests passing, 50 closed-beta households complete a 30-day cycle without an integrity incident, NPS > 50 in beta cohort.

### Stage 2 — Soft launch (Months 7–12, $2M seed)

| Milestone | Output |
|---|---|
| Public launch (Lagos-first, paid) | 3,000 paying households + 200 SMBs |
| 3 distribution partnerships closed (1 school chain, 1 property manager, 1 HR-payroll vendor) | First non-paid acquisition channels |
| Customer support: 2 agents, 8am-10pm cover | Tier-1 support live |
| First reconciliation incident handled cleanly | Operational credibility |
| Sub-plan 9 (post-MVP): Amana Receive stickers (vendor sign-up rail + fulfilment) | v1.1 |

**Headcount end of Stage 2:** 22 (8 → 22, adding 6 eng, 4 ops/support, 2 GTM, 2 finance/compliance).
**Cumulative spend end of Stage 2:** ~₦2.6 B (~$1.6 M).
**Exit criteria:** Monthly active paying customers > 3,000. Monthly NIP volume through Amana > ₦1.5 B. Gross margin > 65%.

### Stage 3 — Scale (Months 13–24, $5M Series A)

| Milestone | Output |
|---|---|
| Geographic expansion: Lagos + Abuja + Port Harcourt + Ibadan | 15K paying HHs + 1K SMBs |
| Card issuance via Sudo (v1.5) | Optional card top-up + agent debit card |
| Cross-border funding (UK + US diaspora → household sub-wallet) | Diaspora wedge opens |
| Anchor → multi-BaaS active-active (Bloc as second rail) | BaaS dependency reduced |
| Begin CBN MMO licence application | 18-month process initiated |

**Headcount end of Stage 3:** 55. **Cumulative spend:** ~₦8.4 B (~$5.25 M).
**Exit criteria:** Monthly NIP volume > ₦20 B. Net revenue retention > 110%. Series B-ready unit economics (LTV/CAC > 4).

### Stage 4 — Series B + own license (Months 25–48, $10M Series B)

| Milestone | Output |
|---|---|
| CBN MMO licence granted | Own balance-sheet wallet; ₦300K cap removed |
| B2B disbursement product launched | Per-rep allowance APIs to enterprise clients |
| Operational profitability achieved | Q4 Year 4 / Q1 Year 5 |
| Geographic: 7-city footprint | 200K paying HHs + 15K SMBs by end of Year 4 |

**Headcount end of Stage 4:** 110. **Cumulative spend:** ~₦16 B (~$10 M). **Recovering toward break-even.**

### Stage 5 — Profitable scale (Year 5+, no further dilution required)

| Milestone | Output |
|---|---|
| Full-year EBITDA positive | +₦9.6 B / +$6 M EBITDA in Year 5 |
| 500K paying HHs + 35K SMBs | ~7.5% of SAM customer count |
| Insurance / lending overlay on sub-wallet behavioural data | Adjacent revenue line |
| Strategic optionality: IPO, acquisition, or independent compounder | See §10 |

---

## 6. Revenue model

Five revenue lines, in order of contribution.

### 6.1 Subscription (primary — 75–80% of revenue)

| Plan | Price/month | Agents | Bundled NIP throughput | Target segment |
|---|---|---|---|---|
| Free | ₦0 | 1 | ₦20K/month | Acquisition tier |
| Family | ₦1,500 | 3 | ₦100K/month | Households (1–2 dependents) |
| Household | ₦4,000 | 10 | ₦400K/month | Households (staff + kids) |
| Business | ₦10,000 | 50 | ₦2M/month | SMBs |

### 6.2 Outbound NIP fees (15–20% of revenue)

₦25 per outbound NIP, charged on every transaction beyond the bundled throughput. Wholesale cost via Anchor: ~₦20–22 per NIP at scale (volume-tiered).
**Margin: ~₦3–5 per NIP.** Not a fat margin line — but at scale (millions of NIPs/month) it adds up.

### 6.3 Float income (3–5% of revenue, growing)

Master wallets at Anchor at MVP earn ~3–5% pa wholesale (Anchor passes a portion of treasury yield through). Once we hold our own MMO licence (Year 3+), float income improves to 8–12% pa on idle balances. **At ₦10 B average float (Year 5), float income ≈ ₦800 M – ₦1.2 B / year.**

### 6.4 Card interchange (Year 1.5+, ~5% of revenue)

Sudo card issuance at v1.5. Interchange ~0.5–1% of card volume (CBN-capped). Not a primary line; ships to round out the product, not as a P&L driver.

### 6.5 Adjacent products (Year 3+)

- **Insurance** — gadget / health micro-policies issued against principal+agent pair. Underwritten by partner; we earn 15–20% commission.
- **Lending** — small-ticket consumer credit to principals based on sub-wallet behavioural score. Capital from partner; we earn origination fee + spread share.
- **B2B disbursement** — per-rep allowance APIs sold to enterprise clients. Negotiated. Can become 20–30% of revenue by Year 5+ if priortised.

### 6.6 Revenue forecast — base case

Assumes paid-conversion of 10–12% of free-tier downloads, ARPU growth as users adopt higher tiers, NIP throughput grows 1.4× per year per active.

| Year | Paid HHs | Paid SMBs | HH ARPU/mo | SMB ARPU/mo | Subscription | NIP fees | Float | Cards | Total revenue |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 3,000 | 200 | ₦2,800 | ₦14,000 | ₦134 M | ₦8 M | ₦2 M | — | **₦144 M** |
| 2 | 15,000 | 1,000 | ₦3,000 | ₦15,000 | ₦720 M | ₦80 M | ₦15 M | ₦5 M | **₦820 M** |
| 3 | 60,000 | 5,000 | ₦3,200 | ₦16,000 | ₦3.27 B | ₦480 M | ₦150 M | ₦60 M | **₦3.96 B** |
| 4 | 200,000 | 15,000 | ₦3,400 | ₦17,000 | ₦11.22 B | ₦1.6 B | ₦600 M | ₦220 M | **₦13.64 B** |
| 5 | 500,000 | 35,000 | ₦3,500 | ₦18,000 | ₦28.56 B | ₦4.0 B | ₦1.0 B | ₦450 M | **₦34.0 B** |

USD parity (÷1,600): Y1 $0.09M, Y2 $0.51M, Y3 $2.48M, Y4 $8.5M, Y5 **$21.3 M**.

---

## 7. Cost structure

### 7.1 Fixed costs (per year)

| Category | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Engineering team (TS/RN/SRE) | ₦720 M (8 FTE) | ₦1.62 B (18 FTE) | ₦2.7 B (30 FTE) | ₦4.05 B (45 FTE) | ₦5.4 B (60 FTE) |
| GTM / sales / partnerships | ₦150 M | ₦450 M | ₦1.0 B | ₦1.8 B | ₦2.4 B |
| Customer support + ops | ₦80 M | ₦300 M | ₦750 M | ₦1.5 B | ₦2.4 B |
| Compliance / legal / licence | ₦100 M | ₦200 M | ₦450 M (CBN appl.) | ₦300 M | ₦250 M |
| Finance / G&A | ₦120 M | ₦240 M | ₦480 M | ₦750 M | ₦1.0 B |
| Office / utilities | ₦40 M | ₦100 M | ₦200 M | ₦350 M | ₦500 M |
| **Total fixed OpEx** | **₦1.21 B** | **₦2.91 B** | **₦5.58 B** | **₦8.75 B** | **₦11.95 B** |

Engineering rates: senior NG ₦750K-1.2M/mo (~$470–750), TL ₦1.5–2M/mo, mid ₦400–600K/mo. Costs include 20% loaded (NHF, pension, equipment).

### 7.2 Variable costs (per year)

| Category | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Hosting (AWS af-south) | ₦9.6 M ($6K) | ₦57 M ($35K) | ₦200 M ($125K) | ₦600 M ($375K) | ₦1.4 B ($875K) |
| BaaS pass-through (NIP cost − fee) | ₦0 (NIP fee covers) | ₦0 | ₦0 | ₦0 | ₦0 |
| KYC verification (BVN+NIN lookups) | ₦15 M | ₦80 M | ₦320 M | ₦1.0 B | ₦2.5 B |
| Push notifications + SMS | ₦8 M | ₦40 M | ₦150 M | ₦500 M | ₦1.2 B |
| Sentry / Datadog / observability | ₦12 M | ₦40 M | ₦100 M | ₦250 M | ₦450 M |
| Fraud + chargebacks reserve (1% of NIP) | ₦20 M | ₦80 M | ₦300 M | ₦1.0 B | ₦2.5 B |
| Sticker fulfilment (v1.1+, vendor-side) | — | ₦20 M | ₦100 M | ₦300 M | ₦600 M |
| **Total variable** | **₦64.6 M** | **₦317 M** | **₦1.17 B** | **₦3.65 B** | **₦8.65 B** |

### 7.3 Customer acquisition

Blended CAC target: ₦4,500 per paid household, ₦18,000 per paid SMB.

| Year | Paid HHs added | HH CAC | Paid SMBs added | SMB CAC | Total CAC spend |
|---|---|---|---|---|---|
| 1 | 3,000 | ₦5,500 | 200 | ₦20,000 | ₦20.5 M |
| 2 | 12,000 | ₦5,000 | 800 | ₦19,000 | ₦75.2 M |
| 3 | 45,000 | ₦4,500 | 4,000 | ₦18,000 | ₦274.5 M |
| 4 | 140,000 | ₦4,200 | 10,000 | ₦17,500 | ₦763 M |
| 5 | 300,000 | ₦4,000 | 20,000 | ₦17,000 | ₦1.54 B |

CAC declines as referral and partnership channels mature. Year 1 CAC is high because we're paying for Lagos digital + brand-credibility press.

### 7.4 Total cost of operation

| Year | Fixed OpEx | Variable | CAC | **Total cost** |
|---|---|---|---|---|
| 1 | ₦1.21 B | ₦64.6 M | ₦20.5 M | **₦1.30 B** |
| 2 | ₦2.91 B | ₦317 M | ₦75.2 M | **₦3.30 B** |
| 3 | ₦5.58 B | ₦1.17 B | ₦274 M | **₦7.02 B** |
| 4 | ₦8.75 B | ₦3.65 B | ₦763 M | **₦13.16 B** |
| 5 | ₦11.95 B | ₦8.65 B | ₦1.54 B | **₦22.14 B** |

USD: Y1 $0.81M, Y2 $2.06M, Y3 $4.39M, Y4 $8.23M, Y5 **$13.84M**.

---

## 8. P&L and cash flow (base case)

### 8.1 Five-year P&L

| Line (₦) | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Revenue | 144 M | 820 M | 3.96 B | 13.64 B | **34.0 B** |
| Cost of revenue (variable + CAC) | (85 M) | (392 M) | (1.44 B) | (4.41 B) | (10.19 B) |
| **Gross profit** | **59 M** | **428 M** | **2.52 B** | **9.23 B** | **23.81 B** |
| Gross margin | 41% | 52% | 64% | 68% | 70% |
| Fixed OpEx | (1.21 B) | (2.91 B) | (5.58 B) | (8.75 B) | (11.95 B) |
| **EBITDA** | **(1.15 B)** | **(2.48 B)** | **(3.06 B)** | **+0.48 B** | **+11.86 B** |
| EBITDA margin | (799%) | (303%) | (77%) | +3.5% | +34.9% |

USD EBITDA: Y1 ($720K), Y2 ($1.55M), Y3 ($1.91M), Y4 +$300K, Y5 **+$7.4M**.

### 8.2 Cumulative cash needs

| Period | Cash burn | Cumulative | Funding round | Cumulative funding |
|---|---|---|---|---|
| Stage 0 (pre-existing) | ₦4 M | ₦4 M | Founder | ₦4 M |
| Stage 1 (MVP build, M1–6) | ₦240 M | ₦244 M | Pre-seed $250K | ₦400 M |
| Stage 2 (soft launch, M7–12) | ₦1.06 B | ₦1.30 B | Seed $2 M | ₦3.6 B |
| Stage 3 (Y2–Y3 scale) | ₦5.54 B | ₦6.84 B | Series A $5 M | ₦11.6 B |
| Stage 4 (Y4 expansion) | ₦680 M (CAC + license) | ₦7.52 B | Series B $10 M | ₦27.6 B |
| Stage 5 (Y5+) | recovering | ₦5.66 B (cumulative profit catching up) | — | ₦27.6 B |

**Total external capital required: ~$17.25 M.** Cash bottom (max negative cumulative position) reached at end of Year 3 / mid-Year 4 at ~₦7.5 B (~$4.7 M). Series B capital provides the runway through to break-even.

### 8.3 Bull and bear cases

**Bull case** (1.8× base on customer count, 1.1× on ARPU):

| Year | Revenue | EBITDA |
|---|---|---|
| 1 | ₦230 M | (₦1.05 B) |
| 3 | ₦7.0 B | (₦1.5 B) |
| 5 | ₦67 B (~$42M) | +₦27 B (~$17M) |

Break-even Q1 Year 4. Reduces total funding to $12 M.

**Bear case** (0.3× base on customer count, ARPU flat):

| Year | Revenue | EBITDA |
|---|---|---|
| 1 | ₦42 M | (₦1.22 B) |
| 3 | ₦1.1 B | (₦5.0 B) |
| 5 | ₦4.7 B (~$3M) | (₦5.5 B) |

No break-even within 5 years. Requires either (a) consolidation/acquihire, (b) pivot to enterprise B2B, or (c) additional dilution. Triggers in §11.

---

## 9. Unit economics and ROI

### 9.1 Unit economics (Year 3 steady state)

| Metric | Household | SMB |
|---|---|---|
| ARPU/month | ₦3,200 | ₦16,000 |
| Gross-margin contribution/month (64%) | ₦2,048 | ₦10,240 |
| CAC | ₦4,500 | ₦18,000 |
| **Payback period** | **2.2 months** | **1.8 months** |
| Average customer life (assumed) | 36 months | 48 months |
| **LTV** | ₦73,728 | ₦491,520 |
| **LTV / CAC** | **16.4×** | **27.3×** |

These are strong unit economics. The risk is not the unit math; it is whether CAC actually lands at ₦4,500 (vs. ₦9,000+ if digital-only and Opay-style brand-spend competition forces us to overpay).

### 9.2 Investor return — ROI scenarios

Assumptions:
- $17.25M raised across 4 rounds (avg ~16% dilution per round, founder retains ~35–40% by Series B close).
- Exit Year 6 or 7.
- Comparable Nigerian fintech exits: Carbon (acquired/restructured), Paystack ($200M+ to Stripe at ~13× revenue), Flutterwave (mark $3B at ~30× revenue at peak).

**Base case exit (Year 6, 5× revenue multiple)**:
- Year 6 revenue ≈ ₦55 B = $34.4 M
- Exit valuation ≈ $172 M
- Investor share (post-dilution) ≈ 60% = $103 M
- Total invested $17.25 M → **6.0× cash-on-cash ROI**, IRR ~31% over 6 years.

**Bull case exit (Year 5, 7× revenue)**:
- Year 5 revenue $21.3 M → exit $149 M
- Investor share (less dilution because less capital needed) ≈ 50% = $74 M
- Invested $12 M → **6.2× cash-on-cash**, IRR ~44% over 5 years.

**Bear case (Year 5–6 acquihire / down-round)**:
- Exit at ~1× revenue or less, $3–5 M
- Investor share ≈ 70% = $2.5–3.5 M
- Invested $17.25 M → **0.15–0.20× cash-on-cash**, IRR negative.
- Founder dilution near-total.

### 9.3 Founder payback period

At $250K pre-seed self-funded equivalent of founder time-cost foregone (12 months × ~$20K/month equivalent salary forgone), founder payback is via:
- (a) salary post-Series A ($60–80K USD comparable),
- (b) equity vest realised at exit (Year 6 base ≈ $40–50M founder share at 30% post-dilution).

**Founder ROI horizon: 6 years to material exit; salary-positive from Series A close (Month 18).**

---

## 10. Strategic options and exit

Three credible exit / scale paths by Year 6:

1. **IPO on NGX or dual-listing** — feasible at $50M+ ARR and EBITDA-positive. Nigerian capital markets are thin but improving; NGX has accepted tech listings post-Interswitch.
2. **Strategic acquisition** by a Nigerian bank, telco, or pan-African fintech (likely candidates: Access, GT, Standard Bank, MTN, M-KOPA, Flutterwave). Banks pay for distribution; telcos pay for customer base; pan-African fintechs pay for product depth.
3. **Independent compounder** — stay private, dividend out, expand into adjacent markets (Ghana, Kenya, Egypt) with the same primitive. Requires founder appetite and growth-equity capital.

Founder default: option 3 with optionality to take 1 or 2 if a credible acquirer makes a clean offer at $200M+.

---

## 11. Worst-case scenarios and triggers

### 11.1 Scenario matrix

| # | Scenario | Probability | Impact | Detection trigger | Mitigation |
|---|---|---|---|---|---|
| 1 | BaaS partner (Anchor) outage > 24h | Medium | High | Status page + own monitoring | Bloc redundancy plumbed at adapter layer (Decision #11). Active-active by Y3. |
| 2 | Anchor commercial dispute / shutdown | Low | Critical | Contract termination notice or bankruptcy | Bloc plumbed; switching cost ~6–8 weeks engineering. |
| 3 | CBN Tier-2 cap reduction (₦300K → ₦100K) | Low | High | CBN circular | Accelerate own MMO licence. Communicate to principals; offer split-pot workaround. |
| 4 | CBN bans delegated multi-user wallets | Very low | Critical | CBN circular | Pivot to "card-as-rule" model on Sudo cards. Painful but possible. |
| 5 | Opay / Moniepoint launches "family wallet" | Medium-high | Medium | Press / app store monitoring | Out-execute on segment depth; brand depth (Amana ≠ Opay-branded feature); product depth (rule engine sophistication). |
| 6 | NGN devaluation > 50% in 12 months | Medium | High | FX market | USD-cost lines (AWS, Sentry, etc.) dominated; pre-pay 12 months of infra in stable USD; pass through to Business plan. Family/Household plan less elastic — absorb. |
| 7 | Major fraud incident (₦50M+ loss to social engineering) | Medium | High | Anomaly + reconciliation | Insurance reserve (1% of NIP volume); rapid principal communication; PR plan. |
| 8 | AML / NFIU subpoena handled badly | Low | Critical | Regulator letter | Audit log already actor-hashed-but-resolvable (Decision #15). Drill in Year 1. |
| 9 | Smartphone penetration plateau in Tier-2 | Medium | Medium | Census / OS market share | USSD fallback for Agent app (Year 3+). |
| 10 | Adoption fails — Lagos middle class doesn't shift from cash | Medium | Critical | < 30% of beta cohort retains M2 | Pivot to SMB-first GTM (skip household wedge). Architecture supports it. |
| 11 | Key engineer departure pre-Series A | Medium | Medium | Resignation | Partner with engineering services firm (Andela, Decagon) for redundancy. |
| 12 | NIBSS NIP fee hike > 50% | Low | High | NIBSS circular | Pass-through to outbound NIP fee (₦25 → ₦40). Margin compression but not existential. |

### 11.2 Existential trigger thresholds (for board / founder)

| Metric | 12-month trigger | Action |
|---|---|---|
| MAU paid | < 1,500 by M9 (vs. base 2,000) | Aggressive pivot to SMB-first, suspend household acquisition spend. |
| LTV/CAC | < 2.5× by M12 | Halt growth spend; dial in retention before scaling. |
| Gross margin | < 35% by M12 | Re-price NIP fees; renegotiate Anchor; consider card-first. |
| Fraud loss | > 2% of NIP volume in any month | Suspend bump auto-approve; full investigation; possible feature freeze. |
| Engineering velocity | < 2 sub-plans/quarter | Restructure team; outside engineering review. |
| Founder runway | < 9 months at current burn | Bridge round or down-round before Series A; start exit conversations at month 12. |

---

## 12. Funding plan and dilution

| Round | Stage | Size | Valuation (post) | Founder dilution | Investor type |
|---|---|---|---|---|---|
| Pre-seed | Stage 1 (MVP build) | $250K | $2M post | -12.5% | Angels, founder network, possibly Future Africa / LocalGlobe scout |
| Seed | Stage 2 (soft launch) | $2M | $10M post | -20% | Pan-African seed (Ventures Platform, LocalGlobe, Backstage Capital) |
| Series A | Stage 3 (scale) | $5M | $30M post | -16.7% | TLcom, Partech, Norrsken, Quona, Visa Africa Fintech Accelerator alumni-network |
| Series B | Stage 4 (own license + B2B) | $10M | $80M post | -12.5% | Growth-stage Africa or US (Tiger, Endeavor Catalyst, Helios) |
| **Total** | | **$17.25M** | | **~58% retained by founder pre-employee-pool, ~38% post-pool** | |

Employee pool: 12% set aside at Series A, expanded to 18% at Series B. Standard.

---

## 13. Team and hiring plan

| Role | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Founder/CEO | 1 | 1 | 1 | 1 | 1 |
| CTO | 1 (M3) | 1 | 1 | 1 | 1 |
| Senior backend (TS/Hono) | 2 | 4 | 7 | 10 | 14 |
| Mobile (RN/Expo) | 2 | 4 | 6 | 8 | 12 |
| SRE / platform | 0 | 1 | 3 | 5 | 8 |
| QA / security | 1 (consultant) | 1 | 2 | 4 | 6 |
| Product / design | 2 | 4 | 6 | 8 | 10 |
| GTM / growth | 1 | 4 | 8 | 12 | 16 |
| Customer support | 0 | 4 | 10 | 20 | 30 |
| Compliance / legal | 0 (ext) | 1 | 2 | 3 | 4 |
| Finance / G&A | 1 | 2 | 4 | 6 | 8 |
| **Total FTE** | **11** | **26** | **50** | **78** | **110** |

Hiring is the gating constraint at Y2–Y3. Lagos engineering market is competitive — budget for 20% above market for senior TS/RN.

---

## 14. Key open items (action list out of this document)

| Item | Owner | Deadline | Notes |
|---|---|---|---|
| IP / domain search for "Amana" | Founder + counsel | Pre-Sub-plan 6 (mobile build) | Confirm before any branded asset goes to print. |
| Anchor production agreement (commercial terms) | Founder | Pre-Stage 2 | Negotiate volume-tier NIP cost ≤ ₦20 by Y2. |
| 10–15 user-validation interviews (brand + UX) | Founder + designer | Pre-Stage 1 close | Validate Amana name + positioning lines. |
| CBN MMO licence pre-application engagement | Compliance counsel | Year 2 Q3 | 18-month process; start before Stage 4. |
| Insurance (cyber + fidelity bond + D&O) | Finance lead (hired Y2) | Pre-public launch | Required by Anchor partnership terms. |
| AWS af-south CBN data-residency review | External counsel + CBN engagement | Pre-public launch | Reversible to Layer3 / MainOne if CBN insists. |
| Fraud reserve policy + accounting treatment | CFO (hired Y2) | Pre-Series A close | 1% of NIP volume on-book reserve. |
| Distribution partnership pipeline (3 named partners) | Founder + GTM lead | Stage 2 | School chain + property manager + HR-payroll vendor confirmed before public launch. |

---

## 15. Closing argument

Amana is positioned to do for delegated household and SMB spending what Stripe did for online payments and what M-Pesa did for unbanked transfer: own a primitive nobody else is segmented around, deliver a product an order of magnitude better than the workaround it replaces, and let the segment compound for years before incumbents notice.

The technical risk is small (rails are commodity, control plane already shipped at v0.0.3-control). The behavioural-adoption risk is real but bounded by a wedge that is provably daily and provably painful. The financial profile is unit-economics-strong and capital-efficient: $17M raised, break-even by end of Year 4, $20M+ ARR by Year 5, IRR 30%+ in the base case and 40%+ in the bull case.

The ocean here is worth boiling. Ship Sub-plans 4–8, close Stage 1 funding, get to public launch in the next 12 months.

---

*End of document. Next deliverables: pitch deck (Stage 1 fundraising), financial model spreadsheet (live), risk register (live), and OKRs Q1–Q2 of Stage 1.*
