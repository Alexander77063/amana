# Amana — UI/UX Design Brief


> **Refreshed 2026-08-25.** Four kinds of change:
>
> 1. **§3 and §4 were wrong, and are corrected.** The palette and typeface specified in v1.0 —
>    a green (`#1A6B4A`) and off-white system set in Inter — were superseded during the
>    design-system build and never shipped. `#1A6B4A` appears **nowhere** in `packages/ui` or
>    either app. What shipped is a dark navy-and-gold system set in Georgia + Plus Jakarta Sans.
>    The old values are kept below as *superseded*, not deleted, so anyone holding a v1.0 mock
>    can see why it does not match a screenshot.
> 2. **§5–§8 cited those dead tokens, so they are corrected too.** Buttons were specified as
>    white-on-green and ship gold-on-navy; screens cited a `display` type token that does not
>    exist. Two were false rather than merely stale, and are marked in place: §6.2 specified a
>    sub-wallet **balance card** (sub-wallets are limits-only — that number is structurally always
>    ₦0.00), and §8 said dark mode was out of scope (it ships, and follows the OS).
> 3. **§6.8 and §9 are new** — the marketplace, voucher and VAS screens; and the retailer portal,
>    which is Next.js and cannot import React Native source, so it duplicates the tokens in CSS.
>    That duplication is the accepted cost of the Phase-2 platform decision, is flagged at both
>    sites in code, and its drift is tracked in §9.2.
> 4. **Every table in this file rendered as literal pipe text** — no `|---|` delimiter rows —
>    which is a poor look for the document handed to a design agency. Fixed here and across
>    `docs/`, and now checked in CI by `tools/docs/validate-tables.py`.
>
> **`packages/ui/src/theme/tokens.ts` is the source of truth.** Where this document and that file
> disagree, the file is right and this document has drifted again.
>
> Index: [`docs/product/README.md`](../product/README.md)

**Version:** 1.1 | **Date:** 2026-05-13, refreshed 2026-08-25
**Audience:** Product designer, UI engineer, design agency
**Apps:** Principal (iOS + Android) · Agent (Android first) · Retailer portal (web, §9)

> **Executive summary:** Amana is a financial control product, not a payments utility. The design must communicate calm authority — the feeling that the principal is in control, the agent is trusted but bounded, and money is handled with the seriousness it deserves. The aesthetic is premium Nigerian: warm, grounded, modern without being generic. This brief covers brand identity, design principles, colour and typography system, component patterns, and key screen descriptions for both apps.

---

## 1. Brand Identity

### 1.1 Name & etymology

**Amana** — from Hausa and Arabic-rooted: *trust, safekeeping, something held in trust for another.* The name encodes the product's core promise before a word is read.

### 1.2 Brand pillars

| Pillar | What it means in practice |
|---|---|
| **Trust before transaction** | Every UI moment reinforces that this is a trusted relationship, not a surveillance tool |
| **Calm, not flashy** | No gratuitous animations, no dopamine-loop patterns. Clarity over delight. |
| **Specifically Nigerian** | Cultural references, amounts in naira (₦), phone numbers as primary identity — not generic fintech |
| **Phone-to-phone is the mechanic** | NFC tap, pairing, face-to-face handshake — the physical gesture is the product |
| **Premium at accessible price** | Feels like a ₦10,000/month product even on the Free tier |

### 1.3 Brand personality

If Amana were a person: a composed, well-dressed accountant who is also your trusted older sibling. Authoritative but warm. Never cold. Never aggressive. Never desperate for attention.

**Tone of voice:**
- Short, direct sentences
- Active voice
- No jargon ("Send money to Amina" not "Initiate a NIP transfer to sub-wallet #347")
- Numbers in naira with commas: ₦1,500 not N1500 not 1500NGN
- Error messages tell you what to do next, not just what went wrong

---

## 2. Design Principles

### 2.1 Control feels like calm, not restriction

Rules should feel like guardrails, not handcuffs. When a limit is enforced, the UI tone is matter-of-fact ("₦12,000 limit reached for this week") not punitive.

### 2.2 The agent is a trusted person, not a fraud suspect

Agent-facing screens should feel dignified. No "suspicious activity" language. No red warning bars. Anomaly alerts are principal-only — agents never see their own score.

### 2.3 One action per screen

