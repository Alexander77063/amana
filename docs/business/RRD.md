# Amana — Release Requirements Document (RRD)


> **Refreshed 2026-08-25.** Originally 2026-05-13 for the MVP release. The technical requirements,
> integrations and constraints (§2–§4) held up and are unchanged. The functional requirements have
> been extended with what shipped since: a third actor kind, the sixth rule kind, digital VAS, the
> marketplace, and retailer onboarding with its portal.
>
> Schema: [`docs/product/database-schema.md`](../product/database-schema.md) · Index: [`docs/product/README.md`](../product/README.md)

**Version:** 1.0 — MVP Release | **Date:** 2026-05-13
**Release name:** Amana MVP | **Target:** Private beta, Q3 2026

> **Executive summary:** This document specifies what the Amana MVP system must do. It covers functional requirements by module, technical constraints, integration requirements, and acceptance criteria. The MVP is implemented and in pre-deployment on Fly.io + Supabase. All requirements below are satisfied by the current codebase unless explicitly marked `[DEFERRED]`.

---

## 1. Functional Requirements

### 1.1 Authentication

| ID     | Requirement                                                                                 | Status
|---|---|---|
| AUTH-1 | System must issue an OTP to a phone number via SMS within 30 seconds of request             | ✓
| AUTH-2 | OTP must expire after 10 minutes and be single-use                                          | ✓
| AUTH-3 | Successful OTP verification must return an access token (JWT) and a refresh token           | ✓
| AUTH-4 | Access tokens must have a short TTL (15 min); refresh tokens must have a long TTL (30 days) | ✓
| AUTH-5 | Any authenticated endpoint must reject requests with expired or invalid JWTs with HTTP 401  | ✓
| AUTH-6 | Logout must invalidate the refresh token server-side                                        | ✓ 1
| AUTH-7 | Each user must have a role (`principal`, `agent` or `retailer`) that is immutable after creation | ✓
| AUTH-8 | Principal registration requires Phone + BVN + NIN (KYC Tier 2)                              | ✓
| AUTH-9 | Agent registration requires Phone + NIN only                                                | ✓
| AUTH-10 | A `retailer` actor must sign in through a SEPARATE OTP surface (`/retailer/auth/*`); the household route must refuse one and point at the portal | ✓
| AUTH-11 | Retailer sign-in must not reveal whether a phone belongs to a retailer (no enumeration oracle) | ✓
| AUTH-12 | There must be NO retailer self-registration: ops create the business and record the contact number, and the first OTP from that number claims it | ✓
| AUTH-13 | A claimed retailer must not be takeable by re-registering its contact number | ✓
| AUTH-14 | Both retailer OTP endpoints must be rate-limited alongside the household ones | ✓

### 1.2 Households & Members

| ID   | Requirement                                                                         | Status
|---|---|---|
| HH-1 | A principal must be able to create a named household                                | ✓
| HH-2 | A household must have exactly one principal                                         | ✓
| HH-3 | A principal must be able to list all household members and their sub-wallets        | ✓
| HH-4 | A principal must be able to view the household's master wallet balance              | ✓
| HH-5 | An agent must not be able to view another household's data (404 on cross-household) | ✓

### 1.3 Pairing (Agent onboarding)

| ID     | Requirement                                                                                                       | Status
|---|---|---|
| PAIR-1 | Principal must be able to initiate pairing, receiving a one-time token and a deep-link                            | ✓
| PAIR-2 | Deep-link must be shareable via NFC, QR code, or SMS                                                              | ✓
| PAIR-3 | Agent must be able to complete pairing by presenting the token, creating their account, and joining the household | ✓
| PAIR-4 | Pairing tokens must be single-use and expire                                                                      | ✓

### 1.4 Sub-wallets

| ID   | Requirement                                                                                             | Status
|---|---|---|
| SW-1 | Principal must be able to create a named sub-wallet assigned to an agent                                | ✓
| SW-2 | Principal must be able to view sub-wallet balance (derived from postings ledger)                        | ✓
| SW-3 | Principal must be able to update the sub-wallet name and status (active/suspended/closed)               | ✓
| SW-4 | Agent must be able to view their own sub-wallet and balance                                             | ✓
| SW-5 | Principal must be able to snooze a sub-wallet (temporarily suspend notifications) with optional expiry  | ✓
| SW-6 | Principal must be able to configure global quiet hours (no notifications between start/end minutes)     | ✓

### 1.5 Rule Engine

