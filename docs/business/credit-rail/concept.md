# Amana — consumer-side credit rail *(concept, not a build plan)*

> **Status: STRATEGY, NOT MODEL.** Nothing here is priced, quoted or validated with a counterparty.
> This document exists so a credit-shaped product idea is written down against the same constraints
> the wallet already operates inside, before anyone builds toward the wrong one. Reading
> [`PRICING.md` §8](../PRICING.md#8-operational-by-products--adjacent-revenue-added-2026-08-27)
> and [`lender-discovery-brief.md`](../lender-discovery-brief.md) before this is non-optional — the
> constraints there apply directly and are not repeated in full below.

---

## The ask in one line

**20% of a principal's monthly spend, offered as a short-tenor line after ≈6 months of wallet use,
escalating on more KYC to a 3–6 month installment option on demand**, with interest, repayments
debited by rule against the same wallet.

This is the **consumer-side mirror** of §8 by-product #1 (which already conceived the merchant-side
one: paid cash-flow graph → lender introduction). The product shape looks similar; the consent,
regulation and capital realities are different. That is what the rest of this document is about.

---

## Why this is harder than it looks

### 1.1 The regulatory floor is not "more identity verification"

The principals in scope are not an open user base; they are Amana's existing wallet customers. NDPA
2023 already constrains what we may collect for them, and our `docs/legal/principal-terms/2026-08-27.v1.md`
is the **contract we already sell them on**. Adding "and by the way, this lets us underwrite you"
requires a new lawful basis — currently the principal accepts our terms on sign-up (PR #72 made
this acceptance captured properly); expanding the basis to underwriting is a *new* acceptance,
separately recorded.

Three domains, in order of friction:

| Domain | What Amana has today | What credit adds |
|---|---|---|
| **NDPA 2023** | Principal terms accepted at signup; explicit privacy notice for child agents (NDPA-aware) | New consent step *specifically* for credit underwriting; recorded acceptance with version; revocable; **the kind of consent the merchant claim flow does NOT capture** (see §8.5 of `PRICING.md`) — must not repeat that mistake |
| **CBN** | Wallet licences (wallet-as-custodian; payment service bank limits depending on structure) | **Line of credit on Amana's own balance sheet requires a lending licence** (e.g. finance company, or an MFI licence) — these are CBN-mandated, not discretionary, and granting them is months-long |
| **BVN/NIN/CIB** | Already used for KYC at principal signup, with limit rules, with audit trail | Identity verification tier *acceptable for credit underwriting* is materially higher than *acceptable for a wallet*; means work-status + address verification + bank-statement verification beyond what exists |

**Bottom line:** if the product is "Amana issues credit on its own balance sheet", the cost is a
licence change plus a KYC-up step. That is a regulatory+legal workstream measured in months, not a
quarter.

### 1.2 A "6-month spend rule" alone is not an underwriting model

A deterministic rule "credit = 20% × sum(spend over 6 months)" is not underwriting; it is a *formula
applied to a behavioural signal*. It will:

- Say **yes to anyone who has been spending steadily** — even when their spending pattern is exactly
  the shape that predicts default ("regular small outflows through one retail category", i.e. an
  overdraft pattern).
- Say **no to thin-file good actors** who happen to have not used the wallet frequently in those 6
  months.
- Be **trivially gamed** by a user who wants a line — move the wallet they get direct debits through.

What an underwriting partner would actually want, in addition to the 6-month spend trace, is:

- An **affordability score** (Plaid/TrueLayer/GoCardless-style open-banking, or its Nigerian
  equivalents: Mono, Stitch, Okra)