Each screen has a single primary action. Never show two competing CTAs at equal visual weight. Never bury the primary action below the fold.

### 2.4 Money deserves precision

Amounts are always shown in full naira with kobo if non-zero: **₦1,500** or **₦1,500.50** — never rounded to "₦1.5k" in transaction views. Abbreviations only in summary/list contexts where space is constrained.

### 2.5 Status is always visible

Transaction status, wallet balance, and bump state must be readable without a tap. Use status badges, not status icons alone.

### 2.6 Errors point forward

Every error state has a recovery action. Never a dead end. "Failed — try again" is incomplete. "Transfer failed. Check your internet connection and tap Retry." is complete.

---

## 3. Colour System *(corrected 2026-08-25)*

### 3.1 Shipped palette — `packages/ui/src/theme/tokens.ts`

Dark navy and gold. Two schemes, and the app **follows the OS**: `ThemeProvider` reads
`Appearance.getColorScheme()` and re-reads it on change. It defaults to **light** when the value is
`null`, which Android returns before the bridge resolves — defaulting to dark there would flash a
dark screen at a user who asked for light.

| Token | Dark | Light | Usage |
|---|---|---|---|
| `bg.base`     | `#0D1B2A` | `#F5F0E8` | Page background |
| `bg.surface`  | `#152535` | `#FFFFFF` | Cards, sheets, nav |
| `bg.raised`   | `#1C3147` | `#EDE8DF` | Raised rows, hover, pressed |
| `text.primary`   | `#F5F0E8` | `#0D1B2A` | Headings, amounts, body |
| `text.secondary` | `#8BA3B8` | `#8B9AAA` | Labels, hints |
| `text.muted`     | `#5A8CA8` | `#A0ADB8` | Timestamps, fine print |
| `accent`      | `#C9A227` | `#C9A227` | Gold. CTAs, active nav, one highlight per screen |
| `accentDim`   | `rgba(201,162,39,0.18)` | `rgba(201,162,39,0.15)` | Accent fill behind active states |
| `debit`       | `#FF6B6B` | `#C0392B` | Money leaving |
| `credit`      | `#52C49A` | `#2E8B57` | Money arriving |
| `border`      | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` | Hairlines |
| `borderAccent`| `rgba(201,162,39,0.18)` | `rgba(201,162,39,0.25)` | Emphasised card edge |

Note the accent is the **same gold in both schemes** while every other token flips. Gold is the one
thing that must read as Amana whichever scheme a screenshot is taken in.

`debit`/`credit` are **not** the same red and green across schemes: dark uses lighter, desaturated
values (`#FF6B6B`, `#52C49A`) because saturated red on near-black vibrates; light uses deeper ones
(`#C0392B`, `#2E8B57`) because the pale versions fail contrast on cream.

### 3.2 Superseded — v1.0 palette, never shipped

Kept for archaeology. If a mock uses these, it predates the design-system build.

| Token | Hex | Status |
|---|---|---|
| `--amana-green`       | `#1A6B4A` | Superseded by `accent` `#C9A227` |
| `--amana-green-light` | `#E8F5EE` | Dropped |
| `--amana-gold`        | `#C89A2E` | Nearly survived — the shipped gold is `#C9A227` |
| `--amana-charcoal`    | `#1C1C1E` | Superseded by `text.primary` (`#0D1B2A` light) |
| `--amana-slate`       | `#6B7280` | Superseded by `text.secondary` |
| `--amana-off-white`   | `#F5F5F0` | Nearly survived — the shipped base is `#F5F0E8` |

The near-misses are the useful part: the warm off-white and the gold are the two v1.0 ideas that
made it through the rebuild. The green did not.

### 3.3 Status colours

There are no dedicated status tokens. Status is expressed with the palette above: `credit` for
settled, `accent` for pending or in-flight, `debit` for failed or denied, `text.muted` for draft.
Adding a parallel status ramp would give two sources of truth for "what does failure look like".

**Anomaly is deliberately not red.** An anomaly score ≥ 0.85 is a *question*, not an accusation —
it renders in `accent`, the same gold as pending. Red is reserved for things that actually failed.

### 3.4 Colour usage rules

- Never use `debit` red for anything other than a genuine error, failure or denial
- Gold is a premium signal — one highlight per screen, maximum
- Body text is `text.primary` or `text.secondary`; never below 4.5:1 against its background
- Interactive elements must hold WCAG AA contrast against their surface in **both** schemes —
  checking only the one you develop in is how the light scheme rots