| ID     | Requirement                                                                                                                | Status
|---|---|---|
| RULE-1 | Principal must be able to set rules on a sub-wallet: spend limit, category lock, time window, allowlist, anomaly threshold | ✓
| RULE-2 | Rules must be versioned; a new rule set supersedes the previous one atomically                                             | ✓
| RULE-3 | Rule evaluation must run synchronously before any NIP transfer is initiated                                                | ✓
| RULE-4 | A `limit` rule must block transactions that would exceed the configured kobo amount in the configured period               | ✓
| RULE-5 | A `category` rule must block transactions whose merchant category is not in the allowed list                               | ✓
| RULE-6 | A `time_window` rule must block transactions outside the configured day/hour range                                         | ✓
| RULE-7 | Rule violations must transition the transaction to `bump_pending` (not outright fail)                                      | ✓
| RULE-8 | Principal direct spend must bypass the rule engine                                                                         | ✓
| RULE-9 | A `merchant` rule must restrict a sub-wallet to an explicit allowlist of retailers | ✓
| RULE-10 | A `merchant` rule must be evaluated ONLY on the marketplace path; every other path passes `retailerId: null`, which the rule denies | ✓
| RULE-11 | An EMPTY merchant allowlist must deny everything; NO merchant rule must mean unrestricted. The two states are distinct | ✓
| RULE-12 | Approving a merchant must merge into the active rule set and republish the WHOLE set, never replace it | ✓
| RULE-13 | `time_window` must evaluate in `Africa/Lagos`, not UTC | ✓
| RULE-14 | Category locks must apply to VAS and marketplace purchases, not only bank transfers | ✓

### 1.6 Transaction Lifecycle

| ID    | Requirement                                                                                                        | Status
|---|---|---|
| TXN-1 | System must accept a payment intent with: amount, vendor account, vendor bank code, category, agent note           | ✓
| TXN-2 | Every transaction must have a client-supplied idempotency key; duplicate keys must return the existing transaction | ✓
| TXN-3 | Transaction status must follow: `draft → rule_eval → in_flight → settled / failed` or `draft → bump_pending`       | ✓
| TXN-4 | Name enquiry (NIP) must be performed and resolved name stored before `in_flight`                                   | ✓
| TXN-5 | NIP transfer must be initiated via Anchor API; NIBSS session ID must be stored on settlement                       | ✓
| TXN-6 | On NIP failure, transaction must transition to `failed` and `error_message` must be populated                      | ✓
| TXN-7 | Postings ledger must be updated atomically with transaction status changes (double-entry)                          | ✓
| TXN-8 | Agent must be able to attach a photo, note, and GPS coordinates to a transaction before or after send              | ✓
| TXN-9 | Principal must be able to retrieve a receipt-grade transaction detail (amount, status, vendor, sub-wallet, initiator, timestamps, NIBSS session ID, anomaly score, geolocation link)                                                                                                            | ✓
| TXN-10 | Transaction detail endpoint must return HTTP 404 on cross-household access (existence leak prevention)            | ✓

### 1.7 Bump Flow

| ID     | Requirement                                                                                   | Status
|---|---|---|
| BUMP-1 | A bump request must be created automatically when rule evaluation fails                       | ✓
| BUMP-2 | Bump request must record: transaction ID, sub-wallet, amount, vendor name, agent note, expiry | ✓
| BUMP-3 | Principal must receive a push notification for every bump request                             | ✓
| BUMP-4 | Principal must be able to approve (once or raise limit), deny, or let expire                  | ✓
| BUMP-5 | Approval must generate a one-shot token; agent app must consume it to resume the transaction  | ✓
| BUMP-6 | One-shot tokens must be single-use; second use must return null                               | ✓
| BUMP-7 | Bump requests must expire after a configurable TTL (default 15 min)                           | ✓
| BUMP-8 | Agent must be able to cancel a pending bump request                                           | ✓

### 1.8 Anomaly Scoring

| ID     | Requirement                                                                                            | Status
|---|---|---|
| ANOM-1 | Every transaction must receive an anomaly score (0..1) at `rule_eval` time                             | ✓
| ANOM-2 | Score must be computed from: hour-of-day distribution, amount-vs-median, day-of-week, vendor-frequency | ✓
| ANOM-3 | Score ≥ 0.85 must trigger an `anomaly_alert` notification to the principal                             | ✓
| ANOM-4 | Anomaly score must be stored on the transaction row and returned in transaction detail                 | ✓

### 1.9 Notifications

