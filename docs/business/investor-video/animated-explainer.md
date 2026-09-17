# Animated explainer — script and boards

A 90-second explainer, **deliberately illustrated**, for investors and the top of the website.

Built as input for a motion designer or a generative video tool. Every frame below specifies what
is on screen, what is said, and how it moves.

---

## The one hard rule

**Nothing in this film may look like footage.** Flat illustration, geometric shapes, motion
graphics — never photoreal people, never a simulated camera in a real market, never a face that
could be mistaken for a real customer.

This is not an aesthetic preference. Amana has processed **zero transactions in production**. A
photoreal scene of vendors and shoppers using the app would read as evidence of traction that does
not exist, and an investor who later learns the scene was generated will re-examine everything else
they were told. An openly illustrated film makes a claim about *how the product works*, which is
true and provable. A photoreal one makes a claim about *who is already using it*, which is not.

When the real market footage exists (see [`shot-list-and-script.md`](./shot-list-and-script.md)),
it replaces this film's middle section and gains enormously from the contrast.

---

## Specification

| | |
| --- | --- |
| **Duration** | 90 seconds |
| **Aspect** | 16:9 master at 1920×1080. Cut a 1:1 and 9:16 from the same boards — keep all text inside a centre-safe 1080×1080 |
| **Frame rate** | 30fps |
| **Audio** | Single voice, unhurried. No music bed under the first 8 seconds. Light percussive Afrobeat-adjacent bed after, ducking under every line |
| **Type** | **Georgia** for display lines, **Plus Jakarta Sans** for UI labels and numbers |
| **Captions** | Burned-in optional; hard-subtitle the social cuts, since most will play muted |

### Palette — the shipped tokens, not approximations

| Role | Hex | Use |
| --- | --- | --- |
| Ground | `#0D1B2A` | Navy. The film's default background |
| Surface | `#152535` | Cards, phone bodies |
| Cream | `#F5F0E8` | Type on navy; the app's own background when a screen is shown |
| **Gold** | `#C9A227` | **One highlight per scene. Never two.** |
| Debit | `#FF6B6B` | Money leaving |
| Credit | `#52C49A` | Money arriving |

**"One highlight per scene" is the discipline that makes this look like Amana** rather than generic
fintech. In any frame, exactly one element is gold — the thing the viewer must look at. Everything
else is navy, cream and grey.

### Motion rules

- Everything **eases**; nothing linear, nothing bounces.
- Money moves as a **single gold dot travelling along a line**. It never sparkles, never splits into
  particles, never becomes a coin with a ₦ on it.
- Rules appear as **hard edges** — a boundary a dot stops against. Not a padlock, not a shield.
- Transitions are **cuts on the voice**, not dissolves.

---

## Script and boards

### 1 · The question every household already has (0:00–0:09)

**Visual** — Navy. A cream line drawing: a hand passing a folded banknote to a smaller hand. Both
stylised, no faces, no detail. The note is the only gold object.

**On screen** — nothing.

**VO** — *"Every Nigerian household has this conversation. Somebody has to go to the market. And
somebody has to hand over the money."*

**Motion** — Hold the drawing still for two beats after the line lands. The silence is the point.

---

### 2 · The two bad options (0:09–0:20)

**Visual** — Split frame. Left: the gold note passing over completely, the giving hand now empty.
Right: a single figure walking, alone, carrying everything. Neither side is labelled a winner.

**On screen** — `GIVE IT AWAY` / `GO YOURSELF` — Plus Jakarta Sans, small, cream, lower third.

**VO** — *"Today there are two options. Give the money away completely and hope. Or go yourself,
every time."*

**Motion** — Left side plays first, right side plays second, then both hold side by side.

---

### 3 · The reframe (0:20–0:28)

**Visual** — Both options slide off. Centre of frame, one line of Georgia, cream on navy:

> **Delegated authority,
> not delegated access.**

The word **authority** is gold.

**VO** — *"There is a third option. Delegated authority, not delegated access."*

**Motion** — The two previous scenes slide out horizontally; the line fades up. No movement under
it. This is the thesis and it should sit still.

---

### 4 · One wallet (0:28–0:36)

**Visual** — A single rounded navy card, centre, gold edge: the master wallet. A gold dot enters
from off-frame and settles into it.

**On screen** — `ONE WALLET` above the card.

**VO** — *"A parent funds one wallet. It has a real account number, so money arrives by ordinary
bank transfer."*

**Motion** — The dot travels in on a curve and stops cleanly. No splash.

---

### 5 · Many people, own limits (0:36–0:48)

**Visual** — Three smaller cards fan out beneath the wallet, connected by thin cream lines. Each
carries a different figure — a daily limit. **Only the lines are gold**; the cards stay navy.

**On screen** — `₦5,000 / day`, `₦2,000 / day`, `₦10,000 / day` in Plus Jakarta Sans.

**VO** — *"Each person who spends from it gets their own wallet, and their own limits. They never
see the main balance. Only what they have been given."*

