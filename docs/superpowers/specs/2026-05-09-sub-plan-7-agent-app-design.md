# Sub-plan 7 — Agent mobile app design spec

**Date:** 2026-05-09
**Status:** Approved for planning
**Scope:** Single cohesive plan — auth through receipt, all vendor capture paths, bump flow, three-mechanism pairing, photo attachment.

---

## 1. Goal

Ship the Amana agent app from an empty Expo shell to a fully functional payment client. An agent can install the app, pair with a principal via QR / NFC / SMS deep-link, spend from their sub-wallet using any vendor capture path (NQR scan, phone lookup, typed account, recents), handle the bump exception flow in-app, and document ad-hoc tradesman payments with a note, geolocation, and an optional post-settlement photo.

---

## 2. Decisions locked during design

| # | Decision |
|---|----------|
| D1 | **Single cohesive plan** — not split into sub-plans. |
| D2 | **Photo attachment is post-settlement (Option B)** — payment intent never waits for a photo upload. After settlement, the receipt screen offers "Add photo" → camera → S3 → PATCH. |
| D3 | **All three pairing mechanisms in scope** — QR (cross-platform), NFC (Android), SMS deep-link. NFC requires a targeted patch to the principal app's `PairingScreen` to emit an NDEF record alongside the existing QR. |
| D4 | **Bottom tab navigator** — four tabs: Home, Pay, History, Settings. Pay is always one tap away regardless of current tab. |

---

## 3. Architecture overview

### 3.1 App stack

The agent app (`apps/agent`) is an Expo SDK 51 managed-workflow app, identical in stack to the principal app. It consumes `@amana/api-client` and `@amana/types` from the monorepo.

New dependencies added to `apps/agent/package.json`:
- `@react-navigation/native` + `@react-navigation/native-stack` + `@react-navigation/bottom-tabs` — navigation
- `expo-camera` — NQR scan + photo attachment
- `expo-barcode-scanner` — NIBSS QR decode (used inside NQRScanScreen)
- `expo-location` — GPS capture at confirm time
- `expo-nfc` (Android-only) — NFC tap-to-pair
- `expo-linking` — SMS deep-link ingestion
- `expo-notifications` — push notifications (same as principal app)
- `expo-secure-store` — token storage (same pattern as principal app)

### 3.2 Navigation structure

```
RootNavigator
├── AuthStack (pre-login)
│   ├── PhoneScreen
│   └── VerifyScreen
├── PairingStack (post-login, sub-wallet not yet assigned)
│   ├── PairingMethodScreen
│   ├── QRScanScreen
│   ├── NFCPairScreen
│   └── PairingSuccessScreen
└── MainTabs (post-pairing)
    ├── Home tab → HomeScreen
    ├── Pay tab → CaptureMethodScreen (entry) + nested stack
    ├── History tab → TransactionListScreen + TransactionDetailScreen
    └── Settings tab → SettingsScreen
```

The `RootNavigator` checks `GET /me/sub-wallet` after login:
- 404 → PairingStack
- 200 → MainTabs

SMS deep-links (`amana://pair?token=…`) are handled in `App.tsx` via `Linking.addEventListener` — if a pairing token arrives while the app is in the foreground or cold-launching, it routes directly to `POST /pairing/complete` then `PairingSuccessScreen`.

### 3.3 State management

Same pattern as the principal app — Zustand-free local `useState` per screen, `useFocusEffect` for refetch-on-focus. No global store. The sub-wallet identity (id, name, masterWalletId) is loaded once after pairing and stored in `SecureStore` alongside the JWT, accessible via a `useSubWallet()` hook that reads from the token store.

---

## 4. Screen inventory (20 screens)

### Auth stack

| Screen | Description |
|--------|-------------|
| `PhoneScreen` | Enter phone number → `POST /auth/otp-request`. Pattern-reuse from principal app (new file). |
| `VerifyScreen` | Enter OTP → `POST /auth/otp-verify` → JWT stored. Triggers sub-wallet check. Pattern-reuse. |

### Pairing stack

| Screen | Description |
|--------|-------------|
| `PairingMethodScreen` | Three options: Scan QR, NFC tap (Android badge), SMS deep-link (instruction only — no action needed, handled in App.tsx). |
| `QRScanScreen` | Camera + QR decode. Principal's PairingScreen shows a QR. Decoded token → `POST /pairing/complete` → store subWalletId → PairingSuccessScreen. |
| `NFCPairScreen` | Android NFC: show "Hold phones together" UI. On NFC read, extract token from NDEF record → `POST /pairing/complete`. Falls back gracefully on non-NFC devices. |
| `PairingSuccessScreen` | Shows sub-wallet name + principal phone. "Let's go" → MainTabs. |

