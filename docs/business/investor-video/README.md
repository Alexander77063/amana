# Amana — real-market video

Two cuts, one shoot, filmed in a working Lagos market with real vendors and real people using the
real app.

| Cut | Audience | Length | Job |
| --- | --- | --- | --- |
| **Investor** | People deciding whether to fund this | 90–120s | Prove the thesis is real: a parent's limits hold, in a market, on someone else's phone |
| **Onboarding** | New principals and agents | 3–4 min, chaptered | Get a household from "downloaded it" to "the first payment worked" |

Same day, same cast, same market. The onboarding cut needs the calm setup shots; the investor cut
needs the live moment. Shooting them together is cheaper and the footage overlaps.

## The documents

| | |
| --- | --- |
| [`shoot-day-readiness.md`](./shoot-day-readiness.md) | **Read first.** What must be true before anyone books a day. Production is currently down; this is the gate. |
| [`shot-list-and-script.md`](./shot-list-and-script.md) | Scene-by-scene, both cuts, with the real screen names and the spoken lines |
| [`consent-and-privacy.md`](./consent-and-privacy.md) | Release forms, NDPR, and the list of things that must never be on screen |
| [`logistics-and-casting.md`](./logistics-and-casting.md) | Market, vendors, cast, devices, schedule, kit |
| [`animated-explainer.md`](./animated-explainer.md) | A 90-second illustrated film — script and boards. **Needs no shoot and no production**, so it can be made now |

## Three films, not one

| | Made from | Blocked by | Honest claim |
| --- | --- | --- | --- |
| **Narrated walkthrough** — `tools/demo/out/amana-walkthrough-narrated.mp4` | The real apps driven through the real API, bank stubbed | Nothing. **Exists today** | "This is how the product works" |
| **Animated explainer** | Illustration, no footage | Nothing. Needs a designer or a video tool | "This is what the product is for" |
| **Real-market film** | A market, vendors, real money | **Production being live** | "Real people are doing this" — the only one that can claim it |

Each says something the others cannot. The third is the valuable one, and it is the one that has to
wait; the first two can go in front of someone this week.

## The one thing that decides the date

**Production cannot boot.** `amana-api` has been failing to deploy since 2026-09-07, and no
version of this shoot works without it: real vendors, real people and real transactions mean real
money moving through Anchor. A payment that fails in front of a vendor is not a retake — it is
someone's money and your name in that market.

Two faults, one already fixed:

- **Database — fixed, staged, not deployed.** `DATABASE_URL` pointed at the `eu-west-2` pooler
  while the project lives in `eu-west-1`. One character. The corrected value, with a freshly
  rotated password, is staged on Fly.
- **Anchor secrets — outstanding.** `ANCHOR_API_KEY` and `ANCHOR_WEBHOOK_SECRET` are unset in
  production. Only Alex can supply them. **This is the blocker.**

Do not book a market day, vendors or a crew until production has been deployed *and* a test
payment verified end to end. See `shoot-day-readiness.md` for the gate list.

## What the app can actually show

Checked against the code on 2026-09-17, not assumed:

**Real, filmable:** agent pay flow (scan an NQR code or an Amana vendor code, phone lookup, or type
an account), confirm, send, receipt, attach a photo of what was bought; over-limit bump request and
the parent approving it live; sub-wallet creation and rules (daily limit, category locks); pairing
by NFC tap or QR; top-up; transaction history; marketplace vouchers.

**Not filmable in the apps:** the principal has **no pay flow** — a parent funds, sets rules and
approves; they do not buy through the app. Retailer KYB is a web portal, not a phone screen.
VAS (airtime and bills) is reached inside the pay flow's capture step, **not** a separate tab —
do not write a shot that opens an "Airtime" screen, because there isn't one.

**Two cosmetic things that read as bugs on camera**, both known: a sub-wallet's balance always
shows **₦0.00** (correct — a sub-wallet is an envelope with limits, not an account, but it looks
broken in close-up), and there is **no back button** on several screens, only the OS gesture. Frame
around both; see the readiness doc.
