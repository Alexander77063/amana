# Amana — Backend Schema

**Version:** 1.0 | **Date:** 2026-05-13
**Stack:** Hono · Drizzle ORM 0.34.1 · Postgres 15 (Supabase + PostGIS)
**API base:** `https://amana-api.fly.dev` (staging) / `https://api.amana-ng.com` (production)

> **Executive summary:** The Amana backend is a stateless Hono (Node.js) API with a Postgres database managed via Drizzle ORM. The data model is built around five domains: identity (users, households), wallets (master + sub-wallets, ledger), transactions, rules + bumps, and notifications. The API is JWT-authenticated, role-gated, and uses idempotency keys on all financial mutations. 19 migrations have been applied to the current schema.

---

## 1. Data Model

### 1.1 Identity domain

#### `users`
| Column       | Type                       | Notes |
| `id`         | uuid PK                    | auto-generated 
| `role`       | enum(`principal`,`agent`)  | immutable after creation 
| `phone`      | text UNIQUE                | primary identity 
| `bvn`        | text nullable              | principals only 
| `nin`        | text                       | required for all 
| `kyc_tier`   | enum(`1`,`2`,`3`)          | Tier 2 for principals 
| `status`     | enum(`active`,`suspended`) | default `active` 
| `created_at` | timestamptz | 

#### `households`
| Column              | Type            | Notes |
| `id`                | uuid PK         | 
| `principal_user_id` | uuid FK → users | one principal per household 
| `name`              | text            | household display name 
| `created_at`        | timestamptz     | 

#### `household_members`
| Column         | Type                       | Notes |
| `household_id` | uuid FK → households       | composite PK 
| `user_id`      | uuid FK → users            | composite PK 
| `status`       | enum(`active`,`suspended`) | 
| `joined_at`    | timestamptz                | 

### 1.2 Wallet domain

#### `master_wallets`
| Column                   | Type                    | Notes |
| `id`                     | uuid PK                 | 
| `household_id`           | uuid FK → households    | one wallet per household 
| `anchor_virtual_account` | text                    | NIP-in account number 
| `anchor_bank_code`       | text                    | NIP-in bank code 
| `anchor_account_id`      | text                    | Anchor internal reference 
| `currency`               | text                    | default `NGN` 
| `status`                 | enum(`active`,`frozen`) | 
| `created_at`             | timestamptz             | 

#### `sub_wallets`
| Column             | Type                                | Notes |
| `id`               | uuid PK                             | 
| `master_wallet_id` | uuid FK → master_wallets            | 
| `agent_user_id`    | uuid FK → users                     | the assigned agent 
| `name`             | text                                | principal-chosen label (e.g. "Amina's wallet") 
| `status`           | enum(`active`,`suspended`,`closed`) | 
| `created_at`       | timestamptz                         | 

#### `ledger_accounts`
| Column             | Type                                             | Notes |
| `id`               | uuid PK                                          | 
| `master_wallet_id` | uuid FK                                          | 
| `kind`             | enum(`master`,`sub`,`suspense`,`fee`,`external`) | 
| `sub_wallet_id`    | uuid FK nullable                                 | only for `sub` kind 
| `normal_side`      | enum(`debit`,`credit`)                           | double-entry 

#### `postings` (append-only)
| Column              | Type                      | Notes |
| `id`                | uuid PK                   | 
| `ledger_account_id` | uuid FK → ledger_accounts | 
| `transaction_id`    | uuid FK → transactions    | 
| `amount_kobo`       | bigint                    | 
| `side`              | enum(`debit`,`credit`)    | 
| `created_at`        | timestamptz               | 

*No UPDATE or DELETE ever runs on `postings`. Enforced by DB trigger (`0005_postings_immutable`).*

### 1.3 Transaction domain

