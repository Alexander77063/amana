# Amana — MVP Design Spec

**Status:** Approved by user 2026-05-03 across all five sections of the design summary. Ready for implementation planning.
**Authors:** Alex Adegbola (Garry), with Claude as collaborator.
**Scope of this document:** the canonical MVP design — architecture, components, data model, transaction lifecycle, error & AML handling, and testing approach. Does not include the implementation plan (next deliverable, produced by `superpowers:writing-plans`).

---

## 1. Overview

**Amana is a phone-to-phone controlled-spend wallet for Nigeria.** A principal (parent or employer) funds a master wallet and issues sub-wallets to dependents (kids, domestic staff, family members) with real-time limits, category locks, time windows, and remote-or-present authorization.

The differentiating mechanic is **phone-to-phone between principal and agent** — for onboarding, for the bump exception flow, and for trust signalling. Vendors are paid via standard NIP transfer; vendors never install Amana.

### One-liner
> *"For the people you trust with money — and the rules you shouldn't have to argue about."*

### Why this exists
Nigerian middle-class households routinely give cash to domestic staff, school-going children, and adult dependents to spend on the household's behalf. The status quo is bank-app transfers (no controls), debit cards (no rules, easy to lose, fraud-prone), or physical cash (zero auditability). Amana is the first product designed end-to-end for *delegated, controlled* household spending — built on existing Nigerian rails (NIBSS NIP), wrapped in a control layer the principal owns.

### Wedge
Household domestic-staff and family-allowance use cases, unified as a single primitive: **principal funds, dependent spends within rules, principal controls.**

### Two segments, one primitive
The same primitive serves two distinct segments without changing the product. The household wedge proves the primitive; the SMB segment is the volume play once the household segment ramps.

