# Shot list and script

Two cuts from one shoot. Screen names below are the **real components** in
`apps/agent/src/screens/` and `apps/principal/src/screens/`, checked 2026-09-17 — if a screen is
not named here, it is because it does not exist.

**The rule that makes this video worth making:** nothing is staged. Every payment on screen is a
real payment, of real money, to a real vendor's real account. The moment one is faked, the video
becomes a mockup with better lighting, and an investor who asks one question will find out.

---

# Cut 1 — Investor (90–120 seconds)

**The claim:** a parent in Lagos can hand a child or a member of staff a phone that spends money,
and keep control of what it spends on — without being there.

**What sells it:** the limit holding, live, in a market, with a stranger's goods in someone's hand.
Not the UI. The moment.

### 1. Cold open — the market, no app (0:00–0:08)

Wide. Real market sound, no music yet. A busy row of stalls. Cut to a hand paying cash.

> **VO:** "In Nigeria, sending someone to the market means sending cash. And hoping."

*Hold on the cash. This is the problem, and it needs no explanation to this audience.*

### 2. The parent sets the rule (0:08–0:25)

Principal phone, close. `SubWalletDetailScreen` → `EditRulesScreen`. A finger sets a **daily
limit** and switches a **category** off.

> **VO:** "A parent sets what the money can do. Not a warning. A rule."

*Film the toggle going off, not the whole screen. One decisive gesture.*

**Do not frame the sub-wallet balance — it reads ₦0.00 by design.** Frame the limit.

### 3. The agent buys, for real (0:25–0:50)

Agent phone, over the shoulder, vendor and goods in frame. `CaptureMethodScreen` →
`NQRScanScreen` (or `AccountEntryScreen` if the code will not read) → `ConfirmScreen` →
`SendingScreen` → `ReceiptScreen`.

Then the shot that matters: **the vendor's own phone buzzing with their bank alert.** Their face.

> **VO:** "The money goes straight to the trader's account. No float, no wallet they have to join."

*This is the single most valuable frame in the video. An investor understands instantly that the
vendor needed no onboarding.*

### 4. The limit holds (0:50–1:15)

Agent tries to spend **over the limit**. `ConfirmScreen` → `BumpWaitScreen`.

Cut to the parent — somewhere else entirely, office or home — phone buzzing. `BumpsInboxScreen`.
They read what it is for, and approve.

Cut back: the agent's screen completes. The vendor hands over the goods.

> **VO:** "Over the limit, it stops and asks. She decides from wherever she is. Seconds, not a phone
> call."

*Shoot the parent genuinely elsewhere. A parent standing three feet away, pretending, is visible.*

### 5. The refusal (1:15–1:25)

Agent tries a **locked category**. The app refuses. Short, no drama.

> **VO:** "And what she said no to, stays no."

### 6. Close (1:25–1:40)

Back to wide market. The agent walking off with goods, phone pocketed.

> **VO:** "One wallet. Many people spending from it. Every naira under control."

---

# Cut 2 — Onboarding (3–4 minutes, chaptered)

Made to be watched by someone holding the phone, stopping and starting. Chapter it so support can
link to one part. Calmer, quieter, closer.

### Chapter 1 — "Set up your wallet" (~45s)

Principal: `PhoneScreen` → `VerifyScreen` (code, NIN, BVN) → `HouseholdSetupScreen`.

> "You'll need your NIN and BVN once, to open the wallet. This is a bank account, so it asks who
> you are."

**Film the clickwrap line** above the Verify button — accepting the terms is part of signing up and
should not look like a surprise later.

### Chapter 2 — "Put money in" (~30s)

`HomeDashboardScreen` → the account number to transfer into. A real transfer from the parent's own
bank app. Cut away, return when it lands.

> "Your wallet has its own account number. Send money to it from any bank, the way you'd send to
> anyone."

**Never leave the real account number legible.** See `consent-and-privacy.md`.

### Chapter 3 — "Give someone a wallet" (~45s)

`CreateSubWalletScreen`, then `PairingScreen`. Agent phone: `PairingMethodScreen` →
**`NFCPairScreen`** — the two phones touching.

> "Tap the two phones together. That's the pairing."

*This is the best shot in the onboarding cut and it is impossible in a browser. Shoot it several
times, close, both hands in frame.* QR (`QRScanScreen`) as the documented fallback for phones
without NFC.

### Chapter 4 — "Set the rules" (~60s)

`EditRulesScreen`, slowly, naming each control as it is set: **daily limit**, **categories**, and
where time windows and approved-merchant settings live.

> "A daily limit. What they can buy. When they can buy it."

Be accurate about what is in the app versus what the engine enforces — do not imply an editor that
is not on screen.

### Chapter 5 — "Paying at the market" (~45s)

Agent's flow end to end, unhurried: scan → confirm → send → receipt → `PhotoAttachScreen`
photographing what was bought.

> "Scan, check the name, send. Snap what you bought so there's no argument later."

*The photo attachment is the detail that lands with parents. Do not cut it.*

### Chapter 6 — "When they need more" (~30s)

The bump, from the agent's side (`BumpWaitScreen`), then the parent's (`BumpsInboxScreen`).

> "If it's over the limit, it asks. You approve or you don't."

### Chapter 7 — "Keeping an eye" (~20s)

`NotificationsInboxScreen`, `TransactionListScreen`, `TransactionDetailScreen` with the attached
photo.

> "Every payment, with the receipt and the picture."

---

## Shots to get regardless of the script

Cheap, and edits are impossible without them:

- Hands and phone with **real market behind**, several angles.
- The **vendor's face** when the alert arrives — with consent, and worth asking for twice.
- Goods changing hands, close.
- Market ambience, 60 seconds clean, no speech — for the audio bed.
- Both phones **screen-off**, in hand, in that setting.
- Cutaways: stall signage, hands counting change, the walk between stalls.

## Never film

- Anything **staged as real**. No mock payment, no re-enacted approval "for the shot" presented as
  live.
- A screen showing **someone else's** phone number, account number, BVN or NIN.
- A **failed or stuck payment** presented as a success.
- Anything implying money is held in a sub-wallet — it is not; the sub-wallet is limits.
- A child's face without a parent or guardian's written consent. See `consent-and-privacy.md`.
