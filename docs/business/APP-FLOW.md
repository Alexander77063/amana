# Amana — App Flow


> **Refreshed 2026-08-25.** Three surfaces that did not exist when this was written have been
> added: digital VAS (§3.6), the buyer marketplace and the control fusion (§6), and the retailer
> portal (§7).
>
> **Amended 2026-08-26 (SP-V3).** §3.2's agent scan step now branches on payload shape — an Amana
> Vendor Code and a bank NQR go to different endpoints from one camera. And the 2026-08-25 refresh
> was wrong on one point: it said "the principal and agent wallet flows were accurate and are
> unchanged". The **agent** flows were. The **principal** capture flow (§1.1's `PayTab`, and all of
> §2.5) documents screens that do not exist in `apps/principal/src/` and never have; both are now
> marked. Found by diffing the file listing before adding the vendor-code branch to it.
>
> **Amended 2026-08-27.** New **§8, the vendor arc** — the passive registry, the claim rail and the
> payable code. These shipped across SP-V1/V2/V3 and had **no flow here at all**; §7.1 covers a
> different rail (the marketplace retailer), with a different actor. §8 is written from the code as
> it stands after PR #50 rather than from the sub-plans, which document the pre-Gate-3 claim shape
> and remain correct as history. It also carries the only actor in this document who is **not an
> Amana user** — the shopkeeper being paid.
>
> Index: [`docs/product/README.md`](../product/README.md)

**Version:** 1.0 | **Date:** 2026-05-13
**Apps covered:** Principal (iOS + Android) · Agent (Android first, iOS secondary) · plus two
surfaces belonging to neither app: the retailer portal (§7, web) and the vendor claim rail and
public code page (§8, web + unauthenticated)

> **Executive summary:** Amana has two separate mobile apps — Principal and Agent — built in React Native (Expo). The principal controls and funds; the agent spends within rules. This document maps every screen, transition, and deep-link in both apps, plus the shared transaction lifecycle that connects them.

---

## 1. Navigation Architecture

### 1.1 Principal App

```
RootNavigator
├── BootScreen (loading — checks auth token)
├── AuthStack
│   ├── PhoneScreen → VerifyScreen (OTP)
│   └── RegisterScreen (BVN + NIN, first login only)
├── PairingStack (if no household yet)
│   ├── WelcomeScreen
│   ├── CreateHouseholdScreen
│   └── PairingSuccessScreen
└── MainStack (authenticated + household exists)
    ├── MainTabs
    │   ├── HomeTab → HomeScreen
    │   ├── WalletsTab → SubWalletListScreen
    │   │               └── SubWalletDetailScreen
    │   │                   └── SubWalletRulesScreen
    │   ├── PayTab → [vendor capture flow]   ← NOT BUILT; see the note on §2.5
    │   └── InboxTab → NotificationsInboxScreen
    │                  └── TransactionDetailScreen (deep-link target)
    ├── TransactionDetailScreen (standalone — deep-link)
    └── BumpDecisionScreen (deep-link target for bump_requested)
```

### 1.2 Agent App

```
RootNavigator
├── BootScreen (loading — checks auth token)
├── AuthStack
│   ├── PhoneScreen → VerifyScreen (OTP)
│   └── RegisterScreen (NIN only)
├── PairingStack (if not paired yet)
│   ├── PairingIntroScreen
│   ├── NfcPairingScreen (Android)
│   ├── QrPairingScreen
│   ├── SmsPairingScreen (deep-link entry)
│   └── PairingCompleteScreen
└── MainNavigator (authenticated + paired)
    ├── MainTabs
    │   ├── HomeTab → HomeScreen
    │   ├── PayTab → PayStack
    │   │   ├── CaptureMethodScreen
    │   │   ├── NQRScanScreen        (reads NQR *and* Amana Vendor Codes)
    │   │   ├── PhoneLookupScreen
    │   │   ├── AccountEntryScreen
    │   │   ├── ConfirmScreen
    │   │   ├── SendingScreen
    │   │   ├── ReceiptScreen
    │   │   └── FailedScreen
    │   ├── HistoryTab → TransactionListScreen
    │   │               └── TransactionDetailScreen
    │   └── SettingsTab → SettingsScreen
    │                     └── EnableNotificationsScreen
    └── PhotoAttachScreen (modal — from ConfirmScreen or ReceiptScreen)
```