---

## 4. Typography *(corrected 2026-08-25)*

### 4.1 Typefaces — two, doing different jobs

**Georgia** — amounts and headings. A serif for money is a deliberate choice: it reads as ledger and
statement rather than as app chrome, and its numerals are unambiguous at a glance. It is also
present on every iOS and Android device, so no amount ever waits on a font download.

**Plus Jakarta Sans** — body, labels, buttons and captions (`PlusJakartaSans_400Regular`,
`_600SemiBold`, `_700Bold`). Loaded via `expo-font`; `ThemeProvider` takes a `fontsLoaded` prop and
renders a bare `bg.base` view until it is true, so text never flashes in a fallback face and reflows.

*Superseded:* v1.0 specified **Inter** throughout. Inter shipped nowhere.

### 4.2 Shipped type scale

| Token | Family | Size | Weight | Usage |
|---|---|---|---|---|
| `amount.xl` | Georgia | 32 | 700 | Hero balance (letter-spacing −0.5) |
| `amount.lg` | Georgia | 24 | 700 | Card balance (−0.5) |
| `amount.md` | Georgia | 18 | 700 | Row amount |
| `amount.sm` | Georgia | 14 | 700 | Inline amount in a sentence |
| `heading.lg` | Georgia | 20 | 700 | Screen title |
| `heading.md` | Georgia | 16 | 700 | Section header, card title |
| `body` | Plus Jakarta 400 | 14 | 400 | Body copy |
| `bodyStrong` | Plus Jakarta 600 | 14 | 600 | Emphasised body, names |
| `label` | Plus Jakarta 600 | 10 | 600 | UPPERCASE, letter-spacing 1.5 |
| `button` | Plus Jakarta 700 | 13 | 700 | UPPERCASE, letter-spacing 1 |
| `caption` | Plus Jakarta 400 | 11 | 400 | Timestamps, fine print |

**Amounts have their own ramp, four sizes deep.** That is the tell that this is a money product: an
amount is never "body text that happens to contain digits" — it always comes from `amount.*`.

### 4.3 Amount display convention

`formatNaira` (`apps/backend/src/lib/kobo.ts`) is the reference implementation, and it operates on
**bigint kobo** — the string is produced by integer arithmetic, never by formatting a float.

- `₦` prepended with no space: `₦12,500`, not `₦ 12,500`
- Thousands separated via `toLocaleString('en-NG')`
- **Kobo shown only when non-zero:** `₦12,500` and `₦12,500.50`, never `₦12,500.00`
- Large balance: `amount.xl`; list rows: `amount.md`

Suppressing `.00` is not cosmetic. Most Nigerian retail amounts are whole naira; showing two dead
zeros on every one of them trains the eye to skip the decimals, which is exactly the wrong habit for
the times they are not zero.

### 4.4 Spacing scale

Spacing tokens are **named for what they separate**, not for their size — `spacing.related` says why
12px, where `spacing.md` would not:

`hairline` 4 · `tight` 8 · `related` 12 · `cardV` 16 · `screenH` 20 · `section` 24 · `major` 32 ·
`safeBottom` 48

---

## 5. Component Patterns

### 5.1 Buttons

| Variant | Background | Text | Use case |
|---|---|---|---|
| Primary | `accent` (gold) | `bg.base` | Single primary CTA per screen |
| Secondary | transparent + `borderAccent` | `text.primary` | Secondary actions |
| Destructive | transparent + `debit` border | `debit` | Deny, cancel, delete |
| Ghost | transparent | `text.secondary` | Tertiary / skip |

**Gold-on-navy, not white-on-green.** Primary buttons put `bg.base` text on the gold accent — dark
text on gold, because white on `#C9A227` fails AA.

- Height: 52px (comfortable touch target)
- Border radius: 12px
- Label is `type.button` — uppercase, letter-spacing 1
- Full-width on mobile by default
- Loading state: replace label with spinner, disable, keep size stable

### 5.2 Cards

- Background: `bg.surface`; raised or pressed rows go to `bg.raised`
- Border: 1px `border` — **depth comes from the border, not a shadow.** A drop shadow on a
  `#152535` surface over a `#0D1B2A` page is invisible; the hairline is what separates them.
