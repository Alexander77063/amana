# Amana — first-conversation brief (Carbon, FairMoney)

> **Why this doc exists.** The accompanying
> [`concept.md`](./concept.md) lands the product shape (referral-to-lender, not
> balance-sheet lending) and the regulatory wall on Amana-issued credit. This
> brief is *the meeting*, not the product. It is what we walk into Carbon's and
> FairMoney's partnerships conversations with, and the questions we are going
> in to learn. Reading `concept.md` before this is non-optional; the constraints
> there apply directly and are not repeated in full below.

---

## Who this is from

Amana — a phone-to-phone controlled-spend wallet for Nigeria. A principal funds
a master wallet and issues **sub-wallets** to N agents (children, staff) with
real-time limits, category locks, time windows, and remote-or-present authorization.
Phone-to-phone is between principal and agent; merchants receive a standard
NIP bank transfer and never install Amana. Two segments, one primitive:
households (parents/staff) and small businesses (owners/riders/staff).

We are B2C, regulated as a wallet, anchored at `app.amana.ng`. Production
launch is in progress. This isn't a hypothetical "one day we'll have the
wallet" outreach.

---

## What we are coming in to learn

**We are coming in to learn a number, not to sell a dataset.** This brief is
read out loud up front so the meeting can move past the framing discussion:

1. **What do you pay today for a qualified SME or consumer lead** — and what
   makes one "qualified"? This is the figure concept.md §"What this memo should
   be measured on" is waiting on. We don't have a number; you do.
2. **What do you underwrite thin-file Nigerians on now, and what does that
   book default at?** Establishes whether six months of paid wallet behaviour
   is a real signal to your model or noise.
3. **How much history before inbound-payment regularity or wallet-behaviour
   regularity is usable — three months, six, twelve?** This sets the earliest
   date any of this can transact, and therefore whether to prioritise onboarding
   on a six-month eligibility rule (concept.md §1.2 warns this is not a stand-
   alone underwriting model).
4. **Does the *principal's* behaviour move your model, or only the *merchant*
   side?** This is where most wallet-to-lender conversations drift. Be specific
   about which signals help and which do not, in your model.
5. **Do you need the raw signal, or is a scored, ranked introduction enough?**
   Question 5 is the one that matters most and is easy to skip. A scored
   introduction suffices for any product where you, not Amana, make the
   credit decision — and it sidesteps a BVN-grade data-sharing agreement, most
   of NDPA's surface, and the consent-rail we are still building
   (`concept.md` §"Why a new consent cannot use the existing principal terms").

---

## What we have today — measured, not promised

We know we are asking you to underwrite on signal we cannot fully document yet.
So:

- **Active principals in good standing on the wallet:** we will not quote a
  number we haven't measured. If you ask, we'll measure in the meeting
  with you on the call and read the number aloud.
- **Households funded and spending as the primary use case:** yes. The wallet
  has shipped, the demo record shows 29/29 happy-path steps
  (see [`docs/runbook/go-live-checklist.md`](../../runbook/go-live-checklist.md)
  for the pre-launch readiness).
- **Production is awaiting two environment prerequisites** before real-money
  traffic: a self-serve *sandbox* Anchor key for the backend boot, and the
  *real-money* Anchor credentials for production. **Both are in flight; the
  sandbox is the smaller gate** and we expect to be live on it within days.
  Real money has a longer path; we are not pretending otherwise.
- **The wallet captures a specific kind of signal** your model may not have
  seen elsewhere: **distinct principal-of-record per merchant per period**
  (not volume), **category lock coverage** (voluntary discipline), **bump
  approval friction** (how often the principal turns the principal-agent
  override dial), and **anomaly-clean weeks** as a continuous score. We
  know what we have; we don't yet know which of those your underwriting
  calls credit-grade.
- **The merchant-side signal** Amana produces — distinct households paying a
  single account, category consensus, NIBSS-resolved account name — is the
  one already hypothesised (and scoped under §8.2 of
  [`PRICING.md`](../PRICING.md)).

---

