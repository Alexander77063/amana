# Amana — App Flow

**Version:** 1.0 | **Date:** 2026-05-13
**Apps covered:** Principal (iOS + Android) · Agent (Android first, iOS secondary)

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
    │   ├── PayTab → [vendor capture flow]
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
    │   │   ├── NqrScanScreen
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
        ├── "Scan QR" → NqrScanScreen
        │     → camera scans QR → POST /vendors/nqr-decode
        │     → result → ConfirmScreen
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
