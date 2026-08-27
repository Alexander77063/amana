# Amana — lender discovery brief

**Status:** Preparation for a discovery conversation. **Nothing here is an offer.**
**Date:** 2026-08-27
**Context:** [`PRICING.md` §8](./PRICING.md) — operational by-products, #1 (merchant cash-flow graph)
**Sibling:** [`anchor-float-yield-request.md`](./anchor-float-yield-request.md) — same shape of
conversation, different counterparty

---

## The ask in one line

**We are going in to learn a number, not to sell a dataset:** what a lender pays for a qualified,
cash-flow-verified merchant introduction — and how much payment history it takes before one is worth
anything.

`PRICING.md` §8.5 records why: by-product #1 is the strongest thing the system produces as exhaust,
and its value is entirely unknowable until someone on the other side says a figure. Until then it is
a hypothesis, and building toward it would be building on a guess.

## Read this before the meeting: we have no data

**`vendor_observations` is empty. Zero merchants observed, zero promoted, zero claimed.** Production
has never served a transaction — the app has been crash-looping on two missing Anchor credentials —
and observations are only written after a settlement commits.

So:

- **Do not say** "we have a merchant cash-flow graph". We have a system that will build one.
- **Do not quote coverage**, in merchants or in geography. There is none.
- **Do not offer a pilot dataset.** There is nothing to pilot with.

This is not a reason to delay the conversation. It is a reason to frame it as discovery — and having
it *now* is worth more than having it later, because the answers change what GTM prioritises before
GTM exists.

## What the system observes, mechanically

Every settled vendor payout carries the payee's bank code, account number, NIBSS-resolved account
name, spend category, and which household paid. That is recorded after settlement, and it never
blocks or fails a payment.

| Threshold | Value | What it means |
|---|---|---|
| Promotion | **5 distinct households** | Not 5 payments. One household paying fifty times promotes nothing. |
| Category consensus | **8 households at 0.6 agreement** | A category derived from behaviour, not self-declared |
| Sweep | hourly | |

**The distinct-payer count is the interesting part, and it is worth leading with.** A merchant paid
by forty different households each week is a materially different credit proposition from one paid
forty times by one household — and it is a signal that is hard to fake, because it requires forty
separate people to have chosen you.

## Why this population is invisible today

Credit bureaus hold salary earners. Card rails hold formal retail with terminals. **Nobody holds the
woman selling food who is paid by bank transfer forty times a week** — no POS, no bureau file,
frequently no registered entity. Amana observes exactly that population as a by-product of doing its
actual job, which is controlling a household's spending.

## The consent model — and the gap in it

`vendors.status` already separates the two populations:

| | |
|---|---|
| `observed` | Promoted by the sweep. **The merchant has never been asked** and does not know they are in the registry. **Not offerable. Not referable. Not for sale.** |
| `claimed` | Proved phone control by OTP, was NIBSS-matched to the account, volunteered their identity. A counterparty with a relationship. |

**The gap, found 2026-08-27:** the claim flow captures **no consent of any kind** — no terms, no
privacy notice, no agreement to onward introduction. A merchant claims their account and agrees to
nothing.

Under **NDPA 2023** that is the missing lawful basis. "They claimed their account" is not consent to
be referred to a lender. If this by-product is ever pursued, the claim flow needs an explicit,
recorded, revocable consent step — and it is **cheap now** (no client implements the claim flow yet,
and `@amana/api-client` has no method for it) and expensive once merchants have claimed under terms
that never mentioned it.

**Do not promise a lender anything that depends on consent we have not yet collected.**

## The five questions to actually ask

The purpose of the meeting. Ask these; resist pitching.

1. **What do you pay today for a qualified SME or merchant lead — and what makes one "qualified"?**
   This is the number §8.5 is waiting on.
2. **What do you underwrite thin-file merchants on now, and what does that book default at?**
   Establishes whether payment regularity is an improvement or a novelty.
3. **How much history before inbound-payment regularity is usable — three months, six, twelve?**
   This sets the earliest date any of this can transact, and therefore whether to prioritise merchant
   claims in GTM at all.
4. **Does distinct-payer count move your model, or only volume and recency?**
   If only volume, our distinctive signal is worth less than we think and we should know that early.
5. **Do you need the raw signal, or is a scored, ranked introduction enough?**

**Question 5 is the one that matters most, and it is easy to skip.** If a scored introduction
suffices, no personal data ever leaves Amana: we rank, we introduce, the merchant consents to the
introduction itself. That sidesteps a data-sharing agreement, most of NDPA's surface, and the
[Gate 3](../runbook/vendor-claim.md) problem entirely — because we would be selling a *judgement*
rather than an *answer about an account*. If they need raw data, this becomes a much heavier
proposition and should be priced as one.

## What we can honestly say we have

- A **live rail** that observes merchant payments as a by-product, already built and tested
- A **claim rail** that converts an observed merchant into a verified, contactable, consenting one —
  OTP-proved phone, NIBSS-matched to the account
- A **category consensus** derived from real behaviour rather than self-declaration
- A design that **already separates** the consenting population from the non-consenting one, at the
  schema level, before anyone asked us to

That is a credible "here is what will exist and why it will be trustworthy". It is not "here is a
dataset", and the difference should be audible in the room.

## After the meeting

Write the answers into [`PRICING.md` §8.5](./PRICING.md) — replacing the hypothesis with whatever
was actually said, including if the answer was "this is worth nothing to us". A negative answer is
worth having: it closes by-product #1 and redirects attention to #2 and #4.
