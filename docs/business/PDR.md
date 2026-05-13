# Amana — Product Design Requirements (PDR)

**Version:** 1.0 | **Date:** 2026-05-13 | **Status:** Approved MVP
**Author:** Alexander Adegbola | **Domain:** amana-ng.com

> **Executive summary:** Amana is a phone-to-phone controlled-spend wallet for Nigeria. A principal (parent or employer) funds a master wallet and issues sub-wallets to dependents and staff with real-time spending limits, category locks, and time-window rules. Payments reach any Nigerian bank account via NIP transfer — no vendor app required. The product closes the gap between unconstrained cash/transfers (no control) and full expense management software (too complex for households and micro-SMBs). MVP is fully built and in pre-deployment.

---

## 1. Vision & Mission

**Vision:** Every Nigerian principal who hands money to a dependent or staff member does it through Amana — with rules that don't argue back.

**Mission:** Build the primitive of delegated, controlled spending for Nigeria's middle-class households and small businesses, on top of the existing NIP rail, at a price every household can justify.

**One-liner:** *"For the people you trust with money — and the rules you shouldn't have to argue about."*

---

## 2. The Problem

### 2.1 The daily friction

Nigerian middle-class principals — parents, employers, household heads — routinely hand cash or unconstrained bank transfers to dependents and staff: school-going children for canteen and transport, domestic staff for market runs and errands, business owners delegating petty cash to kitchen staff or dispatch riders.

The status quo fails all parties:

| Mechanism | Principal control | Auditability | Agent friction |
|---|---|---|---|
| Cash | None | Zero | Counting, accusations |
| Debit card | None (PIN ≠ rule) | Statement only | Loss, fraud |
| Bank transfer | None | Sender statement only | No category, no limit |
| WhatsApp + bank app | None | Screenshots | High manual overhead |
| **Amana** | **Real-time rules** | **Signed audit log** | **Normal NIP transfer** |

The core insight: *"What did you do with the ₦15,000 I gave you yesterday?"* is the most frequent source of low-grade household financial friction in Nigeria. SMB owners have the exact same conversation about kitchen staff and dispatch riders.

### 2.2 Market size

- **Target households:** ~4M Nigerian middle-class households with domestic staff and/or school-age children. Conservatively 10% addressable in Year 1 = 400K households.
- **Target SMBs:** ~800K formal micro/small businesses in the restaurant, logistics, retail, and construction verticals.
- **Pricing ceiling proxy:** Household sub-wallet budgets typically ₦5K–₦50K/month per agent. Total delegated spend is structurally a multi-billion-naira daily flow currently moving via cash and unconstrained transfers.

### 2.3 Why now

- NIBSS NIP penetration crossed ~95% of bank accounts in 2024–25; instant transfer is the default consumer payment expectation.
- NIN enrolment ~70% adult population — KYC is solvable without in-person processes.
- BaaS (Anchor, Bloc) has matured to 4–6 month integration timelines, removing the licensing tax that killed earlier delegated-wallet attempts.

---

## 3. The Solution

Amana is built around one primitive: **a principal funds, delegates spending authority to N agents within rules, and controls and audits in real-time.**

The differentiating mechanic is **phone-to-phone** — for onboarding, for the exception (bump) flow, and for trust signalling. Vendors never install Amana; they receive a standard NIP credit.

### 3.1 Core loop

```
Principal funds master wallet
        ↓
Principal creates sub-wallet → assigns agent (domestic staff, child, employee)
        ↓
Principal sets rules: limit / category / time window
        ↓
Agent spends at any vendor (NQR, phone lookup, typed account)
        ↓
Rule engine evaluates → allow / bump_pending / deny
        ↓
If bump: agent requests via app → principal approves one-tap
        ↓
NIP transfer settles → both parties notified in real time
        ↓
Principal sees full audit log + anomaly flags
```

### 3.2 What makes it different

1. **Phone-to-phone is the mechanic, not a feature.** NFC pairing, QR pairing, and SMS deep-link onboarding make the agent relationship explicit and trusted.
2. **The rule engine is principal-owned.** Limits, category locks, time windows, anomaly thresholds — set by the principal, enforced automatically, no argument required.
3. **Bump flow, not block-and-call.** Exceptional spends go through an in-app one-tap approval — not a phone call, not a WhatsApp back-and-forth.
4. **Vendors are passive.** No merchant sign-up, no terminal, no QR registration. Any Nigerian bank account is a valid vendor.
5. **Principal is a first-class spender too.** The principal app exposes the full vendor-capture stack for direct spend from the master wallet (bypass rules, no bump, full anomaly audit).

---

## 4. Target Users

### 4.1 Principal persona

**"Chukwuemeka, 42, Lagos"** — Accountant, household head. Gives his housekeeper ₦30K/month for market and errands. Gives his two kids ₦5K/week each for school canteen and transport. Has been burned by "I don't know where the money went" conversations twice this year.

Goals: visibility without micromanagement; rules that enforce themselves; instant notification when something unusual happens.

Frustrations: debit cards get misused or lost; cash is untrackable; bank-app transfers have no category or limit.

### 4.2 Agent persona

**"Amina, 28, Lagos"** — Housekeeper. Receives a sub-wallet from her employer. Goes to the market, taps NQR or enters the vendor's account number, enters the amount, sends.

Goals: get paid for legitimate spend quickly; not embarrassed in front of vendors when a limit is hit; clear feedback on what she can and can't do.

Frustrations: being accused of misuse when receipts go missing; slow reimbursement cycles.

### 4.3 SMB variant