---

## 2. Principal App Flows

### 2.1 Onboarding

```
App open
  └── BootScreen
        ├── [has valid token] → MainStack
        └── [no token] → PhoneScreen

PhoneScreen → enters phone number → POST /auth/otp/request
  └── VerifyScreen → enters 6-digit OTP → POST /auth/otp/verify
        ├── [existing user, has household] → MainStack
        ├── [existing user, no household] → PairingStack
        └── [new user] → RegisterScreen
                          → enters BVN + NIN → POST /auth/register
                            └── PairingStack
```

### 2.2 Household Setup

```
PairingStack
  └── WelcomeScreen
        └── CreateHouseholdScreen → POST /households
              └── PairingSuccessScreen → MainStack
```

### 2.3 Inviting an Agent

```
HomeScreen → "Add agent" button
  └── PairingInitScreen → POST /pairing → receives {token, deepLink}
        ├── NFC: write deepLink to NFC tag → agent taps phone
        ├── QR: display deepLink as QR → agent scans
        └── SMS: share deepLink → agent opens on their phone
```

### 2.4 Sub-wallet Management

```
WalletsTab → SubWalletListScreen (GET /households/:id/sub-wallets)
  └── tap sub-wallet → SubWalletDetailScreen (GET /sub-wallets/:id)
        ├── balance card (GET /sub-wallets/:id/balance)
        ├── snooze toggle (PUT/DELETE /sub-wallets/:id/snooze)
        ├── "Edit rules" → SubWalletRulesScreen
        │     └── POST /sub-wallets/:id/rules (creates new rule set version)
        └── recent transactions list
```

### 2.5 Principal Direct Spend