- A **soft-bureau pull** (CIB Credit Bureau Nigeria, with the user's consent)
- A **KYC tier above what the wallet uses today** — work history, address verification, a verified
  bank account beyond NIBSS

**Amana has none of these.** The wallet's KYC is real (BVN/NIN at signup), but it is *wallet-grade*
KYC; it is not credit-grade KYC. The difference is not paperwork; it is "we have to inspect your
ability to repay from sources we cannot see from inside Amana."

### 1.3 The ledger has to be redone, quietly

Amana's money model is **frozen money** (principal pre-funds → sub-wallet holds limits → merchant
receives). The ledger, postings, reversal flow, anomaly checks, audit log, *reconciliation*
(`modules/transactions/reconciliation.service.ts:48` — counts a transfer Anchor has no record of as
`unknown` and skips it forever) are all designed around the **principal pre-funded the spend**.

Credit is the inverse: customer owes → system pays. That changes:

- Every posting needs a **third party** (the *credit facility*) sitting between Amana and the
  merchant's credit allowance
- Every "outflow" has a parallel "advance + interest accrual + repayment schedule"
- Reversal is no longer "refund the customer" — it is "settle the advance"
- Anomaly has to distinguish **spending from the wallet** (existing) from **drawing on the credit
  line** (new — needs its own detectors)
- Reconciliation cannot **skip unknowns** for ever — a missed repayment is not a write-off, it is a
  chase

That is not a feature. It is a second ledger system inside the same product. The cost is real and
months-long, even before the regulatory workstream.

---

## Two shapes, on a regulatory axis

### Shape A — Balance-sheet credit (Amana issues)

Amana issues the line. Repayments go to Amana. Interest accrues on Amana's books. Amana's revenue
model on this product is the float × margin × duration.

**Cost to ship:** regulatory licence (~12-18 months with a partner legal firm in Lagos, CBN
application, KYC tier changes, separate capital adequacy), a credit-grade KYC pipeline, a parallel
ledger system, an underwriting decision engine, collections. **Verdict:** the wrong tool for the
size of Amana today. Build it once the wallet has the volume to underwrite the team that underwrites
it.

### Shape B — Referral-to-lender (Amana introduces)

Amana **does not issue credit**. The product is: principal in good standing on the wallet sees "you
qualify for an advance from one of our partners — interested?" **with their permission**, and the
principal is introduced to a licensed lender (Carbon, FairMoney, a partner MFI, or one of the
Nigerian digital banks now offering credit) whose underwriting decision happens at the partner. The
principal accepts the lender's T&Cs and Schedule to a repayment path. Amana takes an **origination
fee per funded advance** — much like the existing revenue model, with the addition of an upsell fee
when the advance is taken.

**What this requires:**

- A **credit surface inside the wallet** that shows: your available line, the lender's terms if you
  take it, the fee Amana earns if you take it, what your existing limits do to the line, etc. — most
  of which is **metadata**, not money
- **Partner contracts** with the shortlist below
- **Eligibility surface** in the wallet: "we think you'd qualify — would you like us to introduce
  you?" with a one-click consent capture (recorded, versioned, revocable, separate from the wallet
  T&Cs)
- The partner then runs the actual underwriting

**What this does NOT require:** a lending licence, a parallel ledger, a collections function.

**Costs Amana does incur in shape B:**

- A new consent capture on the principal surface (the §8.5 lesson, applied early)
- A new API surface for partner↔wallet hand-off (an introduction; the partner screens the customer;
  Amana does not see the credit decision)
- A way to **reconcile the wallet's existing limits with a credit line** so the principal does not
  accidentally overdraw their household funding

