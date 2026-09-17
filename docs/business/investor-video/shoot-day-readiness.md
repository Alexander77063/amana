# Shoot-day readiness

Read this before booking anything. A market day costs vendors' time, a crew, and your standing
with people who agreed to help. The cost of finding a blocker on the morning is not a delay — it
is spending all of that and going home with nothing.

Every gate below is **binary and verifiable**. "Should be fine" is not a pass.

---

## Gate 1 — Production is deployed and a real payment has completed

**Status: FAILING as of 2026-09-17.** This is the blocker.

`amana-api` has not deployed successfully since 2026-09-07. Every release fails at the migration
step before the app boots.

| | |
| --- | --- |
| Database connection | ✅ **Fixed and staged, not deployed.** `DATABASE_URL` pointed at `aws-0-eu-west-2.pooler.supabase.com`; the project lives in **eu-west-1**. Corrected value staged on Fly with a rotated password. Verified by connecting: 43 tables present, data intact. |
| `ANCHOR_API_KEY` | ❌ **Unset in production.** Only Alex can supply it. |
| `ANCHOR_WEBHOOK_SECRET` | ❌ **Unset in production.** Never guess this one — a wrong value silently rejects every inbound settlement webhook, and the failure looks like "payments just stop working" rather than an error. |

> **Corrected 2026-09-17 — this gate is bigger than "set two secrets".** A sandbox
> `ANCHOR_API_KEY` is enough to make production *boot*, and is normally self-serve from the Anchor
> dashboard. It is **not** enough to film. `ANCHOR_API_BASE_URL` points at Anchor's sandbox by
> design, so production-with-a-sandbox-key runs real infrastructure and **moves no real money** —
> nothing would actually reach a trader's account.
>
> A market shoot paying real vendors needs the **real-money go-live**: the production Anchor base
> URL, a production key, and the compliance work behind it. See §2 and §5 of
> [`docs/runbook/go-live-checklist.md`](../../runbook/go-live-checklist.md), and note §5's warning
> that the Anchor adapter **has never run against the real sandbox**, let alone production.
>
> Plan the shoot around that, not around a dashboard visit. Everything in the script that does not
> move money — signup, pairing, sub-wallet creation, rules — can be filmed against sandbox as soon
> as production boots.

**Pass condition, all four:**

1. `flyctl deploy` completes — release command and health checks both.
2. `https://amana-api.fly.dev/health` returns 200.
3. The cron machine is running (the reconciliation sweep is what rescues a stuck payment).
4. **A real ₦100 payment to a real bank account completes on a real phone**, and the money arrives.

That last one is the gate. Everything before it is infrastructure; only the transfer proves it.

> Production has processed **zero transactions ever** (`transactions` table is empty). The shoot
> will be the first real money through this system. Budget for that: go on a quiet day first, with
> nobody filming, and put ₦500 through it.

---

## Gate 2 — Native builds, on the actual phones, in hands

The apps I have been running are **web builds**, which exist for the screen-capture harness. They
are not what you film.

- Build both apps through **EAS** and install on the real devices, well before the day.
- **NFC tap-to-pair only exists natively.** It is the best thirty seconds of the onboarding cut and
  it cannot be shown in a browser.
- The camera-based **NQR / vendor-code scan** needs a real camera and real market light. Test it in
  the actual market, at the actual time of day. A scanner that works at a desk can fail on a
  sun-bleached printed code.
- Install on **at least one spare of each** phone. A device that will not unlock is a lost morning.

---

## Gate 3 — Money, wallets and vendors are prepared

- The principal's **master wallet is funded** by a real bank transfer into its virtual account, and
  the balance has landed. Do not do this on camera for the first time; inbound settlement is
  webhook-driven and the timing is not yours to control.
- Sub-wallets exist, with the rules the script depends on **already set and tested** — especially
  the daily limit that the bump scene deliberately exceeds.
- **Every vendor's bank details are confirmed correct, in advance, by a test transfer of ₦100.**
  A wrong account number on the day is money gone to a stranger, on camera.
- Have **more vendors briefed than you need**. People do not show up; stalls close.

---

## Gate 4 — The happy path has been rehearsed end to end

Run the full script the day before, in the same market if possible, with the same phones and SIMs:

- Pair the agent (NFC, and QR as fallback).
- Agent pays a vendor within the limit → receipt.
- Agent attempts a payment over the limit → **bump request** → parent approves on their phone →
  payment completes.
- Agent attempts a locked category → refusal.
- Parent sees each event in their inbox.

Time each one. The **bump approval round trip is the shot most likely to stall**, because it
depends on push delivery over a mobile network in a crowded place. Know how long it really takes
before a camera is running.

---

## What will go wrong, and what to do

| On the day | Response |
| --- | --- |
| Push notification is slow or does not arrive | The parent's inbox screen updates on open — cut to them opening it. Do not wait on camera. |
| Payment stuck "sending" | It is in flight, not lost. The sweep resolves it within minutes. **Do not retry on camera** — a retry is a second payment. |
| Anchor is down or erroring | Stop filming transactions. Nothing about a real payment can be faked, and a staged one is the single thing that would destroy the video's value. Shoot B-roll and interviews. |
| A vendor's transfer is refused | Move to the next briefed vendor. Never re-enter account details under time pressure. |
| Scan will not read the code | Fall back to phone lookup or typed account entry — both are real, built flows, and both are honest to show. |

## Two things that look like bugs on camera

Both are known and neither is fixable before a shoot:

- **A sub-wallet's balance shows ₦0.00, always.** This is correct: a sub-wallet is an envelope with
  limits, not an account holding money. In a close-up it reads as a broken app. **Do not frame the
  balance.** Frame the limit and what is left of it today.
- **No visible back button** on several screens — navigation is the OS gesture. Avoid shots where
  someone is visibly hunting for a way back.

## Before the crew arrives

- Phones charged, **plus power banks**. Screen-recording and camera use drain fast.
- **Screen brightness at maximum.** Market daylight defeats a phone screen; this is the most common
  reason phone footage is unusable.
- Notifications from every other app silenced. A WhatsApp banner across a payment receipt means a
  reshoot.
- Airplane mode **off**, Wi-Fi **off**, mobile data on — you are showing it working the way a real
  user has it.