> ⚠️ **NOT BUILT IN THE PRINCIPAL APP — verified 2026-08-26.** The server side of this is real
> (`subWalletId: null` direct spend, decision #17); the client side never was. `apps/principal/src/`
> has no `PayTab`, no `PayStack`, no `CaptureMethodScreen`, no `NqrScanScreen` and no
> `ConfirmScreen`, and `expo-camera` is a dependency of `apps/agent` alone. **A principal cannot
> scan anything today** — not an NQR and not an Amana Vendor Code. SP-V3's plan called for
> "mirroring" the vendor-code branch into this app; there was nothing to mirror, and building it
> means building decision #17's client half end to end. Read the tree below as the intended design,
> not as shipped behaviour. See
> [`docs/runbook/vendor-registry.md`](../runbook/vendor-registry.md) → "What SP-V3 did NOT ship".

```
PayTab → CaptureMethodScreen
  ├── NQR scan → POST /vendors/nqr-decode
  ├── Phone lookup → GET /vendors/phone-lookup
  └── Account entry → GET /vendors/name-enquiry
        └── ConfirmScreen
              ├── (optional) GPS capture
              └── Confirm → POST /transactions/intent
                            → POST /transactions/:id/evaluate
                            → POST /transactions/:id/send
                                  ├── [settled] → ReceiptScreen
                                  └── [failed] → FailedScreen
```

*Note: Principal direct spend bypasses rule engine — evaluate always returns `allow`.*

### 2.6 Inbox & Notifications

```
InboxTab → NotificationsInboxScreen (GET /me/notifications)
  ├── tap txn_settled / txn_failed / anomaly_alert / refund_received
  │     └── → TransactionDetailScreen (GET /transactions/:id)
  └── tap bump_requested
        └── → BumpDecisionScreen

BumpDecisionScreen (GET /me/bumps)
  ├── Approve once → POST /bumps/:id/decision {outcome: 'approved_once'}
  ├── Raise limit  → POST /bumps/:id/decision {outcome: 'raise_limit'}
  └── Deny         → POST /bumps/:id/decision {outcome: 'denied'}
```

### 2.7 Transaction Detail

```
TransactionDetailScreen (deep-link: amana://transaction/:id)
  ├── Fetches: GET /transactions/:id
  ├── Refetches on screen focus
  ├── Shows: amount, status badge, vendor + masked account,
  │           sub-wallet label (or "Direct spend"), initiator + role,
  │           initiated_at, settled_at, NIBSS session ID,
  │           agent note, anomaly badge (score ≥ 0.85),
  │           "View location" link (if geolocation present)
  └── [anomaly badge] shows score and alert copy
```

---

## 3. Agent App Flows

### 3.1 Onboarding & Pairing

```
App open
  └── BootScreen
        ├── [paired + token] → MainNavigator
        └── [no token] → AuthStack

AuthStack
  └── PhoneScreen → VerifyScreen → OTP verify
        ├── [existing user, paired] → MainNavigator
        └── [new or unpaired] → PairingStack

PairingStack
  ├── PairingIntroScreen
  │     ├── "Tap phones" (NFC, Android) → NfcPairingScreen
  │     │     → reads deepLink from NFC tag → POST /pairing/complete
  │     ├── "Scan QR" → QrPairingScreen → scans QR → POST /pairing/complete
  │     └── [SMS deep-link] → SmsPairingScreen → POST /pairing/complete
  └── PairingCompleteScreen → MainNavigator
```

### 3.2 Payment Flow (core loop)

```
HomeScreen → "Pay" button  OR  PayTab
  └── CaptureMethodScreen
        ├── recent vendor cards → skip to ConfirmScreen with pre-filled vendor
        ├── "Scan QR" → NQRScanScreen        ← ONE camera, two payload kinds
        │     → camera scans QR → parseScannedPayload() branches on SHAPE
        │           ├── [Amana Vendor Code — bare AMNV-XXXXX-XXXXX, or a
        │           │    pay.amana-ng.com/v/<code> URL on the anchored host]
        │           │     → GET /vendors/code/:code?subWalletId=…
        │           │     → result carries vendorId + category
        │           │     → ConfirmScreen (Verified badge; category pre-filled)
        │           └── [anything else — NIBSS TLV, or unrecognised]
        │                 → POST /vendors/nqr-decode
        │                 → ConfirmScreen
        │     → on failure: describeScanFailure() replaces the camera with one
        │       sentence, and offers TRY AGAIN only on the retryable rungs
        │       (0 / 429 / 502 / 503) — never on 404 / 409 / 410
        ├── "Phone number" → PhoneLookupScreen
        │     → enter phone → GET /vendors/phone-lookup
        │     → confirm name → ConfirmScreen
        └── "Bank account" → AccountEntryScreen
              → enter account + select bank → GET /vendors/name-enquiry
              → confirm name → ConfirmScreen

ConfirmScreen
  ├── enter amount
  ├── enter note (optional)
  ├── [GPS captured automatically if permission granted]
  ├── "Add photo" → PhotoAttachScreen (modal)
  │     → camera capture → POST /media/upload-url → PUT to S3
  │     → returns to ConfirmScreen with photo attached
  └── "Send" → POST /transactions/intent
               → POST /transactions/:id/evaluate
                     ├── [allow] → POST /transactions/:id/send
                     │             → SendingScreen (polling + push listener)
                     │                   ├── [txn_settled push] → ReceiptScreen
                     │                   ├── [txn_failed push]  → FailedScreen
                     │                   └── [poll timeout]     → FailedScreen
                     └── [bump_pending] → BumpWaitScreen
```

### 3.3 Bump Flow (agent side)

```
BumpWaitScreen
  ├── shows: vendor, amount, "waiting for approval"
  ├── countdown timer (bump TTL)
  ├── "Cancel bump" → DELETE /transactions/:id/bump → CaptureMethodScreen
  └── [bump_decided push received]
        ├── [approved] → POST /transactions/:id/resume-after-bump
        │               → SendingScreen → ReceiptScreen
        └── [denied]   → FailedScreen
```

### 3.4 Transaction History

```
HistoryTab → TransactionListScreen
  └── GET /sub-wallets/:id/transactions (cursor pagination, 20/page)
        └── tap transaction → TransactionDetailScreen
              → GET /transactions/:id (agent view)
```

### 3.5 Settings

```
SettingsTab → SettingsScreen
  ├── wallet name display
  ├── push notification status
  ├── "Enable notifications" → EnableNotificationsScreen
  │     → Expo.requestPermissionsAsync()
  │     → POST /devices (register token)
  └── logout → POST /auth/logout → AuthStack
```

---

### 3.6 Buying airtime, data or a bill *(added 2026-08-25)*

```
HomeScreen → "Buy airtime, data or pay a bill"
  └── TopUpScreen
        ├── category chips: Airtime · Data · Electricity · Cable TV
        ├── select provider (GET /vas/billers?category=…)
        ├── enter recipient
        │     ├── airtime / data  → phone number
        │     ├── electricity     → meter number  → validate (GET /vas/validate)
        │     └── cable TV        → smartcard no. → validate  ← resolves the ACCOUNT HOLDER
        │                                                        before any money moves
        ├── enter amount (or pick a fixed bundle)
        └── "BUY"  → POST /vas/purchase
              ├── 201 → TopUpReceiptScreen  (electricity returns a prepaid token)
              └── 409 rule_denied → inline reason
                    "Your parent has not allowed this category"
```

**The point of this flow is the refusal.** Airtime is a spend, so the parent's category lock reaches
it. Before that was true, a locked wallet could buy airtime freely — a hole, not a feature gap.

**Known gap:** an out-of-rule VAS purchase rejects rather than raising a bump. The agent is told
which rule stopped them, but cannot ask from here.

---

## 4. Shared Flows

### 4.1 Push → Deep-link navigation

Both apps handle incoming push notifications while foregrounded and via `navigateForResponse` on cold-start:

| Notification kind | Principal app destination | Agent app destination |
|---|---|---|
| `txn_settled` | TransactionDetailScreen | TransactionDetailScreen |
| `txn_failed` | TransactionDetailScreen | FailedScreen |
| `bump_requested` | BumpDecisionScreen | — |
| `bump_decided` | — | BumpWaitScreen (auto-resumes or fails) |
| `anomaly_alert` | TransactionDetailScreen | — |
| `refund_received` | TransactionDetailScreen | — |

Deep-link format:
- `amana://transaction/:transactionId`
- `amana://bump/:bumpRequestId`

### 4.2 NFC pairing sequence

```
Principal app                          Agent app
─────────────────────────────────────────────────────
POST /pairing → {token, deepLink}
Write deepLink to NFC tag
                                        NFC tap → read tag
                                        Parse deepLink
                                        POST /pairing/complete {token}
                                        ← household + sub-wallet assigned
                                        PairingCompleteScreen
```

---

## 5. Transaction Lifecycle State Machine

```
                    ┌──────────────┐
                    │    draft     │
                    └──────┬───────┘
                           │ POST /evaluate
                  ┌────────┴─────────┐
                  ▼                  ▼
           ┌───────────┐     ┌──────────────┐
           │ rule_eval │     │ (direct spend│
           └─────┬─────┘     │  → in_flight)│
                 │           └──────┬───────┘
        ┌────────┴────────┐         │
        ▼                 ▼         │
  ┌──────────┐    ┌─────────────┐   │
  │  allow   │    │bump_pending │   │
  └────┬─────┘    └──────┬──────┘   │
       │                │           │
       │          ┌─────┴─────┐     │
       │          │ approved  │     │
       │          └─────┬─────┘     │
       │                │           │
       └────────────────┘           │
                │                   │
                ▼                   │
           ┌──────────┐◄────────────┘
           │ in_flight│
           └────┬─────┘
                │ Anchor webhook
        ┌───────┴────────┐
        ▼                ▼
   ┌─────────┐      ┌────────┐
   │ settled │      │ failed │
   └─────────┘      └────────┘
        │
        │ refund
        ▼
   ┌──────────┐
   │ reversed │
   └──────────┘
```

---

## 6. Marketplace flows *(added 2026-08-25)*

### 6.1 The control fusion — the sequence is the argument

Read top to bottom. The ORDER is the product claim: the catalogue narrows because a rule was
written, not because a marketplace setting was toggled.

```
AGENT                                   PRINCIPAL
─────                                   ─────────
HomeScreen
  └── "SHOP WITH THIS WALLET"
        └── MarketplaceScreen
              GET /marketplace/items
              → sees the shops their CATEGORY LOCK already allows
                (two kitchens; not everything on the platform)

                                        SubWalletDetail → "Choose shops"
                                          └── MarketplaceScreen
                                                "Any approved shop.
                                                 Approve one below to limit
                                                 this wallet to only the
                                                 shops you choose."
                                                └── "APPROVE THIS SHOP"
                                                      POST /marketplace/merchants/approve
                                                      ⇒ WRITES a `merchant` rule into the
                                                        SAME rule set as the limit and the
                                                        category lock
                                                      → "1 shop approved."
  (reopens marketplace)
  └── sees ONLY the approved shop
        the other kitchen is gone
```

**Three states, and they are not two:** no `merchant` rule = unrestricted; a populated list = only
those; an EMPTY list = nothing may be bought. Revoking the last shop closes the marketplace rather
than reopening it.

### 6.2 Buy → voucher

```
MarketplaceScreen → tap an item
  └── MarketplaceItemScreen
        ├── price shown is the EFFECTIVE price (deal applied), never the list price
        ├── list price appears only when a deal is reducing it, struck through beside the real one
        └── "BUY VOUCHER" → POST /marketplace/purchase { subWalletId, catalogItemId }
              ├── 201 → VoucherScreen
              │     ├── the code, large and spaced — read aloud across a counter
              │     ├── what was paid, and what was saved if a deal applied
              │     └── valid until … "if you do not use it, the money goes back to the wallet"
              └── 409 rule_denied → the specific rule is named:
                    CATEGORY_NOT_ALLOWED  → "This is not one of the things you are allowed to buy."
                    MERCHANT_NOT_ALLOWED  → "This shop has not been approved for your wallet."
                    OUTSIDE_TIME_WINDOW   → "This is outside the hours you are allowed to spend in."
                    LIMIT_EXCEEDED        → "This would go over your spending limit."
```

Naming the rule matters: "something went wrong" leaves an agent unable to tell whether to ask their
parent or simply wait until morning.

---

## 7. Retailer portal flows *(added 2026-08-25)*

A separate Next.js web app (`apps/retailer-portal`, port 3300), not a mobile app. The retailer
opens a web page; they do not install anything.

### 7.1 Claiming the business

```
ops (admin key)                         RETAILER OWNER
───────────────                         ──────────────
POST /retailers  { businessName,
                   payout account }
  → records the CONTACT PHONE the
    owner will sign in with
                                        opens the portal → SignIn
                                          ├── phone number → "Send code"
                                          ├── six-digit code
                                          └── NIN — first sign-in only, offered UP FRONT
                                                POST /retailer/auth/otp/verify
                                                ⇒ creates the owner user (role: retailer)
                                                ⇒ CLAIMS the retailer
```

**Why the NIN sits on the form from the start:** the server cannot know a NIN is needed until it has
verified the code — and verifying CONSUMES it. Revealing the requirement afterwards leaves the owner
holding a spent OTP. Checking first would answer "does this number have a retailer waiting?" for
anyone who asks.

**There is no self-registration.** A business nobody vetted must not be able to appear by signing up.

### 7.2 Running the shop

```
Business & KYB → submit BVN (+ CAC if registered) → POST /retailer/me/kyb → kyb_pending
                 ⇒ Anchor rules on it → kyb.approved → approved (stamps approved_at)
                                      → kyb.rejected → suspended (approved_at stays NULL)
Storefront    → add a service: name, price (₦), section, SPENDING CATEGORY, duration
                 ⇒ the category is what a parent's lock matches on — NOT the free-text section
Deals         → percentage or fixed amount, over a window; pause / resume / end (end is terminal)
Redeem        → type the voucher code → "Service delivered"
                 ├── redeemed → payout on its way to the retailer's own bank
                 └── redeemed, payout delayed → the voucher IS used and the customer served;
                       the transfer is retried. NOT reported as a failure.
Orders        → every voucher bought, newest first, paginated
Earnings      → paid to your bank · on its way · earned in total · vouchers redeemed
                 ⇒ settlement HISTORY, never a balance — Amana holds no retailer funds
```

**Suspended is asymmetric, and the banner says so:** a suspended retailer cannot publish or run
deals, but can still redeem vouchers already sold, and those payouts still reach them. The buyer
already paid; stranding them to punish the retailer puts the cost on the wrong party.

---

## 8. Vendor arc — registry, claim rail, payable code *(added 2026-08-27)*

Three surfaces that no other section covers, and the only ones with an actor who is **not an Amana
user**: the shopkeeper being paid. Written from the code as it stands after PR #50, not from the
sub-plans — the sub-plan documents show the pre-Gate-3 claim shape and are correct as history.

Detail lives in [`runbook/vendor-registry.md`](../runbook/vendor-registry.md) and
[`runbook/vendor-claim.md`](../runbook/vendor-claim.md).

### 8.1 The registry builds itself — nobody signs up

```
AGENT pays a vendor by NIP (§3.2)
  └── transfer.completed webhook → settlementService.finalise
        └── vendorObservationService.recordSettlement   ← AFTER the settlement commits
              ⇒ one row in vendor_observations: household, bank code, account, name, category
              ⇒ NEVER THROWS. A registry fault must not turn a paid transfer into an error,
                 and a dropped observation is statistically harmless.

hourly sweep, 17 * * * *  (offset off :00 — the recon sweep already runs there)
  ├── promote     ≥ VENDOR_REGISTRY_MIN_HOUSEHOLDS (5) DISTINCT households
  │                 → vendors row, status = observed
  ├── categorise  ≥ CONSENSUS_MIN_HOUSEHOLDS (8) at ≥ CONSENSUS_RATIO (0.6) agreement
  └── expire      abandoned claim attempts released
```

**Distinct households, not payments.** One household paying fifty times promotes nothing — the
threshold is a statement about how many separate people recognise this account as a business, which
is exactly the aggregate the claim rail then has to avoid leaking (§8.2).

**The consensus floor sits ABOVE the promotion floor deliberately**, so a vendor is never promoted
and categorised in the same sweep. An inferred category also never *enforces* — only a claimed or
ops-set one does.

```
observed ──(claim rail §8.2, or ops approve-claim)──▶ claimed ──(ops)──▶ suspended
```

### 8.2 A shopkeeper claims their account — phone first, account second

The ordering is the security property, not a UX preference (**PRE-LAUNCH GATE 3**, closed
2026-08-27).

```
SHOPKEEPER (no Amana account, never signed in)
  └── POST /vendor-claim/request   { phone }              ← a phone and NOTHING else
        ⇒ ALWAYS sends a code. 202 {"status":"pending_verification"}, always.
        ⇒ nothing is bound to a vendor yet, and no attempt row exists

  └── POST /vendor-claim/verify    { phone, code, bankCode, accountNumber, category }
        ├── OTP checked FIRST — a junk code never reaches a paid Anchor call
        ├── then the account is resolved, then NIBSS proves phone ↔ account
        └── 200  { publicCode: "AMNV-XXXXX-XXXXX", displayName }
            409  ownership_unproved → the ops queue's inbox, not a dead end
            409  vendor_unavailable → suspended, already claimed, or lost the CAS race
            401  invalid_code       → wrong code, exhausted, or no live challenge (one answer)
            503  anchor_unavailable
```

**Why the account cannot be named at `/request`.** It used to be, and the code was sent only when
the account resolved to a promoted, unclaimed vendor — so an attacker submitted their **own**
number against someone else's account and watched their handset. One unauthenticated request, no
Anchor call, and the uniform 202 could not hide it, because **an SMS is not part of an HTTP
response**. Every account-dependent answer now sits behind proof of phone control.

**The `409` is deliberately kept.** The obvious alternative — prove ownership at `/request` and
text only on a NIBSS match — closes the same channel by giving an honest owner *silence*. A phone
that does not match the bank record (staff phone, a director's line, a recently changed number) is
the **common** case here, not the edge case, and those people need to be told to call support.

**On the claimed name:** `displayName` is overwritten with the name NIBSS returns, replacing the
observed one a payer typed. The claim is the moment that string becomes public content on §8.3, so
it is also the moment it stops being client-supplied.

### 8.3 The code becomes payable

```
PAYER (agent)                         ANYONE (no app, no account)
  └── camera → NQRScanScreen           └── types pay.amana-ng.com/v/AMNV-XXXXX-XXXXX
        reads NQR *and* AMNV codes           └── GET /v/:code   ← unauthenticated HTML,
        └── GET /vendors/code/:code               the first Amana surface reached
              (authenticated;                     by typing a hostname
               assertSubWalletAccess)             └── shop name, "Verified on Amana",
              └── confirm screen                     account ending — so a payer can
                    └── normal NIP spend (§3.2)      confirm WHO they are paying
                        — rules apply as ever
```

**⚠️ No code may be PRINTED until three things hold** — app-wide HSTS (built, PR #48), `amana-ng.com`
**accepted** into browser preload lists, and the `pay.amana-ng.com` record. `force_https` is a 301 that
travels in cleartext; an on-path attacker on market Wi-Fi replaces it and serves the same page with
a different account ending, defeating the page's only job. Preload is what covers the *first* hit to
a hostname, which is exactly and only what a printed sticker creates. See
[`runbook/go-live-checklist.md`](../runbook/go-live-checklist.md) §6. **This blocks printing, not
launch** — the scan path needs no public hostname and works today.

### 8.4 Ops surfaces

Admin-key authenticated (`ADMIN_API_KEY`), no UI — `curl` against `/vendors-admin`:

```
GET  /vendors-admin/claim-queue                    attempts awaiting a human
POST /vendors-admin/vendors/:id/approve-claim      claim for the real business; needs NO
                                                   pending row, so ops are never blocked
                                                   by whoever holds the queue
POST /vendors-admin/vendors/:id/category           set an ENFORCEABLE category
POST /vendors-admin/vendors/:id/suspend            revoke enforcement, keep observing
POST /vendors-admin/households/:id/enforcement     per-household switch — shadow vs enforce
```

**Suspension revokes enforcement but still returns the row**, so shadow logging keeps recording. And
there is **no unsuspend route**: it needs a prior-status column to restore to, which makes it SP-V2b
scope rather than a bolt-on. The SQL workaround is in the runbook.