### Home tab

| Screen | Description |
|--------|-------------|
| `HomeScreen` | Sub-wallet card: name, available balance, daily/monthly limit snapshot (fetched from sub-wallet detail). Pending bump badge if `bump_pending` transaction exists — taps into History. Refetch on focus. |

### Pay tab

| Screen | Description |
|--------|-------------|
| `CaptureMethodScreen` | Entry to Pay tab. Top: recents list (GET /vendors/recents). Below: three action rows — "Scan QR code", "Pay by phone number", "Pay by account number". |
| `NQRScanScreen` | Camera fullscreen. Scans NIBSS NQR or bank QR. Decoded payload → `POST /vendors/nqr-decode` → resolved vendor. On success, navigate to ConfirmScreen. |
| `PhoneLookupScreen` | Phone number entry with Nigerian formatting. `GET /vendors/phone-lookup`. Resolved name displayed before proceeding. |
| `AccountEntryScreen` | Bank picker (searchable dropdown of Nigerian banks) + account number field. `GET /vendors/name-enquiry`. Resolved name displayed. |
| `ConfirmScreen` | The critical UX moment. Resolved vendor name in large bold text (for in-person read-aloud verification). Amount input. Category picker (ad-hoc service suggested first for new vendors). Optional: note text field (free text), GPS toggle (captures device location at tap time). "Send" → `POST /transactions/intent` then `POST /transactions/:id/evaluate`. |
| `BumpWaitScreen` | Shown when evaluate returns `bump_pending`. Displays: sub-wallet name, amount, vendor, expiry countdown (live timer). "Cancel" → `DELETE /transactions/:id/bump`. Updates on `bump_decided` push notification: if approved → SendingScreen; if denied/expired/cancelled → FailedScreen. |
| `SendingScreen` | In-flight spinner. Polls `GET /transactions/:id` every 3 s for up to 30 s while transaction is `in_flight`. Also listens for `txn_settled` / `txn_failed` push. Whichever arrives first wins. |
| `ReceiptScreen` | Settlement confirmed. Shows: amount (large), vendor name, masked account, NIBSS session ID, settled timestamp. Two action buttons: "Show recipient" (→ ShowRecipientScreen) and "Add photo" (→ PhotoAttachScreen). Dismiss navigates to Home. |
| `ShowRecipientScreen` | Fullscreen, portrait-locked. Large text: "₦X,XXX sent to [Resolved Name]". Sub-text: "NIBSS session: [ID] · Should appear in your bank within 30 seconds." Single "Back" button. Designed to be handed to the tradesman as proof. |
| `PhotoAttachScreen` | Camera capture (expo-camera). Preview + "Use photo" / "Retake". On confirm: `POST /media/upload-url` → PUT to S3 URL → `PATCH /transactions/:id/media`. Shows progress. On success, returns to ReceiptScreen with photo attached badge. |
| `FailedScreen` | Payment failed or bump denied/expired/cancelled. Shows error message from `TransactionDetail.errorMessage`. Retry button (returns to CaptureMethodScreen with vendor pre-filled from recents) or dismiss to Home. |

### History tab

| Screen | Description |
|--------|-------------|
| `TransactionListScreen` | Paginated list of agent's transactions via `GET /sub-wallets/:id/transactions`. Status badges, amount, vendor, date. Tap → TransactionDetailScreen. Pull-to-refresh. |
| `TransactionDetailScreen` | Reuses `@amana/types TransactionDetail` DTO. Agent-accessible via updated `GET /transactions/:id`. Shows all fields including errorMessage, anomalyScore badge (≥ 0.85), geolocation link, agentNote. If `settled` and `attached_media` is null: shows "Add photo" button → PhotoAttachScreen. |

### Settings tab

| Screen | Description |
|--------|-------------|
| `SettingsScreen` | Sub-wallet name (read-only), linked principal phone, push notification toggle → EnableNotificationsScreen, sign out. |
| `EnableNotificationsScreen` | Pattern-reuse from principal app. Push permission request modal. |

### Principal app patch