#### `transactions`
| Column                 | Type                                            | Notes |
| `id`                   | uuid PK                                         | 
| `master_wallet_id`     | uuid FK                                         | 
| `sub_wallet_id`        | uuid FK nullable                                | null = principal direct spend 
| `kind`                 | enum(`spend`,`topup`,`refund`,`fee`,`reversal`) | 
| `amount_kobo`          | bigint                                          | stored in kobo (1 NGN = 100 kobo) 
| `status`               | enum(`draft`,`rule_eval`,`bump_pending`,`in_flight`,`settled`,`failed`,`reversed`)  
| `idempotency_key`      | text UNIQUE                                     | client-supplied           
| `nibss_session_id`     | text nullable                                   | populated on settlement 
| `vendor_account`       | text nullable                                   | destination account number 
| `vendor_bank_code`     | text nullable                                   | destination bank code 
| `vendor_resolved_name` | text nullable                                   | from name enquiry 
| `category`             | text nullable                                   | merchant category 
| `anomaly_score`        | decimal(3,2) nullable                           | 0.00–1.00 
| `bump_request_id`      | uuid FK nullable                                | FK to bump_requests 
| `agent_note`           | text nullable                                   | 
| `error_message`        | text nullable                                   | populated when status=`failed` 
| `geolocation`          | geometry(Point,4326) nullable                   | PostGIS point 
| `attached_media`       | jsonb nullable                                  | S3 object references 
| `created_at`           | timestamptz                                     | 
| `settled_at`           | timestamptz nullable                            | 

#### `idempotency_keys`
| Column           | Type        | Notes |
| `key`            | text PK     | 
| `transaction_id` | uuid FK     | 
| `created_at`     | timestamptz | 

### 1.4 Rules & Bumps domain

#### `rule_sets`
| Column               | Type                        | Notes |
| `id`                 | uuid PK                     | 
| `sub_wallet_id`      | uuid FK                     | 
| `version`            | integer                     | monotonically increasing 
| `status`             | enum(`active`,`superseded`) | only one active per sub-wallet 
| `effective_from`     | timestamptz                 | 
| `created_by_user_id` | uuid FK                     | 
| `created_at`         | timestamptz                 | 

#### `rules`
| Column        | Type                | Notes |
| `id`          | uuid PK             | 
| `rule_set_id` | uuid FK → rule_sets | 
| `kind`        | enum(`limit`,`category`,`time_window`,`allowlist`,`anomaly_threshold`) | 
| `config_json` | jsonb               | rule parameters (varies by kind) 
| `priority`    | integer             | evaluation order 

**Rule config examples:**
```json
// limit
{ "period": "week", "amountKobo": 2000000 }

// category
{ "allowedCategories": ["food_beverage", "transport", "education"] }

// time_window
{ "days": [1,2,3,4,5], "startMinute": 420, "endMinute": 1140 }

// anomaly_threshold
{ "maxScore": 0.85 }
```

#### `bump_requests`
| Column                 | Type             | Notes |
| `id`                   | uuid PK          | 
| `transaction_id`       | uuid FK          | 
| `sub_wallet_id`        | uuid FK          |
| `requested_by_user_id` | uuid FK          | agent 
| `amount_kobo`          | bigint           |  
| `vendor_resolved_name` | text             |
| `agent_note`           | text nullable    | 
| `status`               | enum(`pending`,`approved_once`,`raise_limit`,`denied`,`expired`,`cancelled`) 
| `expires_at`           | timestamptz      | TTL (default 15 min) 
| `decided_by_user_id`   | uuid FK nullable | principal 
| `decided_at`           | timestamptz nullable  
| `created_at`           | timestamptz      | 

#### `one_shot_tokens`
| Column | Type | Notes |
|---|---|---|
| `token` | text PK | random UUID |
| `bump_request_id` | uuid FK | |
| `consumed_at` | timestamptz nullable | null = unused |
| `expires_at` | timestamptz | |
| `created_at` | timestamptz | |

### 1.5 Notifications domain

#### `notifications`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `recipient_user_id` | uuid FK | |
| `kind` | enum(`bump_requested`,`bump_decided`,`txn_settled`,`txn_failed`,`anomaly_alert`,`refund_received`) | |
| `channel` | enum(`push`,`sms`,`in_app`) | |
| `status` | enum(`pending`,`sent`,`failed`,`skipped`,`read`) | |
| `dedupe_key` | text | uniqueness guard |
| `payload_json` | jsonb | full notification payload incl. deep-link |
| `provider_receipt` | text nullable | Expo receipt ID |
| `error_message` | text nullable | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `notification_preferences`
Composite PK: (`user_id`, `kind`, `channel`)

| Column | Type |
|---|---|
| `user_id` | uuid FK |
| `kind` | notification_kind |
| `channel` | notification_channel |
| `preference` | enum(`real_time`,`threshold`,`digest`,`silent`) |
| `threshold_kobo` | text nullable |
| `updated_at` | timestamptz |