| ID      | Requirement                                                                                                                                                | Status |
|---|---|---|
| NOTIF-1 | System must send push notifications via Expo Push API for: `txn_settled`, `txn_failed`, `bump_requested`, `bump_decided`, `anomaly_alert`, `refund_received` | ✓
| NOTIF-2 | System must persist in-app notifications for all notification kinds                                                                                          | ✓
| NOTIF-3 | User must be able to mark notifications as read                                                                                                              | ✓
| NOTIF-4 | User must be able to configure per-kind, per-channel preferences: `real_time`, `threshold`, `digest`, `silent`                                               | ✓
| NOTIF-5 | Quiet hours must suppress push notifications between configured start/end minute-of-day                                                                      | ✓
| NOTIF-6 | Sub-wallet snooze must suppress notifications for that sub-wallet until expiry                                                                               | ✓
| NOTIF-7 | Notifications must include a deep-link payload so tapping routes to the relevant screen                                                                      | ✓
| NOTIF-8 | Duplicate notifications must be suppressed via dedupe key                                                                                                    | ✓

### 1.10 Vendor Capture

| ID     | Requirement                                                                         | Status |
|---|---|---|
| VCAP-1 | System must support NQR / bank QR decode to extract account + bank code             | ✓
| VCAP-2 | System must support phone-number-to-account resolution via name enquiry             | ✓
| VCAP-3 | System must support typed account number + bank code with name-enquiry confirmation | ✓
| VCAP-4 | System must return recent vendors per agent for quick repeat payment                | ✓
| VCAP-5 | NFC sticker lookup endpoint must exist (stub) ready for v1.1                        | ✓

### 1.11 Refunds

| ID    | Requirement                                                                                      | Status |
|---|---|---|
| REF-1 | System must support initiating a reversal of a settled transaction                               | ✓
| REF-2 | On refund received from Anchor webhook, transaction must be credited back and principal notified | ✓

---

### 1.12 Digital VAS *(added 2026-08-25)*

| ID | Requirement | Status |
|---|---|---|
| VAS-1 | The wallet must buy airtime, data, electricity and cable, paid to the biller via Anchor's VAS APIs | ✓ |
| VAS-2 | Electricity and cable must resolve the account holder BEFORE any money moves | ✓ |
| VAS-3 | A VAS purchase must be subject to the principal's `category` and `time_window` rules | ✓ |
| VAS-4 | The spend limit must be enforced under an advisory lock; the engine must NOT re-evaluate `limit` outside it | ✓ |
| VAS-5 | An out-of-rule VAS purchase currently REJECTS rather than raising a bump | ✓ `[KNOWN GAP]` |

### 1.13 Marketplace *(added 2026-08-25)*

| ID | Requirement | Status |
|---|---|---|
| MKT-1 | A buyer must be able to browse a curated catalogue and buy a voucher | ✓ |
| MKT-2 | Browse must be filtered by the buyer's OWN active rule set — never show what buying would refuse | ✓ |
| MKT-3 | An agent's browse scope must always be their own sub-wallet; a supplied id must be ignored, not honoured | ✓ |
| MKT-4 | Prices shown must come from `effectivePriceKobo`, never the gross list price | ✓ |
| MKT-5 | The client must never supply a price — the server prices from the catalogue (closes the discount-spoof vector) | ✓ |
| MKT-6 | A catalogue item must carry a spend `category` from the CLOSED vocabulary, distinct from the retailer's free-text `section` | ✓ |
| MKT-7 | A purchase must be evaluated against `category`, `time_window` and `merchant` rules | ✓ |
| MKT-8 | An out-of-rule purchase currently REJECTS; `bump_pending` is unreachable from this path | ✓ `[KNOWN GAP]` |
| MKT-9 | A voucher must expire and refund the buyer automatically if never redeemed (`VOUCHER_TTL_HOURS`) | ✓ |

### 1.14 Retailer onboarding & portal *(added 2026-08-25)*

| ID | Requirement | Status |
|---|---|---|
| RET-1 | Onboarding must be curated: `applied → kyb_pending → approved \| suspended`, driven by ops | ✓ |
| RET-2 | Every guarded transition must be an atomic compare-and-set, never a read-then-write | ✓ |
| RET-3 | KYB must go through Anchor Business KYB; a retailer may SUBMIT but never approve itself | ✓ |
| RET-4 | `approved_at` must record when KYB actually cleared — status alone cannot distinguish an ops suspension from a KYB rejection | ✓ |
| RET-5 | A suspended retailer must NOT publish items or run deals | ✓ |
| RET-6 | A suspended retailer MUST still be able to redeem vouchers already sold, and those payouts must still settle | ✓ (deliberate) |
| RET-7 | A retailer that never passed KYB must not be able to redeem at all | ✓ |
| RET-8 | Redemption must be idempotent and row-locked; a double scan must settle once | ✓ |
| RET-9 | The retailer must be paid on REDEMPTION, not on sale | ✓ |
| RET-10 | Earnings must be settlement history, never a held balance — Amana holds no retailer funds | ✓ |
| RET-11 | Every portal route must authorise by OWNERSHIP in the service layer, never the `actor` claim | ✓ |
| RET-12 | Retailer A must not read or mutate retailer B's data; "not yours" and "does not exist" must be indistinguishable | ✓ |