| Change | Description |
|--------|-------------|
| `PairingScreen` (principal) | Add NFC emit alongside existing QR. Android only: `expo-nfc` writes an NDEF text record containing the same pairing token already embedded in the QR. iOS shows QR only (NFC background tag reading requires entitlements; not worth the complexity at MVP). |

---

## 5. Backend API changes

### 5.1 New routes

#### `GET /me/sub-wallet`
- **Auth:** JWT required (agent)
- **Response 200:**
  ```json
  {
    "subWallet": { "id": "uuid", "name": "Tunde's allowance", "masterWalletId": "uuid" },
    "principal": { "userId": "uuid", "phone": "+2348011111111" }
  }
  ```
- **Response 404:** `{ "error": "not_paired" }` — no sub-wallet with `agent_user_id = JWT.userId`
- **Implementation:** `SELECT sw.*, h.principal_user_id, pu.phone FROM sub_wallets sw JOIN master_wallets mw ON mw.id = sw.master_wallet_id JOIN households h ON h.id = mw.household_id JOIN users pu ON pu.id = h.principal_user_id WHERE sw.agent_user_id = $userId LIMIT 1`

#### `GET /sub-wallets/:id/transactions`
- **Auth:** JWT required; agent must be `sub_wallets.agent_user_id`
- **Query params:** `limit` (default 20, max 50), `cursor` (last `transaction.id` from previous page)
- **Response 200:**
  ```json
  {
    "transactions": [TransactionSummary],
    "nextCursor": "uuid | null"
  }
  ```
- **`TransactionSummary` fields:** `id`, `kind`, `status`, `amountKobo` (string), `vendorResolvedName`, `vendorAccountMasked`, `initiatedAt`, `settledAt`
- **Response 403:** `{ "error": "forbidden" }` if caller is not the sub-wallet's agent
- **Pagination:** cursor-based on `(created_at DESC, id DESC)` — stable under concurrent inserts

#### `POST /media/upload-url`
- **Auth:** JWT required (any role)
- **Body:** `{ "transactionId": "uuid", "contentType": "image/jpeg" | "image/png" }`
- **Response 200:** `{ "uploadUrl": "https://s3.amazonaws.com/...", "key": "media/txn-uuid/timestamp.jpg" }`
- **Response 404:** transaction not found or not accessible to caller
- **Implementation:** AWS SDK `PutObjectCommand` with pre-signed URL (expires 15 min). Key format: `media/{transactionId}/{Date.now()}.{ext}`. Bucket name from `process.env.MEDIA_BUCKET`.

#### `PATCH /transactions/:id/media`
- **Auth:** JWT required; agent must own the transaction's sub-wallet
- **Body:** `{ "mediaKey": "media/txn-uuid/timestamp.jpg" }`
- **Response 200:** `{ "ok": true }`
- **Response 409:** `{ "error": "not_settled" }` — transaction must be `settled`
- **Response 403:** `{ "error": "forbidden" }`
- **Implementation:** Sets `attached_media = { key: mediaKey, uploadedAt: new Date().toISOString() }` as JSONB on the transaction row.

#### `DELETE /transactions/:id/bump`
- **Auth:** JWT required; agent must own the transaction's sub-wallet
- **Body:** none
- **Response 200:** `{ "ok": true }`
- **Response 409:** `{ "error": "not_bump_pending" }` — transaction must be `bump_pending`
- **Response 403:** `{ "error": "forbidden" }`
- **Implementation:** In a transaction: set `bump_requests.status = 'cancelled'`, `transactions.status = 'failed'`, `transactions.error_message = 'CANCELLED_BY_AGENT'`.

### 5.2 Modified routes

#### `GET /transactions/:id`
- **Before:** returns 403 `principal_only` for any non-principal caller
- **After:** agents may access transactions from their own sub-wallet. Route handler dispatches:
  - `role === 'principal'` → `transactionDetailService.getByIdForPrincipal(db, id, userId)`
  - `role === 'agent'` → `transactionDetailService.getByIdForAgent(db, id, userId)`
- **`getByIdForAgent`:** same join graph as `getByIdForPrincipal`, different WHERE: `AND sw.agent_user_id = $agentUserId`. Returns null (→ 404) for any transaction not belonging to the agent's sub-wallet — no existence leak.

### 5.3 Schema migration (`0019`)

```sql
ALTER TYPE bump_request_status ADD VALUE 'cancelled';
```