**Verdict:** this is the right shape for Amana at the size it is. It is a credit product *to the
user* without Amana issuing credit *on its books*. That distinction matters for the regulator,
matters for the marketing claim (Amana is not "doing credit", Amana is "introducing users to a
licensed lender and earning a fee for it"), and matters for the ledger.

---

## What shape B looks like in practice (concrete sketch)

### The user journey

1. **T+0: wallet in normal use.** Principal has spent for ≥6 months. Their `households.spend_30d`
   is logged, `sub_wallets.history` is clean (no anomaly events). They have **never** seen a credit
   offer.
2. **T+6m: an eligibility check runs server-side.** A nightly job, off the wallet's hot path,
   reads: tenure (months since `users.created_at`), `households.monthly_spend_avg` for the last
   6 months, anomaly history (last 90 days), limits history (no uncapped sub-wallet in the last 30
   days), wallet KYC completeness. It writes a `credit_eligibility` row per principal whose surface
   crosses a threshold. **Eligibility does NOT touch any partner**, and is not visible to the
   principal — yet.
3. **T+6m+ε: a feature flag turns the eligibility row into a UI affordance** — "you may qualify for
   a short-tenor advance — see your offer". Tap it once and the principal sees: an *Amana
   translation* of what "credit from a licensed lender" means, what the partner's name is, what the
   fee Amana earns, **a separate T&Cs acceptance** that explicitly mentions underwriting.
4. **Consent.** One tap records the consent. Schema: `users.credit_consent`, with a version, a
   timestamp, a partner name, and the clickwrap text rendered.
5. **Hand-off.** The wallet calls the partner's referral endpoint with a token the partner can
   verify against. The partner screens the principal at its end, returns a verdict (no, yes at X
   rate, yes at Y rate, needs more info) and a repayment schedule. The wallet displays it; the
   principal confirms; the partner disburses to Amana's wallet (so the principal can spend it
   *through the wallet*, which preserves the existing rule engine) or directly to the principal's
   bank (which is the lender's choice).
6. **Repayment** is debited by rule from the wallet if the lender dispenses to the wallet, or by
   standing instruction on the principal's bank if not. Either way, Amana sees it as a regular
   spend-like event and the existing anomaly engine treats it normally.
7. **Renewal.** New advances become available after a cooling period and a fraction of repayments
   received; the eligibility check has a "do not over-overlap" rule so the principal never has two
   active advances from two partners at once.

### Why a new consent cannot use the existing principal terms

The principal's existing terms say "you accept Amana's wallet T&Cs and privacy notice". They do
not, and *cannot*, constitute consent to be shared with a third-party underwriter. Reusing them is
the same §8.5 mistake that the merchant claim flow makes today.

**Capture shape (mirrors PR #72's terms-version discipline):**

- The consent text is a single source of truth in `@amana/types` — `CREDIT_INTRO_CONSENT_VERSION`,
  `requiredCreditConsentVersion(partnerName)`
- The server enforces it: every credit-introduction screen MUST send the version the app
  displayed. Same shape as `acceptedTermsVersion`
- On acceptance, a row in `users.credit_consent` records `version`, `partner_id`, `accepted_at`,
  `app_rendered_copy` (a hash of the text the app actually showed). Same "version the app
  DISPLAYED" lesson from PR #72

### Existing Amana data this product *can* use

- **`tenure`** — verified by `users.created_at`. Pure on-platform.
- **`household monthly spend`** — already aggregated in the wallet's analytics.
- **`anomaly events`** — already captured. Quiet accounts want quiet customers.
- **`rule compliance history`** — already captured. A principal who has run afoul of no rule is
  meaningfully different from one who lives at the bump-approval edge.
- **`category lock coverage`** — what % of spend goes through locked categories. Voluntary
  discipline is a soft positive signal.

### Existing Amana data this product *cannot* use

- **The underlying spend categories**, in any form. Selling or sharing the principal's category
  detail with a third party is exactly the §8.4 ruled-out case — *"Household-level spend data, in
  any form, aggregated or not... Parents hand Amana their children's spending on the promise that
  it is controlled, not observed by strangers."* — and a credit referral would qualify as
  observance. Use aggregates only.
- **Identity verification beyond what the wallet does.** Adding biometric, work-history or
  bank-statement collection is an addition to the consent surface and a KYC upgrade. Out of scope
  for shape B as drafted.

---

## Surface, in the wallet

If the team says yes, the surface is one new screen and one new affordance. Nothing heroic.

| Where | What | Why not a built-in sub-wallet? |
|---|---|---|
| Principal home screen, below the "rules" card | A **conditional** "Credit offer" card. Conditional = never shown unless the eligibility job wrote a row AND the feature flag is on. | Sub-wallet would imply Amana is funding the advance, which is shape A's regulatory posture. Saying "Amana offers the line" is wrong on shape B; saying "you may qualify with one of our partners" is honest. |
| On tap | The **partner disclosure** (Amana referral, partner name, partner rate card, fee schedule, repayment options), the **separate consent capture**, then a hand-off to the partner. | Without a separate consent capture this whole feature is NDPA-shaped risk; with it, it's a normal product surface. |
| Wallet rules, post-advance | A new rule: "**repay this advance from this sub-wallet**", with a default to the principal's master wallet, configurable to any locked sub-wallet. | Repayment coming out of a *locked* sub-wallet is what the rule engine was built for. |

The whole point of putting the credit surface *inside* Amana's existing rule engine is that the
moment the principal is overdrawn, the same `bump_requests` and `notifications` flows they already
know will fire — and the principal learns one vocabulary, not two.

---

## Partner shortlist (for shape B)

Not yet contacted. Written down so the next conversation has a target.

| Candidate | What they do | Why plausible | Hard question |
|---|---|---|---|
| **Carbon** (formerly Paylater) | Personal and small-business loans via mobile, Nigeria + Kenya + US | Operate in Nigeria, known to offer short-tenor; have an existing API for partners | What is the **referral pricing** they pay us per funded advance, and does it survive Carbon's own KYC turning some introductions down? |
| **FairMoney** | Salary advance + small-business, microcredit | Largest partner in the space, well-publicised API | "We bring 60 months of clean wallet behaviour + a paid principal" — does that change the rate band? |
| **Renmoney** | MFI-shaped, longer-tail | Possibly fits the "6-month installment at a higher limit" use-case the prompt names | Speed of their API integration; whether MFI audit tolerates referral from a wallet |
| **Partner bank deposit product** (e.g. one of the digital banks now offering "credit in your app") | Differentiates by using the same reconciliation rails they already use for our wallet top-up | Cheapest integration path if we already process same-bank NIP credits | The bank is a credit-risking counterparty and may need their own NDPR-level diligence of us |

This list is **not a recommendation** — it's the obvious targets. Carbon and FairMoney are the two
worth a first call. Renmoney and a partner bank are reserve.

---

## What is NOT in scope of this memo

1. **A pricing model.** Fees per advance, take-rates, break-even advance size, rate bands. There is
   no partner contract, no underwriting data, no volume. Quote-able numbers come from a Carbon or
   FairMoney conversation, not from this doc.
2. **The merchant-side equivalent.** This is the **consumer** mirror. By-product #1 in §8 covers the
   merchant side already.
3. **Building it.** This memo is the input to a partner call, not a build plan. A build plan
   belongs in `docs/superpowers/plans/` and starts with a partner response.
4. **A 6-month rule in isolation.** As §1.2 above, the formula is not underwriting.

---

## What this memo should be measured on

The next decision is **shape** (A vs B). It will not be made by reading this memo. It will be made
by one of three events:

- **A Carbon or FairMoney partner call** where they say "yes, we pay X per funded advance against
  Amana's eligible users" — go to shape B
- **CBN signals an interest in a wallet-credit licence pathway** (neighbouring mobile money
  operators have piloted) — go to shape A
- **A user research finding** that the offer *the user wants* is the long-tenor installment, not
  the 3-month short loan — which neither shape ships cleanly today and is its own investigation

If none of those three happens, the right thing to do is **not to build** — and the brand value of
being the wallet that *doesn't* lend is a defensible position in itself. The prompt's "incentive
to spend more" framing is real, but spending incentives are also the §8.4 trap: parent-controlled
spending on a child is the thing that gets traded if we read this too greedily.
