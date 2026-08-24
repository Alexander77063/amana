# Amana walkthrough — narration script

The recorded video has **no audio track** (Playwright captures video only). The on-screen
caption bar carries the narrative, so the video works silent. This script is here for whenever
you want a voiceover — read it yourself, hand it to a VO artist, or feed it to a TTS engine.

Timings are approximate and follow the chapter captions, so you can match by eye. Total run is
roughly 2½–3 minutes.

**Tone:** calm, factual, unhurried. The product is about control and trust — overselling works
against it. Let the settled receipt at the end do the closing.

---

**Open — "Amana"**

> Amana is a controlled-spend wallet for Nigeria. A parent funds one wallet, and every person
> who spends from it — a child, a driver, a shop assistant — gets their own limits.
> Everything you're about to see is the real app, running against a live API.

**1 · Sign up**

> Onboarding is a phone number and a one-time code. There are no passwords anywhere in the
> product. For a first-time signup we also collect NIN and BVN — the Nigerian identity numbers
> a wallet needs before it can legally hold money.

**2 · The wallet**

> Creating a household provisions a real bank account: a customer record and a fundable account
> number at our banking partner. That account number is the wallet.

**3 · Funding**

> Money arrives the ordinary way — a bank transfer in. The credit lands as a signed webhook and
> posts to a double-entry ledger. Nothing is a balance field being incremented.

**4 · Pairing**

> To add someone who spends, the parent issues a one-time pairing code. The agent has their own
> phone and their own login — they never see the master wallet, only what they've been given.
> On a phone the code moves by QR, by NFC tap, or by an SMS link.

**5 · Sub-wallet**

> The parent issues a sub-wallet. It isn't a bank account — it's a spending envelope drawn
> against the master wallet, so there's no float to top up and nothing stranded.

**6 · The control**

> And this is the point of the product: the parent sets the rules. A daily limit here. Category
> locks and time windows run in the same engine. All of it is enforced on the server, on every
> spend — the agent's app cannot talk its way past it.

**7 · Spending**

> The agent pays a vendor. It's a normal bank transfer out, so the vendor needs no app and no
> account with us — just an account number. Before anything moves, the bank confirms who owns
> that account, and the agent sees the real name.

**8 · Settlement**

> The bank confirms, and the ledger settles: double-entry postings, both sides accounted for.
> The agent gets a receipt with the NIBSS session ID — the same reference their bank would show.

**Close**

> One wallet. Many people spending from it. Every naira under control.

---

## If you want this as audio

1. **Record it yourself** — a phone voice memo is genuinely fine at this stage, and a founder's
   own voice reads better to investors than a synthetic one.
2. **TTS** — any of the usual services will do; keep the pace slow and leave the pauses.
3. **Music only** — no voice, just a bed under the captions. Lowest effort, and the captions
   already carry the story.

Muxing the audio onto the video needs `ffmpeg`, which is not installed on this machine:

```bash
# once you have a narration.m4a and ffmpeg on PATH
ffmpeg -i amana-walkthrough.webm -i narration.m4a -c:v copy -c:a aac -shortest amana-walkthrough.mp4
```

That command also gives you an **.mp4**, which is worth doing regardless — `.webm` will not
play in Keynote, PowerPoint, or QuickTime without help, and a `.mp4` is what you want to send
to anyone.