One change. No column additions — `attached_media`, `geolocation`, `agent_note` already exist on `transactions`.

### 5.4 New environment variables

```
MEDIA_BUCKET=amana-media-af-south-1     # S3 bucket name
AWS_REGION=af-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Added to `.env.example`. AWS credentials are scoped to `s3:PutObject` on the media bucket only.

---

## 6. `@amana/types` additions

```ts
// packages/types/src/transaction.ts (extend existing file)

export type TransactionSummary = {
  id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountKobo: string;
  vendorResolvedName: string | null;
  vendorAccountMasked: string | null;
  initiatedAt: string;
  settledAt: string | null;
};

export type TransactionListResponse = {
  transactions: TransactionSummary[];
  nextCursor: string | null;
};

// packages/types/src/sub-wallet.ts (new file)

export type SubWalletWithPrincipal = {
  subWallet: { id: string; name: string; masterWalletId: string };
  principal: { userId: string; phone: string };
};
```

`BumpRequestStatus` in `packages/types/src/bump.ts` (or wherever it lives) gains `'cancelled'`.

---

## 7. `@amana/api-client` additions

### New: `VendorApi`
```ts
nameEnquiry(bankCode: string, accountNumber: string, subWalletId: string): Promise<ResolvedVendor>
phoneLookup(phoneNumber: string, subWalletId: string): Promise<ResolvedVendor>
nqrDecode(payload: string, subWalletId: string): Promise<ResolvedVendor>
recents(subWalletId: string): Promise<RecentVendor[]>
```

### New: `MediaApi`
```ts
getUploadUrl(transactionId: string, contentType: 'image/jpeg' | 'image/png'): Promise<{ uploadUrl: string; key: string }>
attachMedia(transactionId: string, mediaKey: string): Promise<void>
```

### New: `MeApi`
```ts
getSubWallet(): Promise<SubWalletWithPrincipal>
```

### Extended: `SubWalletApi`
```ts
getTransactions(subWalletId: string, cursor?: string, limit?: number): Promise<TransactionListResponse>
```

### Extended: `BumpApi`
```ts
cancelBump(transactionId: string): Promise<void>
```

All wired into `AmanaApiClient` constructor: `this.vendor`, `this.media`, `this.me`.

---

## 8. Key flow details

### 8.1 Payment flow

1. Agent taps Pay tab → `CaptureMethodScreen`
2. Selects capture path → vendor resolved → `ConfirmScreen`
3. On `ConfirmScreen`: name shown large for in-person verification. Agent enters amount. Category defaults to "Ad-hoc service" for new vendors. Optional note + GPS toggle captured at tap time.
4. Tap "Send" → `POST /transactions/intent` (creates DRAFT with `agentNote`, `geolocation` if captured) → `POST /transactions/:id/evaluate`
5. **allow path:** navigate to `SendingScreen`. Poll `GET /transactions/:id` every 3 s (max 10 polls = 30 s) while `status === 'in_flight'`. Also listen for `txn_settled` / `txn_failed` push — whichever resolves first wins. On `settled` → `ReceiptScreen`. On `failed` → `FailedScreen`.
6. **bump_pending path:** navigate to `BumpWaitScreen`. Live expiry countdown. Cancel → `DELETE /transactions/:id/bump` → `FailedScreen`. On `bump_decided` push: `approved` → `SendingScreen`; `denied` / `expired` / `cancelled` → `FailedScreen` with reason.

### 8.2 Post-settlement photo (Option B)

`ReceiptScreen` shows "Add photo" button only when `attached_media` is null.

Flow: tap "Add photo" → `PhotoAttachScreen` → expo-camera capture → preview → "Use photo" → `POST /media/upload-url` → PUT to S3 pre-signed URL (direct, no backend proxy) → `PATCH /transactions/:id/media` with the key → return to `ReceiptScreen` with photo badge shown.

If upload fails, the agent sees an error with a retry button. Payment is already settled and unaffected.

GPS coordinates are captured via `expo-location` at the moment the agent taps "Send" on `ConfirmScreen`, stored in `transactions.geolocation` via the intent body. Not re-captured at photo time.

### 8.3 Pairing flow

After OTP login, `RootNavigator` calls `GET /me/sub-wallet`:
- **200:** sub-wallet stored in SecureStore alongside JWT → `MainTabs`
- **404:** → `PairingStack`

**QR path:** `QRScanScreen` reads the NIBSS-style pairing QR that `PairingScreen` (principal app) already displays. Token decoded → `POST /pairing/complete` → 200 with `{ subWalletId }` → store → `PairingSuccessScreen`.

**NFC path (Android):** `NFCPairScreen` uses `expo-nfc` to read an NDEF text record. Principal's `PairingScreen` is patched to also write the same pairing token as an NDEF record when the Android NFC adapter is available (`expo-nfc` on principal side too). Both phones must be on Android with NFC enabled. On read → same `POST /pairing/complete` flow.

**SMS deep-link path:** Principal generates deep-link (`amana://pair?token=…`) from `PairingScreen` share button. Agent taps → app opens → `App.tsx` `Linking.addEventListener` intercepts → if not yet paired, routes to `PairingStack` with token pre-filled → `POST /pairing/complete` → `PairingSuccessScreen`. If already logged out, token is held in a pending ref until login completes.