**1. Households (the wedge — decision #2).** Plans: Free, Family, Household.
- Parents giving sub-wallets to school-going children for canteen, transport, books.
- Heads-of-household giving sub-wallets to domestic staff for market runs, school-pickup errands, utility top-ups.
- Adult children supporting ageing parents — predictable monthly allowance with category locks (groceries / pharmacy / transport) and visibility for everyone in the family chat.
- Spouses managing a shared household budget where one person handles operations and the other wants real-time line of sight without joint accounts.

**2. Small businesses (natural extension, same primitive).** Plan: Business (₦10,000/mo, 50 agents).
- Restaurant, bar, cafe owners issuing sub-wallets to kitchen staff for daily market ingredient runs and petty cash.
- Logistics, dispatch, and ride-hailing fleet owners giving riders sub-wallets for fuel, road tolls, minor repairs, and per-trip allowances — with category locks so the fuel allowance can't be spent on lunch.
- Retail shop owners delegating restock budgets and utility payments to store managers without exposing the master account.
- Construction site supervisors managing per-day allowances and material-purchase budgets for foremen and workers.
- Field sales and trade-marketing teams with daily activation budgets per rep, settled real-time against vendor bank accounts.
- Property managers letting caretakers handle small repairs, utility top-ups, and tenant interfacing within a fixed monthly envelope.
- Schools, churches, and community organisations where multiple administrators make small operational purchases under a single principal's oversight.

The spend pattern is structurally identical: a principal funds, delegates spending authority to N agents within rules, and controls + audits in real-time. The brand foundation (decision #12 — *"trust before transaction"*, *"the rules you shouldn't have to argue about"*) reads naturally in both contexts.

**A third pattern cuts across both segments: ad-hoc tradesman / one-off payments** — paying a mechanic, vulcaniser, electrician, plumber, casual labour. Households need it for emergency car / home repairs; SMBs need it for fleet repairs and emergency contractor calls. This is treated as a first-class flow in the agent app (§7.4 — phone-number lookup, large in-person name verification, optional photo + note + GPS, post-payment "show the recipient" screen).

### Foundational principle
Phone-to-phone is the main thing. It is the differentiating mechanic and must remain visible in the architecture, the UX, and the brand. Card-centric or merchant-centric framings are explicitly rejected.

---

## 2. Locked decisions (15)

These decisions were taken during the brainstorm and are inputs to this spec, not subjects of re-debate. They live in `docs/brainstorm/locked-decisions.md`. Summary:

1. **Licensing path** — Hybrid. Start on a BaaS partner; transition to own CBN license once volume justifies.
2. **Wedge** — Household domestic-staff + family allowance, unified.
3. **Spend rail** — NIP transfer at MVP. Vendor receives a normal NIP credit; never installs the app. Capture stack defined in #14. Card deferred to v1.5.
4. **Authorization model** — Pre-authorized rules. Agent spends autonomously within rules. Principal gets configurable visibility and instant suspend.
5. **Exception flow** — In-app "request bump" for over-limit / out-of-rule spends. The only surviving form of the original "double-handshake" magic.
6. **Onboarding** — Hybrid: NFC tap-to-pair (Android marquee) + QR pairing (cross-platform inc. iPhone) + SMS deep-link (remote onboarding).
7. **Wallet structure** — Delegated authority. Single master wallet held by principal; sub-wallets are ledger entries within it. Funds never legally leave the principal.
8. **KYC** — Principal = Tier 2 (Phone + BVN + NIN, ₦300K cap; upgrade to Tier 3 if balance > ₦300K). Agent = Phone + NIN only.
9. **Funding (master wallet inbound)** — A only at MVP: NIP-in via dedicated virtual account number issued by BaaS partner. (B) card top-up at v1.5. Salary disbursement explicitly out of scope.
10. **Pricing** — Hybrid C: Free (1 agent, ₦20K/mo throughput) / Family ₦1,500/mo (3 agents) / Household ₦4,000/mo (10 agents) / Business ₦10,000/mo (50 agents) + ₦25 per outbound NIP.
11. **BaaS partner** — Anchor primary; Bloc redundancy; Sudo for cards (v1.5). Vendor-agnostic adapter layer (Hexagonal / Ports-and-Adapters) wraps the BaaS so it's swappable.
12. **Brand** — Name: **Amana** (Hausa, Arabic-rooted: "trust, safekeeping"). Pillars: trust before transaction; calm, not flashy; specifically Nigerian; phone-to-phone is the mechanic, not the slogan; premium feel at accessible price. Positioning lines in `docs/brainstorm/brand.md`.
13. **Moat thesis** — Segment ownership + brand depth + product depth (rule engine, exception flow, anomaly, multi-principal) + distribution depth (schools, property managers, employer HR, community trust) + operational reliability. Not moats: better tech, lower price, nicer UX.
14. **Vendor capture stack** — Layered, lowest-friction-first.
    - A. Amana Receive sticker (NFC tap) — vendor signs up via USSD/SMS, free branded sticker mailed; sticker holds an Amana vendor ID resolving to a bank account on our backend.
    - B. NQR / bank QR scan — works with any existing NIBSS NQR or bank/POS QR.
    - C. Smart recents + one-time typed account — universal fallback.
    - Skipped: D (sound chirp / Bluetooth) — recreates merchant-onboarding burden with no clear advantage.
    - **MVP-vs-later split:** MVP = B + C only; A ships in v1.1. Sticker-resolution backend stub (schema + lookup endpoint) ships in MVP so v1.1 is not a retrofit.
15. **Agent attribution / NIP narration** — Outbound NIP narration carries a hashed agent reference (e.g. `AMN/AGT/abc12`) plus the principal's wallet reference. The agent's full NIN is held in our audit log only. Satisfies CBN/NFIU AML obligations without leaking domestic staff's NIN into the principal's bank-statement narration.
16. **Ad-hoc tradesman / one-off payments** — A first-class supported pattern. Phone-number-to-account resolution added to capture path C; large in-person name verification UX; pre-defined "ad-hoc service" category with principal-set rules; optional photo/note/GPS capture at confirm time, stored in audit log; "show the recipient" post-payment screen. All MVP scope. See §7.4.

---

## 3. High-level architecture

Three layers:

### Devices (top)
- **Principal phone** (iOS + Android) — owns master wallet, sets rules, sees activity, suspends agents, approves bumps.
- **Agent phone** (iOS + Android) — spends within rules via NIP, requests bumps for exceptions, holds NIN-only identity.

Devices communicate principal↔agent via three pairing mechanisms (decision #6): NFC tap (Android marquee), QR scan (cross-platform), SMS deep-link (remote).

### Amana backend (middle)
Seven core domain modules (detailed in §4), exposed to apps via HTTPS APIs and to clients via push notifications (FCM/APNs). All partner integration goes through the BaaS adapter — the rest of the system is partner-agnostic.

### Adapter + partners (bottom)
A vendor-agnostic adapter layer (Ports & Adapters) wraps every BaaS partner. Anchor is the primary BaaS at MVP; Bloc is plumbed as a future redundancy; Sudo enters at v1.5 for card issuance. Reaches NIBSS / NIP rail transitively via Anchor.

### Key topology invariants
- Funds never legally leave the principal — sub-wallets are *internal ledger entries*, not separate KYC'd accounts at the BaaS.
- Phone-to-phone covers principal↔agent only. Vendor is always paid via standard NIP transfer; vendor never installs Amana.
- BaaS is wrapped behind an adapter — Anchor is swappable.
- Dependencies point one way: apps → backend → adapter → partners.

---

## 4. Components & responsibilities

The MVP backend is **7 modules** + **2 client apps** + **2 partner integrations** (the partners are reached through the adapter; they are not owned by us).

### Backend core (our code)

| # | Module | Purpose | Inputs | Outputs | Internal deps |
|---|--------|---------|--------|---------|---------------|
| 1 | **Wallet Ledger** | Double-entry source of truth for balances, postings, suspense, fees, refund reconciliation. | Reservations, settlements, reversals, fees | Balances, postings, statements | None — leaf |
| 2 | **Rule Engine** | Pure-function evaluator: balance, daily/monthly limit, category, time window, vendor allowlist, anomaly score. | Txn intent + active rule set | allow / deny / require-bump + reason | Ledger (balance), Anomaly (score) |
| 3 | **Bump Workflow** | State machine for exception requests; routes to principal; applies one-shot overrides on approval. | Denied-by-rules txns, principal decisions | Approve-once tokens, audit log entries | Notifications, Rule Engine |
| 4 | **Anomaly & Audit** | Statistical txn scoring (z-score, hour-of-day, vendor novelty, velocity); immutable append-only audit log for AML/dispute/CBN. | Txn stream | Anomaly score (0–1), audit log entries | Ledger |
| 5 | **BaaS Adapter** | Vendor-agnostic interface: virtual accounts, KYC tier-up, NIP-out, name enquiry, webhooks. Circuit breaker, idempotency, retry policy, narration formatter. | Domain commands | Partner responses normalised to our types | Anchor SDK |
| 6 | **Notifications** | Push (FCM/APNs), in-app, SMS fallback. Honours each principal's preference matrix (real-time / threshold / digest / anomaly-only). Channel-agnostic — given payload + recipient + channel, ships it. | Notification intents from Bump, Ledger, Anomaly | Delivery receipts | FCM, APNs, SMS gateway |
| 7 | **Sticker Resolution (stub)** | MVP stub for decision #14: schema + internal lookup endpoint only. Vendor sign-up rail, fulfilment, admin portal all wait for v1.1. | Sticker UUID | Resolved bank account | None — leaf |

### Client apps

- **8. Principal App (iOS + Android)** — master wallet view, sub-wallet creation, rule editor, real-time activity feed, bump approvals, suspend/resume agents, statement export, KYC upgrade flow.
- **9. Agent App (iOS + Android)** — sub-wallet view, NQR scan, typed-account flow with NIBSS name enquiry, recents list, request-bump, receipts. NFC pairing to principal phone in MVP; NFC sticker tap-read in v1.1.

### Partner integrations (behind the adapter)

- **10. Anchor (BaaS — primary)** — virtual accounts, KYC tier-up, NIP transfers, name enquiry, webhooks. App never imports Anchor SDK directly.
- **11. NIBSS / NIP rail** — reached transitively via Anchor. Inbound (master wallet funding via dedicated virtual account), outbound (agent spend → vendor bank account), name enquiry, NQR decoding (path B).

### Module-level invariants
- One purpose per module. Ledger does ledgering. Rule engine evaluates. The bump workflow does not call Anchor; the adapter does not know about rules.
- Dependencies point one way. Apps → backend → adapter → partners.
- Pure functions where possible. Rule engine is pure — same input, same output. Replayable.
- Adapter contains all partner failure. Anchor outage = circuit breaker opens; rest of system queues and waits.

---

## 5. Data model

All money is `int64` kobo. Postings and audit log are append-only. Rule sets are versioned. NIBSS session ID is the external truth for any settled transaction.

### Identity

```
users
  id               uuid pk
  role             enum(principal, agent)
  phone            e164
  bvn              char(11) nullable     -- agent has none
  nin              char(11)
  kyc_tier         enum(1, 2, 3)
  status           enum(active, suspended)
  created_at       timestamptz

households
  id                  uuid pk
  principal_user_id   uuid fk → users.id
  name                text
  created_at          timestamptz

household_members
  household_id        uuid fk → households.id  -- composite pk
  user_id             uuid fk → users.id       -- composite pk
  status              enum(active, suspended)
  joined_at           timestamptz
```

### Wallet & Ledger

```
master_wallets
  id                       uuid pk
  household_id             uuid fk → households.id
  anchor_virtual_account   char(10)
  anchor_bank_code         char(3)
  currency                 char(3)        -- "NGN" only at MVP
  status                   enum(active, frozen)
  created_at               timestamptz

sub_wallets
  id                  uuid pk
  master_wallet_id    uuid fk → master_wallets.id
  agent_user_id       uuid fk → users.id
  name                text
  status              enum(active, suspended, closed)
  created_at          timestamptz

ledger_accounts
  id                  uuid pk
  master_wallet_id    uuid fk → master_wallets.id
  kind                enum(master, sub, suspense, fee, external)
  sub_wallet_id       uuid fk → sub_wallets.id  -- nullable, set when kind='sub'
  normal_side         enum(debit, credit)

transactions
  id                       uuid pk
  master_wallet_id         uuid fk → master_wallets.id
  sub_wallet_id            uuid fk → sub_wallets.id  -- nullable
  kind                     enum(spend, topup, refund, fee, reversal)
  amount_kobo              int64
  status                   enum(pending, in_flight, settled, failed, reversed)
  idempotency_key          text unique
  nibss_session_id         text nullable
  vendor_account           char(10) nullable
  vendor_bank_code         char(3) nullable
  vendor_resolved_name     text nullable
  category                 text nullable
  anomaly_score            numeric(3,2) nullable
  bump_request_id          uuid fk → bump_requests.id  -- nullable
  agent_note               text nullable                -- §7.4 ad-hoc capture
  geolocation              geography(point, 4326) nullable  -- WGS84 lat/lon
  attached_media           jsonb nullable               -- array of media object refs
  created_at               timestamptz
  settled_at               timestamptz nullable

postings  -- IMMUTABLE, append-only
  id                   uuid pk
  transaction_id       uuid fk → transactions.id
  ledger_account_id    uuid fk → ledger_accounts.id
  debit_kobo           int64 (≥0)
  credit_kobo          int64 (≥0)
  posted_at            timestamptz
```

### Rules

```
rule_sets  -- VERSIONED, never updated
  id                       uuid pk
  sub_wallet_id            uuid fk → sub_wallets.id
  version                  int
  status                   enum(active, superseded)
  effective_from           timestamptz
  created_by_user_id       uuid fk → users.id
  created_at               timestamptz

rules
  id              uuid pk
  rule_set_id     uuid fk → rule_sets.id
  kind            enum(limit, category, window, allowlist)
  config_json     jsonb
  priority        int
```

The active rule set per sub-wallet is `MAX(version) WHERE status='active'`. Editing a rule writes a new version; the old set is preserved for replay and audit.

### Bumps

```
bump_requests
  id                       uuid pk
  transaction_id           uuid fk → transactions.id
  sub_wallet_id            uuid fk → sub_wallets.id
  requested_by_user_id     uuid fk → users.id
  amount_kobo              int64
  vendor_resolved_name     text
  agent_note               text nullable
  status                   enum(pending, approved_once, raise_limit, denied, expired)
  expires_at               timestamptz   -- TTL default 30 min
  decided_by_user_id       uuid fk → users.id  -- nullable
  decided_at               timestamptz nullable
  one_shot_token           text nullable  -- single-use, consumed on resume
```

### Audit

```
audit_log  -- IMMUTABLE, append-only, enforced at DB role level
  id              uuid pk
  actor_kind      enum(user, system, partner)
  actor_user_id   uuid fk → users.id  -- nullable for system/partner
  action          text                -- e.g. "txn.rule_eval"
  subject_kind    text                -- e.g. "transaction"
  subject_id      uuid
  payload_json    jsonb
  occurred_at     timestamptz
```

Retention: 7 years per CBN.

### Sticker (MVP stub → v1.1)

```
vendor_stickers
  uuid              uuid pk         -- printed on sticker NDEF
  bank_code         char(3)
  account_number    char(10)
  account_name      text
  vendor_phone      e164
  status            enum(unbound, active, revoked)
  registered_at     timestamptz
```

`status='unbound'` is for pre-printed stickers awaiting vendor binding via USSD/SMS in v1.1.

### Schema invariants
- All money is `int64` kobo. Never float, never naira-as-decimal. Currency `NGN` at MVP.
- Postings are immutable. Corrections happen through reversing entries against the same transaction, never `UPDATE`.
- Every txn has an `idempotency_key`, set client-side at intent creation. Retrying a failed call is always safe.
- Rule sets are versioned, never updated. Editing a rule writes `version + 1`; the old set stays for replay.
- `nibss_session_id` is the external truth for settlement state.
- `audit_log` is append-only. No `DELETE`, no `UPDATE`, ever. Database role enforces this.

---

## 6. Transaction lifecycle

### State machine

```
DRAFT  →  RULE_EVAL  →  IN_FLIGHT  →  SETTLED
              │             │            │
              │             ↓            ↓
              ↓          FAILED      REVERSED
        BUMP_PENDING
              │
              ├──→ IN_FLIGHT  (approve once, approve & raise limit)
              └──→ FAILED     (denied, expired, agent cancel)
```

### Transitions

- `DRAFT → RULE_EVAL` on agent confirm in the app.
- `RULE_EVAL → IN_FLIGHT` if all rules pass; suspense posted, NIP-out submitted with idempotency key.
- `RULE_EVAL → BUMP_PENDING` if any rule fails; bump request created with TTL (default 30 min).
- `BUMP_PENDING → IN_FLIGHT` on principal "approve once" or "approve & raise limit" — one-shot token attached, txn resumes.
- `BUMP_PENDING → FAILED` on principal deny, on TTL expiry (auto-deny), or on agent cancel.
- `IN_FLIGHT → SETTLED` on Anchor success webhook; suspense → settled, fee posted as a separate txn.
- `IN_FLIGHT → FAILED` on Anchor failure webhook OR on reconciliation timeout (Anchor status query confirms failure); suspense reversed.
- `SETTLED → REVERSED` only via inbound NIP refund (re-credits originating sub-wallet) or successful recall request — never automatic.

### Happy path (vendor payment, end-to-end)

1. **Agent captures vendor** — NQR scan, typed account, or recents pick.
2. **Backend → Anchor → NIBSS name enquiry** — registered account name resolved (<1 s). On failure, flow stops here.
3. **Agent confirms** — amount, resolved vendor name, category, source sub-wallet.
4. **Rule engine evaluates** — balance → daily/monthly limit → category → time window → vendor allowlist → anomaly score. All must pass. Decision logged.
5. **Backend reserves funds in ledger** — debit sub-wallet entry, credit "in-flight / suspense" account. Master wallet's *available* balance drops; *posted* balance unchanged until settlement.
6. **Backend calls Anchor's NIP-out endpoint** from the master wallet's underlying bank account, with the idempotency key.
7. **NIBSS settles in real-time** — vendor's bank receives a normal NIP credit (sub-second to ~30 s). Vendor sees the hashed agent reference + principal wallet ref in the narration. Vendor needs no app.
8. **Anchor settlement webhook** — success → finalise ledger (suspense → settled), record ₦25 fee + any BaaS markup as a separate posting. Failure → reverse suspense, notify agent, allow one-tap retry.
9. **Notify + receipt** — agent gets in-app receipt with NIBSS session ID (shareable). Principal gets the notification their settings prescribe. Audit log entry permanent.

### Exception (bump) path

- A. Agent sees "Over your limit. Request a bump?" One tap sends to principal with amount, vendor, category, optional note.
- B. Principal gets push with three buttons: *Approve once*, *Approve & raise limit*, *Deny*. Decision logged.
- C. Approved → flow continues from step 5 with a one-shot rule override attached. Denied → agent sees the decision; nothing leaves the wallet.

---

## 7. Vendor capture (decision #14, MVP scope)

**Layered, lowest-friction-first. Money still moves via NIP in all cases.**

At MVP: **B + C only.** A ships in v1.1.

### 7.1 B. NQR / bank QR scan
Works with any existing NIBSS NQR or bank/POS QR sticker (Moniepoint, Opay, Palmpay, GTBank, etc.). Zero vendor onboarding. Covers most formal vendors today.

### 7.2 C. Smart recents + one-time typed account or phone number
Three sub-paths, all MVP:

- **Recents** — first hit on the capture screen for any vendor seen before. One tap → name + amount.
- **Typed 10-digit account** — type the account once, pick the bank, NIBSS name-enquiry confirms. Vendor is then saved to recents with the resolved name.
- **Phone-number lookup** — type a Nigerian phone number; NIBSS phone-lookup (via Anchor) resolves to the primary BVN-linked bank account in <1s. Cuts the ten-digit-account-friction completely for the (very common) case where the recipient quotes a phone number. Same name-enquiry confirmation.

### 7.3 A. Amana Receive sticker (v1.1, stubbed in MVP)
Vendor signs up via USSD/SMS (bank account + phone), we mail a free branded NFC sticker. Sticker holds an Amana vendor ID resolving to the vendor's bank account on our backend. Agent taps phone to sticker → autofill. Marquee experience; doubles as a distribution flywheel ("Pay with Amana" tags in shop windows).

**MVP build for A:** sticker-resolution schema (`vendor_stickers` table) + internal lookup endpoint. No vendor sign-up rail, no fulfilment, no admin portal.

### 7.4 Ad-hoc tradesman / one-off payments (decision #16)

A major real-world Nigerian pattern, deserving first-class treatment in the agent app: paying mechanics, vulcanisers, electricians, plumbers, market traders, roadside repairs, casual labour. Often the *agent* is the one paying on behalf of the principal (driver pays the vulcaniser, house staff pays the plumber). The architecture handles them already — they're just NIP transfers — but five UX/data affordances are in MVP scope to make the pattern feel native:

1. **Phone-number lookup** (covered in §7.2) is usually the right capture path here, since tradesmen quote phone numbers far more often than account numbers.
2. **Large in-person verification UX.** On the confirm screen, the resolved account name is displayed in **big, bold type**. The agent reads it aloud; the tradesman confirms. With no prior relationship, that moment IS the trust handshake.
3. **"Ad-hoc service" suggested category.** When the vendor is not in recents, this category is offered first. Principals can write rules around it (e.g. *"max ₦10k per ad-hoc service txn, max 3/day"*) so a runaway tradesman bill triggers the bump flow.
4. **Optional photo + note + geolocation capture** at confirm time. The agent can attach a photo of the work, a short note ("flat tyre fixed, 3rd Mainland"), and the device's GPS coordinates. All stored in the audit log alongside the txn (see §5 — `agent_note`, `geolocation`, `attached_media` columns on `transactions`). Useful for principal visibility, dispute support, and (for SMBs) ops accountability.
5. **"Show the recipient" post-payment screen.** After settlement, the agent can hand the phone to the tradesman to show: amount, NIBSS session ID, expected arrival window ("should appear in your bank within 30 seconds"). Closes the trust loop in person without requiring the recipient to install anything.

**Why all MVP scope:** without these affordances, agents will route around Amana for ad-hoc spends (defeats the purpose) or rely on bump-bypass loopholes (defeats the controls). The architecture cost is small (a NIP-phone-lookup adapter method, three nullable columns, a couple of UX screens); the segment cost of leaving them out is large.

---

## 8. Onboarding (decision #6)

Three pairing mechanisms, all available from day one:

- **NFC tap-to-pair** — Android marquee. Agent and principal phones touch; pairing token exchanged.
- **QR pairing** — cross-platform, works on iPhone. Principal app shows QR; agent scans.
- **SMS deep-link** — remote onboarding (kid at university, domestic staff in another city). Principal generates a one-time deep-link and SMSes it; agent taps to install + pair.

After pairing, the agent completes Phone + NIN identity verification. Because the agent holds no balance of their own, no CBN tier cap applies to them — the NIN is captured purely for AML attribution on the principal's spend.

---

## 9. KYC, AML, CBN obligations

### KYC tiers (CBN three-tier framework)

- **Principal — Tier 2** at MVP: Phone + BVN + NIN; ₦300K balance cap.
- **Principal — Tier 3** upgrade: triggered when balance approaches ₦300K; adds address verification.
- **Agent**: Phone + NIN only; no own balance, only spending authority. NIN attaches to every txn for AML.

### Per-txn agent attribution (decision #15)
Outbound NIP narration carries a hashed agent reference (e.g. `AMN/AGT/abc12`) + the principal's wallet reference. The full agent NIN is held in our audit log only, linked to the same hashed reference. Recipient bank's CBN reporting captures the hashed actor; if NFIU requests, we resolve.

### Sanctions / PEP screening
Run via Anchor at principal onboarding. Re-run on any txn above ₦5M (won't trigger at MVP given Tier 2 cap, but plumbed now).

### Suspicious Transaction Reports (STRs)
Generated automatically when anomaly score ≥ 0.85 OR pattern detection (rapid splitting, round-tripping, off-pattern recipient cluster). All STRs land in a manual review queue; submitted to NFIU within statutory window.

### Retention
Audit log retained 7 years per CBN. Append-only at the database role level — no engineer or admin can delete.

---

## 10. Error handling

### Retry policy
NIP-out calls retry with exponential backoff: 250 ms → 500 ms → 1 s → 2 s → 4 s → 8 s, capped at 30 s total. Every retry uses the same idempotency key — Anchor never sends twice.

### Circuit breaker
If Anchor returns 5xx for >50% of calls in a rolling 60-s window, the breaker opens for 30 s. New txns enter `IN_FLIGHT` and queue inside the adapter. Agent sees "delayed", not "failed".

### Reconciliation
Hourly batch sweeps any txn in `IN_FLIGHT > 5 min`. For each, queries Anchor's transfer-status endpoint by idempotency key, then reconciles against NIBSS session ID. Three outcomes: confirm settled, confirm failed, escalate to manual queue. Every action lands in the audit log.

**Recon vs SLO:** the p95 settled-receipt SLO of 30 s (§12) covers the happy path where Anchor's webhook arrives normally. The 5-min recon threshold is a recovery mechanism for the rare case where the webhook is dropped or the partner is degraded — it bounds the *worst-case* time to a final state, not the typical case.

### Webhook hardening
Anchor webhooks are HMAC-signed; any payload that fails verification is rejected and logged. Webhooks are processed exactly-once via the signed event ID; replays are no-ops.

### Failure-mode quick reference

| Failure | System response | What user sees |
|---------|-----------------|----------------|
| Name enquiry fails | Stop at flow step 2; nothing posted | "Couldn't find this account" — try again |
| NIP rejected (insufficient funds, invalid account) | Reverse suspense, mark FAILED, retry once allowed | "Couldn't send" + reason + retry button |
| Anchor 5xx | Backoff retries; circuit breaker opens after threshold | "Delayed — we'll keep trying" + push when settled |
| Anchor webhook lost | Recon batch picks up after 5 min; status query resolves | Receipt arrives delayed but still arrives |
| Duplicate tap | Idempotency key blocks the second call at the adapter | One receipt only |
| Vendor refunds via inbound NIP | Recon links inbound NIP to originating txn (amount + sender + narration); re-credits sub-wallet | "₦X refunded to [sub-wallet] from [vendor]" |

### Disputes
NIP has no formal chargeback mechanism. Our flow:
1. User raises dispute in app — picks the txn, picks reason.
2. Internal triage against the audit log: rule decision, NIBSS session ID, vendor resolved name, anomaly score, surrounding pattern. For ad-hoc service txns, also the agent's attached photo / note / geolocation if captured (§7.4).
3. **Misdirected funds** → file recall via Anchor → recipient bank. Outcome depends on funds availability; we set expectation honestly.
4. **Buyer-vs-seller dispute** → not our problem; we provide signed receipt and NIBSS session ID. Buyer pursues seller directly.
5. **Suspected fraud** → suspend agent, freeze sub-wallet, escalate to security, file STR if pattern suggests.

The app explicitly tells users at dispute creation that NIP recalls are best-effort, not guaranteed.

---

## 11. Pricing (decision #10)

| Tier | Price | Agents | Throughput | Per-txn fee |
|------|-------|--------|------------|-------------|
| Free | ₦0 | 1 | ₦20K/mo | ₦25 |
| Family | ₦1,500/mo | 3 | unlimited | ₦25 |
| Household | ₦4,000/mo | 10 | unlimited | ₦25 |
| Business | ₦10,000/mo | 50 | unlimited | ₦25 |

Low adoption pricing chosen deliberately. Revisit at measurable adoption.

---

## 12. Testing approach

### Module × technique × tier matrix

| Module | Primary technique | Why | Tier |
|--------|-------------------|-----|------|
| Wallet Ledger | Property-based + integration | Double-entry invariants are property-testable | MVP |
| Rule Engine | Unit + replay | Pure function; replay corpus catches divergent decisions pre-deploy | MVP |
| Bump Workflow | State-machine + integration | Every transition exercised, including TTL, double-decision, agent cancel | MVP |
| Anomaly & Audit | Replay (anomaly) + DB-role test (audit) | Anomaly tuned via replay; audit append-only enforced by DB role with no UPDATE/DELETE grants | MVP |
| BaaS Adapter | Contract tests + chaos injection | Recorded contracts vs Anchor sandbox; chaos verifies breaker, retry, recon | MVP |
| Notifications | Integration with sandbox | FCM/APNs/SMS delivery acks; template snapshot tests | MVP |
| Sticker Resolution stub | Unit only | Minimal surface at MVP | MVP + v1.1 |
| Principal app | UI + e2e on real device | Detox / Maestro; device matrix across 2 Android (low + high) + 1 iPhone | MVP |
| Agent app | UI + e2e + accessibility | Same as principal + accessibility audit (large fonts, screen-reader) | MVP |

### Four pillars

1. **Property-based testing of the ledger.** Generate arbitrary sequences of valid operations; verify after every operation: Σ debits − Σ credits = 0, sub-wallet sums = master, no negative available balances, idempotency replay = no-op.
2. **Replay testing of the rule engine.** Capture every prod txn's (intent + active rule set + ledger snapshot) into a corpus. Pre-deploy: replay against new engine version; diff decisions; any divergence is a release-blocker. Performance budget: 10k replays under 30 s on CI.
3. **Chaos injection on the adapter.** Force partner 5xx, drop webhooks, inject latency, replay webhooks — verify breaker, recon, exactly-once. Run nightly against staging. Every prod incident becomes a permanent chaos test.
4. **End-to-end on real devices, real BaaS sandbox.** Weekly happy-path runbook across the device matrix. 4-week friends-and-family closed beta with real money before public launch.

### Environments, CI, security

- **Environments:** `local` with mocked adapter, `staging` against Anchor sandbox, `prod` with real Anchor + NIBSS. No shared secrets across envs. Migration parity enforced by CI.
- **CI gates:** unit + property + replay + adapter contract + lint required for merge. Integration on a real test database. Coverage % is not enforced; quality of assertions matters more.
- **Pre-launch audits:** external pen-test (focus: idempotency abuse, RBAC, replay attacks, webhook signature bypass). Code review of ledger and rule engine by a second engineer. CBN/AML legal review of narration format and STR triggers.
- **Bug bounty:** private (HackerOne or similar) at MVP launch; public at v1.5. Scoped to API + apps; out-of-scope = Anchor.
- **SLOs:** p95 txn submission < 500 ms (rule eval to NIP-out call). p95 settled receipt < 30 s. Webhook processing exactly-once. 99.9% monthly availability of the txn-submission API.

---

## 13. Out of scope (explicit non-goals)

The following are explicitly excluded from MVP. Not "deferred" — actively rejected for MVP scope.

- **Card issuance** — v1.5 only, via Sudo. Not needed at MVP because vendor capture stack (NQR scan + recents + typed) covers the common case.
- **Salary / payroll disbursement** — different product, already solved by existing bank apps. Not bolted on.
- **Vendor app / vendor onboarding** — vendors never install Amana. Sticker stub ships in MVP (schema only); full Amana Receive operational layer ships in v1.1.
- **Multi-currency** — NGN only at MVP. No FX, no foreign cards.
- **Agent-owned balance** — agents have no balance of their own, only spending authority on a sub-wallet. They cannot top up, cannot receive into a personal pocket.
- **Cash-in via agent network** — v2 only, and only if we deliberately expand to the unbanked-principal wedge.
- **Card top-up of master wallet** — v1.5; MVP funding is NIP-in only.
- **Sound chirp / Bluetooth proximity vendor capture** — explicitly rejected (decision #14, option D).

---

## 14. Open questions for the planning stage

These are not blockers for the spec — they will be resolved during `superpowers:writing-plans`:

1. **Tech stack for client apps** — React Native vs Flutter vs split (Kotlin + Swift). Trade-off discussion lives in the stack write-up, not here.
2. **Backend language** — TypeScript / Go / Elixir candidates. Pick during planning; the architecture works with any.
3. **Database choice** — Postgres is the obvious answer (jsonb, robust transactions, ledger-friendly). Confirm during planning.
4. **Hosting region** — Lagos-region (AWS af-south? GCP? local Nigerian cloud per CBN data-residency expectations). Resolve during planning with legal review.
5. **Build sequencing** — what ships first (ledger? adapter? rule engine?). Resolve during planning; my prior is ledger + adapter first because everything else depends on them.
6. **"Amana" name validation** — IP / domain search and 10–15-user validation before any branded asset goes to print. Belongs in week 1 of build, not spec.

---

## 15. Glossary

- **Principal** — the person who owns the master wallet, sets the rules, holds the BVN, and approves bumps. Parent or employer.
- **Agent** — the person who spends from a sub-wallet within the principal's rules. Kid, domestic staff, family member.
- **Master wallet** — the legally-owned wallet at the BaaS, held by the principal.
- **Sub-wallet** — an internal ledger construct with a spending authority delegated to an agent. Not a separate wallet at the BaaS.
- **Bump** — an exception request from agent to principal to authorise a txn that fails the rule engine.
- **NIP** — NIBSS Instant Payment, the Nigerian real-time interbank rail.
- **NQR** — NIBSS QR, the Nigerian national QR standard for payments.
- **NIBSS** — Nigeria Inter-Bank Settlement System, the operator of NIP and NQR.
- **CBN** — Central Bank of Nigeria, the regulator.
- **NFIU** — Nigerian Financial Intelligence Unit, the recipient of STRs.
- **BVN** — Bank Verification Number, 11-digit identity for banked Nigerians.
- **NIN** — National Identification Number, 11-digit national ID.
- **BaaS** — Banking-as-a-Service partner (Anchor, Bloc, Sudo).

---

*End of spec. Next deliverable: implementation plan via `superpowers:writing-plans`.*