**"Tunde, 38, Port Harcourt"** — Restaurant owner. Issues sub-wallets to his kitchen manager (market runs, ₦50K/week) and two dispatch riders (fuel, ₦10K/day each). Category-locked to "food & beverage" and "transport" respectively.

Goals: no more petty-cash box; per-category spend visibility; one-tap bump approval on his phone.

---

## 5. Feature Matrix

### 5.1 Core (MVP — shipped)

| Feature | Principal | Agent |
|---|---|---|
| OTP phone auth (no password) | ✓ | ✓ |
| KYC: Phone + BVN + NIN (Tier 2) | ✓ principal only | Phone + NIN only |
| Master wallet — NIP-in virtual account | ✓ | — |
| Create / name sub-wallets | ✓ | — |
| Invite agent via NFC, QR, or SMS deep-link | ✓ | Receive invite |
| Rule engine: per-wallet limits, category locks, time windows | Set | Constrained by |
| Anomaly scoring (ML feature set) | See flags | — |
| Vendor capture: NQR scan, phone lookup, typed account + name-enquiry | ✓ | ✓ |
| NIP outbound transfer | ✓ | ✓ |
| Bump request / one-tap approve | Approve | Request |
| Push + in-app notifications (settled, failed, bump events, anomaly) | ✓ | ✓ |
| Notification preferences (real-time / threshold / digest / silent) | ✓ | ✓ |
| Sub-wallet snooze + quiet hours | ✓ | — |
| Transaction detail screen (receipt-grade view) | ✓ | ✓ |
| Transaction history (paginated) | ✓ | ✓ |
| Photo / note / GPS capture at payment time | — | ✓ |
| Audit log (server-side, immutable) | — | — |
| Principal direct spend (master wallet) | ✓ | — |

### 5.2 Planned (v1.1+)

| Feature | Notes |
|---|---|
| Amana Receive NFC sticker (vendor capture path A) | Backend stub already in schema |
| Card top-up (master wallet inbound) | Sudo integration |
| Staging environment | Before beta invite |
| Multi-principal households | Schema supports it; not exposed in MVP UI |
| Cron process (refund sweep, notification digest) | Separate Fly machine |
| Custom domain `api.amana-ng.com` | Post first-deploy DNS config |

---

## 6. User Stories

### Principal

- As a principal, I can fund my master wallet via NIP transfer to my dedicated virtual account number, so I don't need to integrate anything new.
- As a principal, I can create a named sub-wallet and set a monthly spend limit, so my housekeeper can't exceed what I've budgeted.
- As a principal, I can lock a sub-wallet to specific spending categories, so the kitchen-staff wallet can't be used for personal shopping.
- As a principal, I can invite an agent to my household by tapping phones (NFC), scanning a QR code, or sending an SMS link, so onboarding is frictionless whether we're together or apart.
- As a principal, I receive a push notification when my agent spends, so I have real-time visibility without asking.
- As a principal, I can approve or deny a bump request in one tap from my phone, so exceptional spend is handled in seconds, not a phone call.
- As a principal, I can view a receipt-grade transaction detail with vendor, amount, category, agent, timestamp, and NIBSS session ID, so disputes are resolved with evidence.
- As a principal, I can pay vendors directly from my master wallet, so I don't need a separate banking app.

### Agent

- As an agent, I can capture a vendor via NQR scan, phone number, or typed account number, so I can pay any vendor without the vendor installing anything.
- As an agent, I can confirm payment with an optional photo, note, and GPS location, so I have evidence of legitimate spend.
- As an agent, I see a clear "over limit" message and can request a bump with a note, so I'm not embarrassed in front of vendors.
- As an agent, I receive a push notification when my bump is approved or denied, so I know immediately whether to proceed.

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Availability** | 99.5% uptime (MVP target). 1 min machine minimum on Fly.io prevents cold-start latency. |
| **Latency** | P95 API response < 500 ms (non-NIP paths). NIP settlement is async and subject to NIBSS SLAs. |
| **Security** | JWT auth (RS256 preferred, HS256 at MVP). All secrets via Fly secrets manager. DB over TLS (`sslmode=require`). BVN/NIN stored at rest, never returned in API responses. |
| **Compliance** | CBN KYC Tier 2 (principal): Phone + BVN + NIN, ₦300K wallet cap. Agent: Phone + NIN. AML narration: `AMN/AGT/[hash]` — NIN never in NIBSS narration. |
| **Scalability** | Stateless Hono server. Horizontal scale via Fly Machines. DB connection via postgres-js pool. |
| **Observability** | Health endpoint `/health`. Fly health checks every 15s. Structured logs (stdout). |
| **Data integrity** | Immutable postings ledger. Audit log append-only. Idempotency keys on all financial mutations. |

---

## 8. Out of Scope (MVP)

- Card top-up (v1.5 with Sudo)
- Sound chirp / Bluetooth vendor capture
- Salary disbursement / payroll
- Multi-currency
- iOS NFC (hardware limitation — Android marquee feature)
- Web app
- Staged rollout / feature flags
- Admin dashboard
- Reconciliation portal
- USSD fallback
- Staging environment (add before beta)

---

## 9. Success Metrics

| Metric | MVP target (month 3 post-launch) |
|---|---|
| Registered principal households | 500 |
| Active sub-wallets (spent in last 30 days) | 1,000 |
| Weekly transaction volume | ₦5M |
| Bump approval rate | > 70% (proxy for principal engagement) |
| Push notification opt-in | > 80% |
| Transaction failure rate | < 5% |
| Support tickets per 100 transactions | < 2 |