#### `device_tokens`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `expo_push_token` | text UNIQUE | |
| `platform` | enum(`ios`,`android`) | |
| `device_label` | text nullable | |
| `registered_at` | timestamptz | |
| `last_seen_at` | timestamptz | |

#### `subwallet_snooze`
Composite PK: (`user_id`, `sub_wallet_id`)

| Column | Type |
|---|---|
| `user_id` | uuid FK |
| `sub_wallet_id` | uuid FK |
| `expires_at` | timestamptz nullable |
| `created_at` | timestamptz |

#### `user_quiet_hours`
PK: `user_id`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid FK | |
| `enabled` | boolean | default false |
| `start_minute` | smallint | minutes since midnight |
| `end_minute` | smallint | minutes since midnight |
| `updated_at` | timestamptz | |

### 1.6 Audit & Supporting

#### `audit_events` (append-only)
Immutable audit log. Enforced by DB trigger (`0007_audit_immutable`).

#### `recents`
Recent vendor cache per user for quick repeat payment.

#### `stickers`
NFC sticker → vendor account resolution. Stub in MVP; active in v1.1.

---

## 2. API Endpoints

All endpoints require `Authorization: Bearer <JWT>` unless noted.

### 2.1 Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | None | Request OTP to phone |
| POST | `/auth/otp/verify` | None | Verify OTP → tokens |
| POST | `/auth/refresh` | Refresh token | Rotate access token |
| GET | `/auth/me` | Required | Current user profile |
| POST | `/auth/logout` | Required | Invalidate refresh token |

### 2.2 Households

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/households` | principal | Create household |
| GET | `/me/household` | principal | Get own household |
| GET | `/me/household/members` | principal | List members |
| GET | `/households/:id/sub-wallets` | principal | List sub-wallets with balances |
| POST | `/households/:id/sub-wallets` | principal | Create sub-wallet |

### 2.3 Pairing

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/pairing` | principal | Generate pairing token + deep-link |
| POST | `/pairing/complete` | agent | Complete pairing with token |

### 2.4 Sub-wallets

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/sub-wallets/:id` | both | Get sub-wallet detail |
| PATCH | `/sub-wallets/:id` | principal | Update name/status |
| GET | `/sub-wallets/:id/balance` | both | Current balance in kobo |
| GET | `/sub-wallets/:id/rules` | principal | Active rule set |
| POST | `/sub-wallets/:id/rules` | principal | Create new rule set version |
| PUT | `/sub-wallets/:id/snooze` | principal | Set snooze (body: `{expiresAt}`) |
| DELETE | `/sub-wallets/:id/snooze` | principal | Clear snooze |
| GET | `/sub-wallets/:id/transactions` | both | Paginated transaction list |
| GET | `/me/sub-wallet` | agent | Agent's own sub-wallet |

### 2.5 Transactions

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/transactions/intent` | both | Create draft transaction |
| POST | `/transactions/:id/evaluate` | both | Run rule evaluation |
| POST | `/transactions/:id/send` | both | Initiate NIP transfer |
| POST | `/transactions/:id/resume-after-bump` | agent | Resume post-bump-approval |
| GET | `/transactions/:id` | both | Receipt-grade transaction detail (404 on cross-household) |
| PATCH | `/transactions/:id/media` | agent | Attach photo/note/GPS |
| DELETE | `/transactions/:id/bump` | agent | Cancel pending bump |

### 2.6 Bumps

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/me/bumps` | principal | List pending bump requests |
| POST | `/bumps/:id/decision` | principal | Approve / raise limit / deny |

### 2.7 Vendors

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/vendors/name-enquiry` | Required | NIP account name lookup |
| GET | `/vendors/phone-lookup` | Required | Phone → account resolution |
| GET | `/vendors/sticker/:uuid` | Required | NFC sticker → vendor (v1.1 stub) |
| POST | `/vendors/nqr-decode` | Required | Decode NQR / bank QR payload |
| GET | `/vendors/recents` | Required | Recent vendor list for agent |