- Padding: `spacing.cardV` (16) vertical, `spacing.screenH` (20) horizontal
- Dividers between list items: 1px `border`

### 5.3 Status badges

- Pill shape (border-radius: 999px)
- Padding: 4px 10px
- `type.label` typography (uppercase, 10px, letter-spacing 1.5)
- Coloured from the palette per §3.3 — `credit` settled, `accent` pending, `debit` failed,
  `text.muted` draft
- Never use icons or colour alone — always badge **text** + colour

### 5.4 Transaction list rows

```
[Status dot] [Vendor name]          [Amount]
             [Category · Time]      [Status badge]
```

- Vendor name: `type.bodyStrong`
- Amount: `type.amount.md` (Georgia), right-aligned — an amount never uses a body token
- Status badge: right-aligned below amount
- Tap target: full row, minimum 64px height

### 5.5 Form inputs

- Height: 52px
- Border: 1px `border` (rest) / `accent` (focus) / `debit` (error)
- Label above input (not floating — simpler, more accessible), `type.label`
- Error message: 12px red below input, never tooltip

### 5.6 Empty states

Every list screen has a designed empty state:
- Illustration or icon (not a generic "no data" icon)
- Headline: what's missing
- Body: how to fix it
- CTA: one action that creates the first item

### 5.7 Loading states

- Skeleton screens (not spinners) for initial page loads
- Inline spinners for button actions (replace label)
- Pull-to-refresh for list screens
- Never block the full screen with a spinner after first load

---

## 6. Key Screen Descriptions

### 6.1 Principal — HomeScreen

**Purpose:** Top-level dashboard. Principal sees master wallet balance, sub-wallet summary, and recent transactions.

**Layout:**
- Top: greeting ("Good morning, Chukwuemeka") + master wallet balance card (`type.amount.xl` on `bg.surface`, gold hairline)
- Middle: horizontal scroll of sub-wallet cards (name, balance, agent name, status indicator)
- Bottom: recent transactions list (last 5, tap to see all)
- FAB or tab: "Pay" (principal direct spend)

**Key interaction:** Tap sub-wallet card → SubWalletDetailScreen

### 6.2 Principal — SubWalletDetailScreen

**Purpose:** Per-agent view. Spend summary, rules summary, snooze, recent transactions.

> **Corrected 2026-08-25.** v1.0 specified a **balance card** here. A sub-wallet has no balance —
> the funds model is **limits-only**, so a sub-wallet balance is structurally always ₦0.00, and the
> app did render exactly that for a while. It shows a **spend summary** instead.

**Layout:**
- Header: sub-wallet name + agent name + **spend summary** (spent against the limit, and what
  remains in the current window) — never a balance
- Rules summary: active rules as chips, rendered from the rule set by `summariseRule`
  (`apps/principal/src/lib/rule-summary.ts`) — never raw JSON
  (e.g., "₦20K/week · Food & transport · 7am–7pm · 1 shop approved")
- Snooze toggle: on/off + expiry time if active
- CTAs: "Edit rules" and "Choose shops" (the merchant rule — see APP-FLOW §6.1)
- Below: transaction list for this sub-wallet

### 6.3 Principal — BumpDecisionScreen

**Purpose:** One-tap bump approval. Must be fast — principal is often interrupted.

**Layout:**
- Agent name (large) + avatar initial
- Amount (`type.amount.xl`)
- Vendor name
- Agent's note (if provided)
- Three buttons: "Approve once" (primary), "Raise limit" (secondary), "Deny" (destructive)
- Timer: remaining seconds until expiry (visible but not panic-inducing)

**Key principle:** Primary action (Approve) is immediately tappable without scrolling.

### 6.4 Agent — CaptureMethodScreen

**Purpose:** Entry point for every payment. Quick access to recent vendors, plus three capture methods.

**Layout:**
- "Recents" section: last 3 vendors as tappable cards (name, bank, one-tap repeat)
- Three capture method buttons (equal visual weight): "Scan QR", "Phone number", "Bank account"

### 6.5 Agent — ConfirmScreen

**Purpose:** Final review before sending. Agent sees everything before committing.

**Layout:**
- Vendor name (large) + masked account
- Amount input (large, centered — this is the primary action)
- Category (auto-detected or selectable)
- Note field (optional, single line)
- GPS status (small: "Location captured" or "No location")
- Photo thumbnail (if attached) or "Add photo" link
- "Send ₦[amount]" primary button

