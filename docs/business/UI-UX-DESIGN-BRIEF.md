# Amana — UI/UX Design Brief

**Version:** 1.0 | **Date:** 2026-05-13
**Audience:** Product designer, UI engineer, design agency
**Apps:** Principal (iOS + Android) · Agent (Android first)

> **Executive summary:** Amana is a financial control product, not a payments utility. The design must communicate calm authority — the feeling that the principal is in control, the agent is trusted but bounded, and money is handled with the seriousness it deserves. The aesthetic is premium Nigerian: warm, grounded, modern without being generic. This brief covers brand identity, design principles, colour and typography system, component patterns, and key screen descriptions for both apps.

---

## 1. Brand Identity

### 1.1 Name & etymology

**Amana** — from Hausa and Arabic-rooted: *trust, safekeeping, something held in trust for another.* The name encodes the product's core promise before a word is read.

### 1.2 Brand pillars

| Pillar | What it means in practice |
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

## 3. Colour System

### 3.1 Primary palette

| Token                 | Hex       | Usage |
| `--amana-green`       | `#1A6B4A` | Primary brand. CTAs, active states, positive status 
| `--amana-green-light` | `#E8F5EE` | Green tint backgrounds, success surfaces 
| `--amana-gold`        | `#C89A2E` | Accent. Premium tier indicators, highlight 
| `--amana-charcoal`    | `#1C1C1E` | Primary text, headings 
| `--amana-slate`       | `#6B7280` | Secondary text, labels, hints 
| `--amana-white`       | `#FFFFFF` | Backgrounds, cards 
| `--amana-off-white`   | `#F5F5F0` | Page background (slightly warm, not stark white) 

### 3.2 Semantic colours

| Token              | Hex       | Usage |
| `--status-settled` | `#1A6B4A` | Settled transaction badge 
| `--status-pending` | `#C89A2E` | Pending, in-flight 
| `--status-failed`  | `#DC2626` | Failed, denied, error 
| `--status-draft`   | `#9CA3AF` | Draft, rule_eval 
| `--anomaly-amber`  | `#F59E0B` | Anomaly badge (score ≥ 0.85) — not red (not accusatory) 

### 3.3 Colour usage rules

- Never use red for anything other than genuine errors or failures
- Gold (`--amana-gold`) is a premium signal — use sparingly (plan tier badges, one highlight per screen max)
- Body text must always be `--amana-charcoal` or `--amana-slate`; never below 4.5:1 contrast ratio
- Interactive elements must maintain WCAG AA contrast against their background

---

## 4. Typography

### 4.1 Typeface

**Primary:** Inter (Google Fonts — free, excellent Latin + number rendering)
**Fallback:** System UI (SF Pro on iOS, Roboto on Android)

Inter is chosen over display typefaces because:
- Numbers render cleanly at all sizes (critical for amount display)
- Available cross-platform without licensing cost
- Neutral enough to not distract from content

### 4.2 Type scale

| Token          | Size | Weight | Line height | Usage |
| `display`      | 32px | 700    | 40px | Hero amounts, large balance display 
| `heading-1`    | 24px | 700    | 32px | Screen titles 
| `heading-2`    | 20px | 600    | 28px | Section headers, card titles 
| `body-large`   | 16px | 400    | 24px | Primary body copy 
| `body`         | 14px | 400    | 20px | Secondary body, descriptions 
| `label`        | 12px | 500    | 16px | Form labels, status badges 
| `caption`      | 11px | 400    | 14px | Timestamps, fine print 

### 4.3 Amount display convention

- Large balance / key amount: `display` weight 700, `--amana-charcoal`
- Amount in list rows: `body-large` weight 600
- Kobo shown as superscript `.50` only when non-zero
- Always prepend `₦` with no space: `₦12,500` not `₦ 12,500`

---

## 5. Component Patterns

### 5.1 Buttons

| Variant             | Background                           | Text                   | Use case |
| Primary             | `--amana-green`                      | White                  | Single primary CTA per screen 
| Secondary           | Transparent + `--amana-green` border | `--amana-green`        | Secondary actions 
| Destructive         | `#FEF2F2` + `--status-failed` border | `--status-failed`      | Deny, cancel, delete 
| Ghost               | Transparent                          | `--amana-slate`        | Tertiary / skip 

- Height: 52px (comfortable touch target)
- Border radius: 12px
- Full-width on mobile by default
- Loading state: replace label with spinner, disable, keep size stable

### 5.2 Cards

- Background: `--amana-white`
- Border radius: 16px
- Shadow: `0 1px 3px rgba(0,0,0,0.08)` — subtle depth, not floating
- Padding: 16px
- Dividers between list items: 1px `#E5E7EB`

### 5.3 Status badges

- Pill shape (border-radius: 999px)
- Padding: 4px 10px
- `label` typography
- Colour-coded per semantic colour system
- Never use icons alone — always badge text + colour

### 5.4 Transaction list rows

```
[Status dot] [Vendor name]          [Amount]
             [Category · Time]      [Status badge]
```

- Vendor name: `body-large` 600
- Amount: `body-large` 600, right-aligned
- Status badge: right-aligned below amount
- Tap target: full row, minimum 64px height

### 5.5 Form inputs

- Height: 52px
- Border: 1px `#E5E7EB` (rest) / `--amana-green` (focus) / `--status-failed` (error)
- Border radius: 12px
- Label above input (not floating — simpler, more accessible)
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
- Top: greeting ("Good morning, Chukwuemeka") + master wallet balance card (`display` type, `--amana-green` background)
- Middle: horizontal scroll of sub-wallet cards (name, balance, agent name, status indicator)
- Bottom: recent transactions list (last 5, tap to see all)
- FAB or tab: "Pay" (principal direct spend)

**Key interaction:** Tap sub-wallet card → SubWalletDetailScreen

### 6.2 Principal — SubWalletDetailScreen

**Purpose:** Per-agent view. Balance, rules summary, snooze, recent transactions.

**Layout:**
- Header: sub-wallet name + agent name + balance card
- Rules summary: active rules as chips (e.g., "₦20K/week · Food & transport · 7am–7pm")
- Snooze toggle: on/off + expiry time if active
- CTA: "Edit rules"
- Below: transaction list for this sub-wallet

### 6.3 Principal — BumpDecisionScreen

**Purpose:** One-tap bump approval. Must be fast — principal is often interrupted.

**Layout:**
- Agent name (large) + avatar initial
- Amount (large, `display` type)
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
- Amount (large, `display` type)
- Vendor: name + masked account (`***1234`) + bank name
- Sub-wallet label ("Amina's wallet" or "Direct spend")
- Initiator + role ("Amina · Agent" or "You · Principal")
- Timestamps: initiated + settled (if applicable)
- NIBSS session ID (monospace, copyable)
- Agent note (if present)
- Anomaly badge (amber, if score ≥ 0.85) — principal only
- "View location" link (if GPS present)

---

## 7. Accessibility Requirements

| Requirement          | Standard |
| Text contrast        | WCAG AA minimum (4.5:1 for body, 3:1 for large text) 
| Touch targets        | Minimum 44×44px (Apple HIG / Android Material) 
| Screen reader labels | All interactive elements have `accessibilityLabel` props 
| Dynamic type support | Layouts must not break at iOS large text sizes 
| Colour-blind safe    | Status must never be communicated by colour alone (always badge text + colour) 

---

## 8. Platform Notes

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
- Dark mode: not in MVP scope. Light mode only. `StatusBar` style set to `dark-content`.
- Minimum OS versions: iOS 15+, Android 10 (API 29)+