**Motion** — The three cards draw outward in sequence, 120ms apart. Numbers count up into place.

---

### 6 · The rules are shapes (0:48–0:58)

**Visual** — Around one sub-wallet card, four labelled boundaries appear as hard-edged arcs:

`DAILY LIMIT` · `CATEGORIES` · `TIME OF DAY` · `APPROVED SELLERS`

Each arc is cream. As each name is spoken, that arc alone turns gold, then returns to cream.

**VO** — *"How much, in a day. What it can be spent on. When. And with whom."*

**Motion** — Strictly one gold arc at a time. This scene breaks if two are lit together.

---

### 7 · A payment, inside the rules (0:58–1:07)

**Visual** — A gold dot leaves the sub-wallet, travels a cream line, and lands in a simple shape
labelled `TRADER`. The trader shape is **not** a phone and **not** a person — a market stall
silhouette, flat and iconic.

**On screen** — `→ their bank account`

**VO** — *"A payment goes straight to the trader's own bank account. They do not need the app. They
do not need to sign up for anything."*

**Motion** — The dot arrives and the stall shape pulses **once**, gold, then settles. *This is the
line investors care about most — hold an extra beat after it.*

---

### 8 · The boundary holds (1:07–1:20)

**Visual** — A second dot leaves, larger. It travels and **stops hard** against the `DAILY LIMIT`
arc, which flares gold. The dot waits there, visibly.

**On screen** — `OVER THE LIMIT`

**VO** — *"Over the limit, it stops."*

**Motion** — The stop must be abrupt — no easing on the collision. Everything else in this film
eases; this does not. That contrast is what makes it read as a rule rather than a delay.

---

### 9 · The parent decides, from anywhere (1:20–1:32)

**Visual** — Frame splits. Left: the waiting dot, still held. Right: a second phone shape,
elsewhere — indicated by distance, not by a drawn office. A gold notification bar slides in. A
thumb taps. The arc opens, and the dot completes its journey.

**On screen** — `ASK` → `APPROVED`

**VO** — *"It asks. She decides from wherever she is, in seconds, and it goes through. That is the
difference between a limit and a lecture."*

**Motion** — The gap between tap and completion should be about 400ms — quick enough to feel live,
slow enough to see.

---

### 10 · And what was refused stays refused (1:32–1:38)

**Visual** — A third dot approaches the `CATEGORIES` arc and stops. **The arc does not open.** The
dot fades out where it stopped.

**On screen** — nothing.

**VO** — *"And what she said no to, stays no."*

**Motion** — No flare, no colour change, no alert. The refusal is quiet. Understatement sells this
harder than an alarm would.

---

### 11 · What it is (1:38–1:46)

**Visual** — Pull back. The whole structure visible at once: one wallet, sub-wallets, boundaries,
traders. Everything cream except a few gold dots moving along their lines, all inside their bounds.

**On screen** — `Control without the conversation.` Georgia, cream, centred.

**VO** — *"Control without the conversation."*

---

### 12 · Close (1:46–1:50)

**Visual** — Navy. The Amana wordmark, cream, gold underline. One line beneath.

**On screen** — `Amana` · `Controlled-spend wallet for Nigeria`

**VO** — silence, or a single line: *"Amana."*

---

## Never put in this film

- **Photoreal people, faces, or market scenes.** The reason is in "The one hard rule" above.
- **Invented traction.** No user counts, no transaction volumes, no "₦2bn processed", no map with
  glowing cities, no logo wall of partners. Every number on screen must be a limit or an amount in
  an example — never a metric.
- **A fake dashboard** with charts rising to the right.
- **Coins, banknote showers, piggy banks, padlocks, shields.** The whole point of the gold-dot
  language is to avoid the fintech stock cupboard.
- **Claims the product does not support.** It does not do savings, credit, interest or cards. Do
  not let a generated shot imply otherwise because a card looks good on screen.
- **A second gold element in any frame.**

## If you generate this with a video tool

- Prompt for **"flat vector motion graphics, 2D, no photorealism, no human faces"** in every shot,
  and state the hexes explicitly.
- Generate **per scene**, not as one 90-second prompt. Cut them together and lay the voice over the
  edit — a single long generation will drift off-palette by the halfway mark.
- Regenerate any shot where a face, a hand with real skin texture, or a photographic background
  appears. Those are the frames that turn an honest explainer into a misleading one.
- Record the voice with a **person**, not TTS. The script is short enough that one take is
  affordable, and the synthetic voice is what makes an otherwise good film feel like a template.

## Assets to hand over

- Wordmark, cream and navy versions, vector.
- The six palette hexes above.
- Georgia and Plus Jakarta Sans, or licensed equivalents.
- Screenshots from `tools/demo/out/` if a real screen is wanted in scenes 4–7 — though the boards
  above deliberately use abstractions instead, because a real screenshot inside an illustrated film
  dates the moment the UI changes.