### 8.4 Push notifications

Agent app registers an Expo push token exactly like the principal app. `txn_settled`, `txn_failed`, and `bump_decided` push notifications all carry `transactionId` in data, enabling deep-link into `TransactionDetailScreen`. `deepLinkFor` (agent lib/push.ts) handles these kinds identically to the principal app's implementation.

---

## 9. Testing approach

### 9.1 Backend (TDD, vitest + real postgres)

All new routes follow the red-green-commit cycle used throughout the codebase.

| Test file | New cases (approx) |
|-----------|-------------------|
| `tests/routes/me.test.ts` | ~6: 200 paired agent, 404 unpaired, 403 principal caller, 401 unauthed |
| `tests/routes/media.test.ts` | ~8: upload-url 200 (mocked S3 signer), PATCH 200, 409 not-settled, 403 wrong agent, 404 txn not found |
| `tests/routes/transactions.test.ts` (extended) | ~8: agent GET /:id 200 (own), 404 (other agent — no leak), DELETE /bump 200, 409, 403 |
| `tests/routes/sub-wallets.test.ts` (extended) | ~6: GET /:id/transactions 200 with pagination, 403 wrong agent |
| `tests/modules/transactions/detail.service.test.ts` (extended) | ~4: `getByIdForAgent` own txn, null for other household, null for other agent |

**S3 mocking:** `POST /media/upload-url` uses a `mediaService` that wraps the AWS SDK. Tests inject a mock `mediaService` via the same pattern used for `anchorAdapterSingleton` — a module-level singleton that can be swapped in test setup. No real S3 calls in tests.

### 9.2 API client (vitest, mock fetch)

| Test file | New cases |
|-----------|-----------|
| `packages/api-client/tests/vendor-api.test.ts` | ~8: one case per method, assert path + bearer header |
| `packages/api-client/tests/media-api.test.ts` | ~4: getUploadUrl, attachMedia, error on 404 |
| `packages/api-client/tests/me-api.test.ts` | ~3: 200, 404 throws ApiError |
| `packages/api-client/tests/sub-wallet-api.test.ts` (extended) | ~3: getTransactions with cursor |

### 9.3 Agent app pure logic (vitest)

| Test file | Cases |
|-----------|-------|
| `apps/agent/src/lib/push.test.ts` | `deepLinkFor` for `txn_settled`, `txn_failed`, `bump_decided` — returns `{ kind: 'transaction', transactionId }` |

### 9.4 Mobile screens

Typecheck-only — same as the principal app. All 20 screens compile cleanly against their registered `MainStackParamList` / tab param types. No React Native Testing Library wired at MVP.

### 9.5 Approximate test count

~50 new cases: ~32 backend, ~14 API client, ~4 agent pure logic.

---

## 10. Out of scope

The following are explicitly excluded from sub-plan 7:

- **Agent transaction history export** (statement PDF) — v1.1
- **Retry on failed payment** — agent returns to CaptureMethodScreen manually; no auto-retry
- **Agent-to-agent transfers** — not a supported flow; agents spend to vendors only
- **iOS NFC pairing** — requires Apple NFC entitlements and background tag reading; deferred to v1.1. iOS agents pair via QR or SMS only.
- **In-app photo viewer** on TransactionDetailScreen — photos stored in S3 but display requires signed GET URL. MVP: "Add photo" badge shown, tap-to-view deferred to v1.1.
- **Accessibility audit** — scheduled for the sub-plan 8 pre-launch hardening pass
- **Biometric / PIN lock** — deferred to v1.1; SecureStore JWT is the auth boundary at MVP