## What we will **not** do at this stage

- **Pitch a booked origination volume.** We are at the discovery-call stage,
  not the contracted-pipeline stage.
- **Share user-level data.** NDPA 2023 constrains what we may share; the
  §8.4 ruling on household-level data ("trades the one thing the product
  is named after — `amana` means something held in trust") applies to this
  conversation the same way it applies to merchant data.
- **Promise a specific rate band for our users.** Rate bands are yours to
  publish; our role is to surface eligibility, not to set pricing.
- **Build a partner-specific integration before the first call's question 5
  answers how integration looks at all.** Scope-question before build-cost,
  always.

If you want to skip the framing and go straight to "what does the deal look
like," we will follow — but we will keep refusing to invent things we don't have.

---

## What we expect from the first call (an honest ask)

We expect to leave the first call with answers to **two** of the five questions
above. If we leave with three, that's a great call. If we leave with five and a
named contact to continue with, that's the goal — but we will not measure a
first call against it.

Specifically we want to know, by the end of the call:

- Which of the five questions is "yes for us, here's the number today" vs.
  "this needs another conversation with our credit team" — so we know who to
  pull into round two from your side.
- The named owner on your side who will carry this through to round two
  (not the partnerships account manager — the credit-policy owner, or the
  closest internal equivalent).

We expect round two to involve at least one technical / API engineer from
your side and our CTO. **The first call is not that call.**

---

## What shape we'd build, very briefly

The relevant shape is *Concept memo, §"Shape B — Referral-to-lender"*:

- Amana computes a **wallet-side eligibility** for a subset of in-good-standing
  principals (six months tenure, no uncapped-limit weeks, anomaly-clean, no
  recorded NDPA disputes, KYC complete).
- The principal opts in. **A new consent capture**, versioned and recorded,
  separate from the wallet T&Cs — the §8.5 lesson applied early.
- Amana's role is the introduction, not the underwriting. **You screen, you
  decide, you disburse.** Amana takes an origination fee per funded advance.
- The wallet then becomes the place the advance is *spent through* (so the
  rule engine applies) and the place repayment comes out of (standing rule).
- Aggregate-only signal exits Amana. No per-transaction BVN, no per-row
  category detail, no per-payment identity.

If your interest is "how would Carbon's existing product fit *into* this" — i.e.
*we'd be the credit provider and Amana the disbursement + repayment rail* — we're
ready to talk specifics at that level. If your interest is "Amana introduce the
principal to Carbon's app via API and we run our normal underwriting flow
ourselves" — also fine, and that is closer to the default shape.

---

## How we run the meeting

30 minutes, video. Two of us (CFO-track or CEO-track on our side, credit-
policy owner or partnerships lead on yours).

Agenda, time-boxed:

| Min | Topic |
|---|---|
| 0-5 | This brief, read aloud: who Amana is, why we are calling, what the doc says we will and won't do |
| 5-15 | Concept memo §1.1-1.3 (regulatory shape, why not balance-sheet credit, the wallet's data capability) |
| 15-25 | Questions 1-5 from the list above, in whichever order you prefer |
| 25-30 | Who we both need in round two, and on what date |

If we run out of time at minute 25 with three of five answered and two still
open, that is fine — we schedule round two with those two pre-marked.

---

## What we will send after the call

Within 48 hours:

- A written summary of the call (we author, you correct).
- The two-or-three questions still open, made specific.
- A proposed date for round two, with the people named.

If we cannot agree that the call has been productive within 14 days, no
follow-up is sent from our side. We will not chase.

---

## Related

- [`concept.md`](./concept.md) — the consumer-side credit product shape and the
  regulatory reasoning behind referral-to-lender, not balance-sheet credit.
- [`lender-discovery-brief.md`](../lender-discovery-brief.md) — the merchant
  counterpart, which itself sits in a still-open discovery posture. Read
  both before this brief; this brief assumes their constraints.
- [`PRICING.md`](../PRICING.md) §8 — operational by-products, the §8.4
  data-ruling and §8.5 consent gap that this brief inherits.