### 6.6 Agent — SendingScreen

**Purpose:** Transition state while NIP transfer is in flight. Must feel active and reassuring.

**Layout:**
- Animated progress indicator (not a spinner — a branded animation or progress arc)
- Copy: "Sending to [vendor]..."
- Amount displayed
- No back button — this is a non-reversible action in flight

### 6.7 Transaction Detail Screen (both apps)

**Purpose:** Receipt-grade view. The document of record for disputes.

**Layout:**
- Status banner (full-width, colour-coded)
- Amount (`type.amount.xl`)
- Vendor: name + masked account (`***1234`) + bank name
- Sub-wallet label ("Amina's wallet" or "Direct spend")
- Initiator + role ("Amina · Agent" or "You · Principal")
- Timestamps: initiated + settled (if applicable)
- NIBSS session ID (monospace, copyable)
- Agent note (if present)
- Anomaly badge in `accent` gold, if score ≥ 0.85 — principal only. **Not red:** an anomaly is a
  question, not an accusation (§3.3).
- "View location" link (if GPS present)

### 6.8 Marketplace and VAS screens *(added 2026-08-25)*

Four screens shipped after v1.0. The flows are in [`APP-FLOW.md`](./APP-FLOW.md) §3.6 and §6; what
matters visually:

- **MarketplaceScreen** — the catalogue, already filtered to what this wallet's rules allow. The
  principal's copy carries the approval CTA and the running count ("1 shop approved").
  **There is no "everything on the platform" view**, in either app: showing an agent items they
  cannot buy would be an advertisement for a refusal.
- **MarketplaceItemScreen** — shows the **effective** price in `type.amount.lg`. A list price
  appears **only** when a deal is reducing it, struck through in `text.muted` beside the real one.
  Never a struck-through price equal to the price paid.
- **VoucherScreen** — the code is the screen: large, letter-spaced, high contrast, because it gets
  read aloud across a counter. Below it, what was paid, what was saved, and the expiry in plain
  words — "if you do not use it, the money goes back to the wallet".
- **TopUpScreen / TopUpReceiptScreen** — category chips, then provider, then recipient. A denial
  renders inline and **names the rule** (§5.6 applies — say how to fix it), never a generic error.

---

## 7. Accessibility Requirements

| Requirement          | Standard |
|---|---|
| Text contrast        | WCAG AA minimum (4.5:1 for body, 3:1 for large text)
| Touch targets        | Minimum 44×44px (Apple HIG / Android Material)
| Screen reader labels | All interactive elements have `accessibilityLabel` props
| Dynamic type support | Layouts must not break at iOS large text sizes
| Colour-blind safe | Status must never be communicated by colour alone (always badge text + colour) |
| Both schemes | Contrast must hold in **light and dark** — checking only the scheme you develop in is how the other one rots |
| Web (portal) | Focus always visible (`outline: 2px solid accent`), never `outline: none` |

---

## 8. Platform Notes

> **Verified against code 2026-08-25.** The NFC claims below were checked rather than assumed —
> `react-native-nfc-manager` is a dependency of both apps, `apps/agent/src/screens/NFCPairScreen.tsx`
> exists, and `PairingMethodScreen.tsx:44` gates the NFC option behind `Platform.OS === 'android'`.
> Everything in this section stands.

### iOS
- Safe area insets respected via `SafeAreaView` on all screens
- NFC pairing is not available (OS limitation) — show QR path only
- Sheet presentations for modals (`modal` navigation type)
- SF Symbols not used — icon library is consistent cross-platform

### Android
- NFC pairing is the marquee feature — "Tap phones" should be prominently featured
- Back button navigation handled via React Navigation back handler
- Material Design 3 system colours not adopted — Amana's own system overrides
- Bottom sheet for modals where appropriate (matches Android patterns)