---

## 2. Technical Requirements

### 2.1 Performance

| Requirement                         | Target |
|---|---|
| P95 API latency (non-NIP endpoints) | < 500 ms
| P99 API latency (non-NIP endpoints) | < 1,000 ms
| Maximum DB query time (happy path)  | < 100 ms
| Cold-start time (Fly machine wake)  | < 3,000 ms

### 2.2 Security

| Requirement |
|---|
| All API communication over HTTPS (TLS 1.2+) enforced by Fly
| JWT access tokens must expire in ≤ 15 minutes
| BVN and NIN must not appear in any API response body
| BVN and NIN must not appear in NIBSS narration strings
| Webhook payload must be verified using HMAC-SHA256 signature (Anchor `X-Anchor-Signature`)
| All secrets (DATABASE_URL, JWT_SECRET, ANCHOR_API_KEY) managed via Fly secrets — never in code or environment files
| Database connection requires `sslmode=require`

### 2.3 Data Integrity

| Requirement |
|---|
| Postings ledger is append-only; no UPDATE or DELETE permitted on `postings` table
| Audit log is append-only; no UPDATE or DELETE permitted on `audit_events` table
| All financial mutations carry an idempotency key
| Migrations are run via Drizzle migrator in Fly `release_command` before traffic is routed to new version

### 2.4 Compliance

| Requirement |
|---|
| Principal must complete CBN KYC Tier 2 (Phone + BVN + NIN) before creating a household
| Principal wallet cap: ₦300,000 at Tier 2
| Agent must complete Phone + NIN verification before joining a household
| NIBSS NIP narration must use hashed agent reference (`AMN/AGT/[hash]`), not NIN
| AML audit log must record actor, action, amount, counterparty, and timestamp for every transaction

---

## 3. Integration Requirements

### 3.1 Anchor (BaaS)

| Requirement |
|---|
| Virtual account provisioning for master wallets
| NIP outbound transfer (debit master wallet, credit vendor)
| Name enquiry (NIP account resolution)
| Webhook ingestion: `transaction.completed`, `transaction.failed`, `refund.processed`
| Sandbox: `https://api.sandbox.getanchor.co`
| Production: `https://api.getanchor.co` (pending KYB approval)

### 3.2 Expo Push Notifications

| Requirement |
|---|
| Device token registration via `POST /devices`
| Push delivery via Expo Push API (handles both FCM and APNS routing)
| Receipt polling not required at MVP (fire-and-forget with in-app fallback)

### 3.3 AWS S3

| Requirement |
|---|
| Pre-signed PUT URL generation for agent photo upload (`POST /media/upload-url`)
| Object key stored in `transactions.attached_media` JSONB
| Bucket policy: private read, pre-signed URLs for any access

### 3.4 PostGIS

| Requirement |
|---|
| Geolocation stored as PostGIS `geometry(Point, 4326)`
| Decoded to `{lat, lng}` by transaction detail service
| Supabase Postgres has PostGIS enabled by default

---

## 4. Constraints & Assumptions

- **BaaS dependency:** Anchor sandbox access is pending KYB approval. Anchor endpoints must be added as Fly secrets before any NIP transfer will succeed. All other features work without Anchor credentials.
- **iOS NFC:** iOS does not support background NFC writing. NFC pairing is Android-only at MVP; QR and SMS deep-link cover iOS.
- **Currency:** NGN only. `amount_kobo` is stored as `bigint` to avoid floating-point precision issues.
- **Wallet balance:** Derived from the postings ledger at query time, not cached. Acceptable at MVP volume.
- **Push delivery guarantees:** Expo Push is best-effort. In-app notification inbox is the durable fallback.
- **Anchor webhook reliability:** Anchor webhooks are assumed reliable at MVP. A reconciliation cron (v1.1) will handle missed events.

---

## 5. Acceptance Criteria

The MVP release is accepted when:

1. All 19 database migrations apply cleanly against a fresh Supabase Postgres instance.
2. All backend tests pass (`pnpm --filter @amana/backend test`) with zero failures.
3. All package typechecks pass (`pnpm typecheck`) with zero errors.
4. Biome lint passes with zero errors (`pnpm exec biome check .`).
5. The `GET /health` endpoint returns HTTP 200 on the deployed Fly instance.
6. A principal can complete the full payment flow end-to-end in a sandbox environment: register → create household → invite agent → set rules → agent pays vendor → principal sees notification and transaction detail.
7. A bump flow completes end-to-end: agent hits rule limit → bump requested → principal approves → agent resumes → NIP transfer settles.