---

## 11. File structure produced by this plan

**Created (agent app):**
- `apps/agent/App.tsx` (replace shell)
- `apps/agent/src/lib/api.ts`
- `apps/agent/src/lib/push.ts`
- `apps/agent/src/lib/push.test.ts`
- `apps/agent/src/lib/secure-token-store.ts`
- `apps/agent/src/nav/RootNavigator.tsx`
- `apps/agent/src/nav/AuthStack.tsx`
- `apps/agent/src/nav/PairingStack.tsx`
- `apps/agent/src/nav/MainTabs.tsx`
- `apps/agent/src/screens/PhoneScreen.tsx`
- `apps/agent/src/screens/VerifyScreen.tsx`
- `apps/agent/src/screens/PairingMethodScreen.tsx`
- `apps/agent/src/screens/QRScanScreen.tsx`
- `apps/agent/src/screens/NFCPairScreen.tsx`
- `apps/agent/src/screens/PairingSuccessScreen.tsx`
- `apps/agent/src/screens/HomeScreen.tsx`
- `apps/agent/src/screens/CaptureMethodScreen.tsx`
- `apps/agent/src/screens/NQRScanScreen.tsx`
- `apps/agent/src/screens/PhoneLookupScreen.tsx`
- `apps/agent/src/screens/AccountEntryScreen.tsx`
- `apps/agent/src/screens/ConfirmScreen.tsx`
- `apps/agent/src/screens/BumpWaitScreen.tsx`
- `apps/agent/src/screens/SendingScreen.tsx`
- `apps/agent/src/screens/ReceiptScreen.tsx`
- `apps/agent/src/screens/ShowRecipientScreen.tsx`
- `apps/agent/src/screens/PhotoAttachScreen.tsx`
- `apps/agent/src/screens/FailedScreen.tsx`
- `apps/agent/src/screens/TransactionListScreen.tsx`
- `apps/agent/src/screens/TransactionDetailScreen.tsx`
- `apps/agent/src/screens/SettingsScreen.tsx`
- `apps/agent/src/screens/EnableNotificationsScreen.tsx`

**Created (backend):**
- `apps/backend/src/db/migrations/0019_bump_request_cancelled.sql`
- `apps/backend/src/db/migrations/meta/0019_snapshot.json`
- `apps/backend/src/modules/media/media.service.ts`
- `apps/backend/src/routes/me.ts` (extended with sub-wallet route)
- `apps/backend/tests/routes/me.test.ts`
- `apps/backend/tests/routes/media.test.ts`

**Created (packages):**
- `packages/types/src/sub-wallet.ts`
- `packages/api-client/src/vendor-api.ts`
- `packages/api-client/src/media-api.ts`
- `packages/api-client/src/me-api.ts`
- `packages/api-client/tests/vendor-api.test.ts`
- `packages/api-client/tests/media-api.test.ts`
- `packages/api-client/tests/me-api.test.ts`

**Modified:**
- `apps/backend/src/db/schema/bump-requests.ts` (add `cancelled` to status enum)
- `apps/backend/src/modules/transactions/detail.service.ts` (add `getByIdForAgent`)
- `apps/backend/src/routes/transactions.ts` (dispatch to agent service method)
- `apps/backend/src/routes/sub-wallets.ts` (add `GET /:id/transactions`)
- `apps/backend/tests/routes/transactions.test.ts` (agent GET + DELETE bump cases)
- `apps/backend/tests/routes/sub-wallets.test.ts` (transactions list cases)
- `apps/backend/tests/modules/transactions/detail.service.test.ts` (agent path cases)
- `packages/types/src/transaction.ts` (add `TransactionSummary`, `TransactionListResponse`)
- `packages/types/src/index.ts` (re-export sub-wallet)
- `packages/api-client/src/client.ts` (wire `vendor`, `media`, `me`)
- `packages/api-client/src/index.ts` (re-export new APIs)
- `packages/api-client/src/sub-wallet-api.ts` (add `getTransactions`)
- `packages/api-client/src/bump-api.ts` (add `cancelBump`)
- `packages/api-client/tests/sub-wallet-api.test.ts` (getTransactions cases)
- `apps/principal/src/screens/PairingScreen.tsx` (add NFC emit, Android only)
- `apps/agent/package.json` (add nav + camera + location + nfc + notifications + secure-store deps)