### Both
- **Dark mode ships, and follows the OS.** *(Corrected 2026-08-25 — v1.0 said "not in MVP scope,
  light mode only", which is false, and was the most misleading line in this document.)*
  `ThemeProvider` reads `Appearance.getColorScheme()` and re-reads it on change, defaulting to
  **light** when the value is `null` — Android returns `null` before bridge resolution, and
  defaulting to dark there would flash a dark screen at someone who asked for light. Both ramps
  are in §3.1.
- Fonts load via `expo-font`; `ThemeProvider` renders a bare `bg.base` view until `fontsLoaded`,
  so text never flashes in a fallback face and reflows.
- Minimum OS versions: iOS 15+, Android 10 (API 29)+

### Web — retailer portal
Not React Native. Next.js 14, its own stylesheet, dark-only, no webfonts. Full treatment in §9.

---

## 9. Retailer portal *(added 2026-08-25)*

`apps/retailer-portal` — Next.js 14 App Router, served on :3300. A retailer opens a web page; they
install nothing. This is the third surface and the only one that is not React Native.

### 9.1 The duplication, and why it is accepted

`@amana/ui` **ships raw React Native source** (no build step — Metro transpiles it). A Next.js app
cannot consume that. So the portal keeps its own stylesheet, `app/globals.css`, and the tokens are
duplicated **once**, at the top of that file, as CSS custom properties.

That is real debt. It is written down at both sites — a comment block in `globals.css` naming
`packages/ui/src/theme/tokens.ts` as the origin, and this section — rather than left for someone to
discover from a screenshot that looks slightly off. **If the tokens change, that file has to change
with them.**

The alternatives were worse: extracting a framework-neutral token package for one consumer is
speculative structure, and building `@amana/ui` for web would put a build step in the path of every
mobile edit to buy nothing for mobile.

### 9.2 Known drift in the copy — as of 2026-08-25

Auditing the copy against the source found three divergences. Listing them is the point of the
section — a duplicate whose drift nobody tracks is just two designs.

| | `packages/ui` | portal | |
|---|---|---|---|
| `border` | `rgba(255,255,255,0.06)` | was `0.08` | **Copy error. Fixed 2026-08-25** — found by this audit, not by eye. |
| Scheme | follows the OS | dark only | Tolerated — see below |
| Typeface | Georgia + Plus Jakarta Sans | `system-ui` | Tolerated — see below |

The first row is the argument for keeping this table: an alpha two hundredths off is invisible in
review and invisible in a screenshot, and it only surfaced because something read the two files
side by side. Assume there will be another one.

**Dark only.** The portal hardcodes the dark ramp; there is no `prefers-color-scheme` block. A
retailer uses this at a counter for thirty seconds to redeem a code, not all day. Shipping a light
scheme nobody asked for doubles the contrast surface to check on every change.

**No webfonts.** `system-ui` throughout — no Georgia for amounts, no Plus Jakarta for body. Amounts
instead get `font-variant-numeric: tabular-nums` so columns of naira align on the decimal, which is
the property that actually mattered about the serif. A retailer on a slow Lagos connection should
not wait on a font to find out whether they got paid.

### 9.3 Component vocabulary

Small on purpose — one stylesheet, no component library, no CSS-in-JS:

- **`.shell`** — a 232px fixed nav beside the content. Current page marked with
  `aria-current="page"`, styled with `accent` on `accentDim` (never colour alone).
- **`.card`** — `bg.surface` on a hairline border. The only container.
- **`.pill`** — status. `.ok` credit-green, `.warn` gold, `.bad` debit-red — each pairs its colour
  with a **word**, so status never depends on hue.
- **`.banner`** / **`.banner.bad`** — account-level state, above the content. This is where
  *suspended* is explained, and it says what a suspended retailer **can** still do (redeem vouchers
  already sold, and be paid for them) rather than only what they cannot.
- **`.stats`** — auto-fit grid, min 170px, for the earnings figures. `tabular-nums`, and the label
  above the number rather than beside it, so the numbers form a single scannable column.
- **`.table-wrap`** — every table scrolls inside its own `overflow-x: auto`. The page body must
  never scroll sideways; a retailer on a phone browser loses the first column otherwise.

### 9.4 Portal-specific rules

- **Never show a balance.** Earnings screens show settlement *history* — paid to your bank, on its
  way, earned in total. Amana holds no retailer funds, and a figure that looks like a balance would
  imply it does.
- **"Redeemed, payout delayed" is not an error state.** It uses `.banner`, not `.banner.bad`. The
  voucher is spent and the customer was served; only the transfer is retrying. Styling it as a
  failure would send a retailer to support over something already working.
- **Focus is visible and gold** — `outline: 2px solid var(--accent)` with an offset, never
  `outline: none`. This is a form-heavy app used by people who may be tabbing through it fast.

