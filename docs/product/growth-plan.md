# Amana — growth plan

**Date:** 2026-08-25 · **Related:** [`user-acquisition.md`](./user-acquisition.md),
[`PRICING.md`](../business/PRICING.md)

Acquisition gets the first households. This is about whether they stay, what compounds, and what
breaks when there are ten times as many.

## Retention is the whole business

The unit economics only work on a household that keeps spending: **₦100 per external spend**, with
the first five free for life. A household that spends twice and stops is a **loss** — it consumed
two of five free spends and returned nothing.

So the number that matters is not signups. It is **spends per household per month**, and the honest
question is whether Amana is load-bearing in how that household moves money or merely installed.

### What retention actually depends on

**The agent, not the principal.** The principal chooses Amana; the agent decides whether it survives
contact with a real counter. If a payment is refused at the wrong moment and the agent is left
stranded, they go back to cash and the household is gone — the principal will not fight their own
child about it.

This is why the product **holds an out-of-rule spend for approval rather than refusing it**. That
decision is a retention mechanism, not a feature. The two places that currently reject rather than
hold — **VAS and marketplace purchases** — are the known retention risk in the product today, and
the reason "make marketplace purchases bumpable" sits in the deferred list rather than being closed
as wontfix.

## The loop

```
parent sets a rule  →  agent spends within it without asking
        ↑                              ↓
retailer tells      ←  retailer gets paid on redemption
customers about it     (and the marketplace gets a reason to exist)
```

Two things compound here, and only one is obvious:

**The obvious one:** more retailers make the marketplace worth opening; more buyers make Amana worth
joining as a retailer.

**The one that matters:** every rule a parent sets **raises switching cost without feeling like
lock-in**. A household three months in has limits, category locks, hours and approved shops encoding
decisions nobody wants to make again. That is not a dark pattern — the parent gets the value of
every one of those decisions daily — but it is the durable moat, and it is why the control fusion is
worth more than the marketplace.

## What breaks at 10x

Named honestly, because each has a known trigger:

| At scale | What breaks | Trigger to watch |
|---|---|---|
| **Rate limiting** | In-memory, per-instance. Two Fly instances means two independent windows. | Second web instance. Needs the Redis backend the store was built pluggable for. |
| **Notification fan-out** | Fire-and-forget writes, no queue. | Push volume, not user count. |
| **The recon sweep** | Every 5 minutes over a growing table. | Sweep duration approaching the interval. |
| **Anchor rate limits** | Ours are unknown at volume; the circuit breaker protects us, but a tripped breaker is a stalled payout. | Any breaker trip in production. |
| **Ops-driven retailer onboarding** | Deliberately manual. Curation is a feature at 50 retailers and a bottleneck at 500. | Onboarding backlog, not retailer count. |
| **Coverage gate** | 92% on a growing codebase gets harder, and the temptation is to lower it. | Any PR that proposes lowering it. |

**The first three are the same problem**: single-instance assumptions that hold precisely until the
day a second instance is needed — which is the day traffic justifies it, i.e. the worst day.

## Sequenced bets

**Now → stage 3:** do nothing clever. Get spends per household up. If a household is not spending
weekly, no growth mechanism will save it.

**Stage 4:** the retailer flywheel. Supply first, because a marketplace with three shops is worse
than none — it teaches buyers there is nothing there.

**Post-scale:** the distribution layer in
[`embedded-distribution-strategy.md`](../business/embedded-distribution-strategy.md), which is
explicitly a scale lever. Its own note says the entire line is a rounding error next to the spend
fee at launch volume, and that judgement stands.

**Never:** cross-app tracking, proactive upsell to agents, or sponsored placement that is not
labelled and not price-competitive. These are strategy-doc guardrails, not preferences, and the
marketplace was built to make them structurally difficult to violate — the agent's catalogue is
filtered by the parent's rules, so there is no surface on which to upsell them anything.

## The one metric

**Spends per activated household per month.**

Acquisition can be bought. Retention cannot, and every other number here moves as a consequence of
this one.
