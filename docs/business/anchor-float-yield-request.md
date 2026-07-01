# Anchor — Written Request: Yield / Float Arrangement on Customer Balances

**Status:** Draft, ready to send
**To:** busdev@getanchor.co
**From:** Alex Adegbola — Amana
**Date:** 2026-06-30
**Re:** Your pricing note, item 3 ("Float / Interest on Balances")

> **Why this exists:** In your commercial note you said yield-sharing is *not part of the
> standard offering* and is "considered on a case-by-case basis based on factors such as average
> float balances, duration funds are retained, transaction volumes, and the overall partnership
> scope." `PRICING.md` Open Item #1 calls for putting the specific ask to you **in writing**, so
> the answer is on the record before launch and before we set any free-tier generosity. This is
> that letter. Paste the body below into an email; the figures are from `docs/business/PRICING.md`.

---

## Email body

**Subject:** Amana — request for a case-by-case yield/float arrangement on held balances

Hi team,

Thank you for the detailed pricing note — it answered our questions cleanly and we're proceeding
on that basis. One item we'd like to take further, in writing, is **item 3 (float / interest on
balances)**, which you noted is handled case-by-case.

We'd like to formally open that conversation. Specifically, we'd appreciate a written answer to
the following:

1. **Eligibility & mechanism.** Can Amana earn yield on the aggregate customer balances we hold
   through Anchor (across NDIC-insured NUBAN deposit accounts and/or sub-ledger accounts)? If so,
   is it structured as a yield-share on the underlying deposit, a negotiated rate on a sweep, or
   another mechanism? We want to understand who holds the economic interest in idle balances by
   default, and what it takes to change that.

2. **Indicative terms.** Given the float profile below, what indicative rate or yield-share split
   could we expect, and at what thresholds (average float, account count, transaction volume) do
   terms improve? We're happy to work to a tiered structure tied to scale.

3. **Regulatory framing.** Please confirm the CBN/NDIC treatment of any such arrangement so we
   can represent it accurately to our own stakeholders, and flag any constraints (e.g. minimum
   retention period, reporting, segregation) that would apply.

4. **Process.** What's the path to a case-by-case review — a term sheet, a minimum live-volume
   period, or a commercial review at an agreed milestone (you mentioned ~120 days of transacting
   for NIP volume tiers; we're happy to align float discussions to the same cadence)?

### Our projected float profile

Amana is a controlled-spend wallet: principals fund a master wallet and allocate limited
sub-wallets to agents. Balances are held between top-up and spend, so there is a persistent
average float across the book. Indicative figures from our model (illustrative, pre-launch):

| Portfolio (mix: ~91% household / 9% business) | Accounts | Avg. balance/account | **Aggregate average float** |
|---|---:|---:|---:|
| Launch cohort | 1,100 | ~₦14,400 | **~₦15.8M** |
| 10× | 11,000 | ~₦14,400 | **~₦158M** |
| 100× | 110,000 | ~₦14,400 | **~₦1.58B** |

Per-segment average balances behind the blend: household ~₦8,000, SMB ~₦60,000, heavy shop
~₦150,000. Balances are genuine idle deposits between funding and spend — not in-flight
settlement — so the retention duration is meaningful rather than transient.

For context on why this matters to us: at our pricing, the float yield is **upside, not the
foundation of the model** — but it is the single biggest lever on how generous an onboarding free
tier we can offer end users, which directly affects acquisition velocity on the Anchor rails.
A workable yield arrangement lets us pass more value to customers and grow volume faster, which
benefits both sides.

### One operational clarification (separate from float)

While we have you, one operational point on the **₦50 stamp duty / EMTL** you charge "on
transfers over ₦10,000." We intend to present this to our end users as a pass-through levy on
qualifying spends, so we'd like the mechanics confirmed:

- On an **outbound** NIP transfer over ₦10,000, do you **auto-deduct** the ₦50 from our account
  as part of the transfer, or do you expect us to collect and remit it separately?
- On an **inbound** collection over ₦10,000 into one of our virtual NUBAN accounts, is the ₦50
  charged automatically to the account holder (the credited account), or billed back to us?

A one-line answer on each lets us display and reconcile the levy correctly for our customers.

We'd welcome a short call to walk through it. In the meantime, a written note on eligibility,
mechanism, and the review path would let us plan around it.

Thank you,

Alex Adegbola
Amana

---

## Internal notes (do not send)

- **Default assumption until Anchor answers:** float = **₦0** in the model
  (`PRICING.md` §6, Open Item #1). Do **not** bank free-tier generosity on float income.
- **Why the NDIC angle matters:** NDIC-insured NUBAN deposit accounts typically accrue any yield
  to the partner bank, not the fintech — hence "case-by-case." The sub-ledger balances may have
  different treatment; worth asking Anchor to separate the two in their answer.
- **Rate context (do not quote to Anchor):** Nigerian T-bill / money-market yields have run well
  above 8% p.a.; even a conservative 8% on ~₦158M float (10× cohort) is ~₦12.6M/yr of upside, and
  ~₦126M/yr at the 100× cohort. This is the prize being negotiated — let Anchor propose the split.
- **Tie to NIP volume tiers:** Anchor offers NIP volume-tier reviews after ~120 days of live
  volume; aligning the float review to the same milestone is the path of least resistance.
- **When to send:** ideally once there is *some* live float on the book (strengthens the case),
  but the eligibility/mechanism questions (1 & 3) can be asked now to de-risk planning.
- **EMTL clarification (operational only):** treatment is now decided — EMTL is a **user
  pass-through**, not an Amana cost (`PRICING.md` Open Item #4), so this is no longer a
  margin-swing question. The only thing outstanding is the *mechanics* (auto-deduct vs
  collect-and-remit; inbound charged to the account holder vs billed back), which determines how
  we display/reserve the levy in-app — not the P&L. Answer doesn't block the pricing decision.