### 2.8 Notifications

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/me/notifications` | both | Paginated in-app inbox |
| POST | `/me/notifications/:id/read` | both | Mark as read |
| GET | `/me/notification-preferences` | both | Get all preferences |
| PUT | `/me/notification-preferences` | both | Update preferences |
| GET | `/me/quiet-hours` | both | Get quiet hours config |
| PUT | `/me/quiet-hours` | both | Set quiet hours |

### 2.9 Devices

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/devices` | both | Register Expo push token |
| DELETE | `/devices/:id` | both | Unregister device |

### 2.10 Media

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/media/upload-url` | agent | Get pre-signed S3 PUT URL |

### 2.11 Misc

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Health check → `{status: "ok"}` |
| POST | `/webhooks/anchor` | HMAC | Anchor event webhook |

---

## 3. Auth & Authorisation Model

### 3.1 JWT structure

```json
{
  "sub": "<user_id>",
  "role": "principal" | "agent",
  "householdId": "<household_id>",
  "iat": 1234567890,
  "exp": 1234568790
}
```

### 3.2 Role-based access

- **Principal** endpoints verify `actor.role === 'principal'` and that the resource belongs to `actor.householdId`
- **Agent** endpoints verify `actor.role === 'agent'` and that the sub-wallet belongs to the agent's household
- **Cross-household access** returns HTTP 404 (not 403) to prevent existence leaks

### 3.3 Webhook auth

Anchor webhooks verified via `HMAC-SHA256(secret, rawBody)` compared against `X-Anchor-Signature` header. Requests with invalid signatures return HTTP 400 and are not processed.

---

## 4. Key Business Logic

### 4.1 Rule evaluation sequence

```
1. Load active rule set for sub_wallet_id
2. For each rule (ordered by priority):
   a. limit → sum postings for period; compare to threshold
   b. category → check txn.category against allowedCategories
   c. time_window → check current UTC time against days/startMinute/endMinute
   d. allowlist → check vendor_account against allowedAccounts
   e. anomaly_threshold → compare pre-computed score to maxScore
3. First failing rule → return {kind: 'bump'} and create bump_request
4. All pass → return {kind: 'allow'}
```

### 4.2 Anomaly scoring

Four features, each 0..1, averaged:
- `hourOfDay`: Laplace-smoothed deviation from the agent's historical hour distribution
- `amountVsMedian`: ratio of current amount to rolling median amount
- `dayOfWeek`: same Laplace approach on day-of-week distribution
- `vendorFrequency`: inverse frequency of vendor in recent transactions

Score ≥ 0.85 → `anomaly_alert` notification to principal.

### 4.3 Double-entry ledger

Every `transactions.setStatus('settled')` call writes two postings atomically:
- DEBIT `sub` (or `master` for direct spend) ledger account
- CREDIT `external` ledger account

Balance query = `SUM(credits) - SUM(debits)` on the ledger account's postings.

---

## 5. Migration History

| Migration | Description |
|---|---|
| 0000 | Initial schema — extensions (uuid-ossp, postgis) |
| 0001 | Identity — users, households, household_members |
| 0002 | Wallet — master_wallets, sub_wallets, ledger_accounts |
| 0003 | Transactions |
| 0004 | Postings |
| 0005 | Postings immutable trigger |
| 0006 | Audit events |
| 0007 | Audit immutable trigger |
| 0008 | Idempotency keys |
| 0009 | Sticker table (v1.1 stub) |
| 0010 | Rule sets |
| 0011 | Rules |
| 0012 | Bump requests + one-shot tokens |
| 0013 | Transactions bump_request_id FK |
| 0014 | Recents + anchor_account_id on master_wallets |
| 0015 | Notifications — all notification tables |
| 0016 | Device tokens |
| 0017 | Subwallet snooze + quiet hours |
| 0018 | `transactions.error_message` column |
| 0019 | `bump_status.cancelled` enum value |

---

## 6. External Integrations

| Service | Purpose | Config |
|---|---|---|
| **Anchor** | BaaS — virtual accounts, NIP transfers, name enquiry, webhooks | `ANCHOR_API_KEY`, `ANCHOR_WEBHOOK_SECRET`, `ANCHOR_API_BASE_URL` |
| **Expo Push** | Push notification delivery (FCM + APNS routing) | No server key required — uses Expo's public API |
| **AWS S3** | Agent photo storage (pre-signed PUT URLs) | AWS credentials via env vars |
| **Supabase Postgres** | Primary database | `DATABASE_URL` |
| **PostGIS** | Geolocation storage and decode | Enabled on Supabase by default |
