# Sub-plan 6b-3 — Principal Mobile App: inbox + push (design spec)

> Status: design approved, ready for implementation-plan generation. Date: 2026-05-05.

## Goal

A principal user can pair agents with a QR code (not just a typed pairing string), receive push notifications when an agent requests a spend bump or when transactions settle/fail, see all pending bump requests in a single inbox and approve/deny them in one tap, and read a chronological notifications feed that deep-links into the actionable surfaces.

## Decisions locked during brainstorm

1. **Scope** — single slice covering all four mobile surfaces (QR/share on PairingScreen, bumps inbox, notifications inbox, push token registration) plus the one backend gap (`GET /me/bumps`).
2. **Bumps decision UI** — primary buttons are **Approve** (= backend `approve_once`) and **Deny**. The third backend decision, `approve_raise_limit`, is **dropped from the UI in this slice** — the backend records the `raise_limit` state but does not yet write to the sub-wallet's rules (the rule-write side isn't wired up), so exposing the option would be misleading. Reintroduce when the rule-write side lands (likely alongside the category/time-window/allowlist editors that 6b-2 already deferred). The status pill in history still renders "Approved (raised)" if such a row exists from earlier backend tests.
3. **Inbox content** — single screen with **Pending on top, decided history (last 30 days) below**. Decided rows render dimmed with a status pill (Approved · Approved (raised) · Denied · Expired).
4. **Push permission UX** — pre-prompt explainer screen, OS prompt deferred until first meaningful action. Specifically: shown the first time the principal opens the bumps inbox AND `permissionStatus === 'undetermined'`. Never auto-shown after that; settings entry-point ships in 6b-4.
5. **Notifications inbox** — pure read-feed, tap-to-source deep-links into the bumps inbox or the parent sub-wallet detail screen. Notification preferences screen punted to **Sub-plan 6b-4**.
6. **Inbox freshness** — refresh on screen-focus + pull-to-refresh + foreground push listener that opportunistically refreshes the relevant store. No background sync, no local cache.
7. **Backend route placement** — `GET /me/bumps` lives in a new `me-bumps.ts` route file mounted at `/` (mirrors the existing `notificationsListRoute` precedent: separate file, mounted at root, internal path `/me/bumps`). The original Section 1 wording said "co-mounted under the existing bumps route" — a misread; that would have produced `/bumps/me/bumps`. The corrected pattern matches the user's stated intent ("matches `/me/notifications` precedent").

## Architecture

Two layers added on top of v0.0.6b2-principal-management:

**(1) Backend** — one new HTTP route (`GET /me/bumps`) plus a small new repo helper. No DB schema changes. The existing `bump-workflow.service.ts` already covers the write side; existing notifications, devices, and notification-prefs routes are reused as-is.

**(2) Mobile** — extend `@amana/api-client` with `BumpApi`, `NotificationApi`, `DeviceApi`. Add three Zustand stores (`bumps.store`, `notifications.store`, `push.store`). Modify `PairingScreen` for QR + share. Add three new screens (`BumpsInbox`, `NotificationsInbox`, `EnableNotifications`). Wire `expo-notifications` listeners at the `App.tsx` level for foreground push and background-tap deep-linking.

Tech additions: `expo-notifications`, `expo-device`, `react-native-qrcode-svg` (depends on `react-native-svg`, already pulled by Expo SDK 51). No backend deps; `expo-push.provider.ts` already exists in the notifications module.

## Backend gap fill

### `GET /me/bumps?status=pending|history|all`

- **Mount:** new file `apps/backend/src/routes/me-bumps.ts`, exporting `meBumpsRoute` mounted at `/` in `server.ts` (sits next to the existing `notificationsListRoute`, `notificationPrefsRoute`, `meHouseholdRoute`, `meRoute` block). Internal Hono path: `.get('/me/bumps', ...)`.
- **Auth:** principal-only (return `403 only_principal_can_view` for other roles, mirroring the existing decide route).
- **Query params:** `status` ∈ `{pending, history, all}`, default `all`.
- **Response:**
  ```ts
  {
    pending: BumpRequest[],   // status === 'pending', expiresAt > now
    history: BumpRequest[],   // status in (approved_once|raise_limit|denied|expired), decidedAt or expiredAt within last 30d
  }
  ```
  When `status=pending` is requested, `history` is returned as an empty array; symmetric for `status=history`. The `all` default returns both populated.
- **Repo helper:** `bump-requests.repo.ts` adds `findForPrincipal(db, { userId, since30d })` — joins `bump_requests → sub_wallets → households → household_members` and filters where `household_members.user_id = userId AND role = 'principal'`.
- **Tests** (`apps/backend/tests/routes/bumps.test.ts` extended):
  - happy path returns both lists
  - `status=pending` returns only pending, history empty
  - `status=history` returns only history, pending empty
  - decided > 30 days ago is excluded from history
  - non-principal actor returns 403
  - principal who is not in the bump's household sees nothing

### Possible patch (verify-during-implementation)

`expo-push.provider.ts` and the notification templates may already populate `data.kind` and `data.deepLink` on the push payload — if not, the spec patches `notification.service.ts` to include them. Confirmed during Task 0 of the implementation plan; small if needed.

## Mobile additions

### Shared types (`packages/types/src`)

- `bump.ts` — `BumpRequest`, `BumpStatus` (`pending|approved_once|raise_limit|denied|expired`), `BumpDecision` (`approve_once|approve_raise_limit|deny`)
- `notification.ts` — `Notification`, `NotificationKind` (`bump_requested|bump_decided|txn_settled|txn_failed|refund_received|anomaly_alert`), `NotificationDeepLink` (discriminated union: `{ kind: 'bump'; bumpId: string } | { kind: 'transaction'; transactionId: string; subWalletId: string } | { kind: 'none' }`)
- `device.ts` — `DeviceRegistration` (`id`, `expoPushToken`, `platform`, `createdAt`)
- All re-exported from `index.ts`.

### API client (`packages/api-client/src`)

- `bump-api.ts` — `BumpApi.listForMe({ status? })`, `BumpApi.decide(id, decision)`
- `notification-api.ts` — `NotificationApi.listForMe()`, `NotificationApi.markRead(id)`
- `device-api.ts` — `DeviceApi.register({ expoPushToken, platform })`, `DeviceApi.unregister(id)`
- Tests: `tests/bump-api.test.ts`, `tests/notification-api.test.ts`, `tests/device-api.test.ts` — same MSW-style fixture pattern as 6b-2's api-client tests. ~12 new tests total.

### Zustand stores (`apps/principal/src/state`)

- `bumps.store.ts` — `pending: BumpRequest[]`, `history: BumpRequest[]`, `loading`, `refresh()`, `decide(id, decision)`. The `decide` action is optimistic: on call, remove from `pending` and prepend onto `history` with the predicted status; on error, revert.
- `notifications.store.ts` — `items: Notification[]`, `unreadCount: number`, `loading`, `refresh()`, `markRead(id)`, `markAllRead()`
- `push.store.ts` — `permissionStatus: 'undetermined' | 'granted' | 'denied'`, `expoPushToken: string | null`, `deviceId: string | null`, `checkPermission()` (reads OS state, no prompt), `requestPermissionAndRegister()` (prompts, fetches token, calls `DeviceApi.register`, persists `deviceId` to AsyncStorage), `unregister()` (called on sign-out)

### Navigation (`apps/principal/src/nav/MainStack.tsx`)

New routes: `BumpsInbox`, `NotificationsInbox`, `EnableNotifications` (modal-style presentation).

### Top-level wiring (`apps/principal/src/App.tsx`)

On mount when authenticated:
- `pushStore.checkPermission()` — read-only, no prompt
- `setupForegroundListener` — when push payload arrives in foreground: refresh `bumpsStore` if `data.kind` starts with `bump_`, else refresh `notificationsStore`
- `setupResponseListener` — when push notification is tapped (foreground or background): navigate to `data.deepLink`
- Cold-start tap (app was killed): `Notifications.getLastNotificationResponseAsync()` checked once on mount, navigated if present. Known-fragile RN behavior; may need follow-up polish.

### Helper module (`apps/principal/src/lib/push.ts`)

- `getDeviceTokenOrNull()` — wraps `getExpoPushTokenAsync`, returns `null` on simulator (`!Device.isDevice`)
- `setupForegroundListener(handler)` / `setupResponseListener(handler)` — wrap the `expo-notifications` listener APIs, return subscriptions for cleanup
- Initialization: `setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }) })`

### `app.json` changes

- Add `expo-notifications` to `plugins`
- Set `notification.icon`, `notification.color`, `notification.androidMode` (collapse notifications to one)
- iOS entitlements updated automatically by Expo prebuild

## Screens

### `PairingScreen.tsx` (modify)

- Existing pairing-code text retained at the bottom for fallback
- New: `<QRCode value={code} size={220} />` centered above the text code
- Share button → `Share.share({ message: 'Pair as my Amana agent: ${code}' })` (RN built-in, no extra dep)
- Copy button → `Clipboard.setStringAsync(code)` (`expo-clipboard` — verify it's already a transitive dep; if not, add it)

### `BumpsInboxScreen.tsx` (new)

- `FlatList` with `RefreshControl` for pull-to-refresh
- Section A "Pending" — each row: agent name, sub-wallet, vendor, amount, expires-in countdown (live-updating), and two primary buttons: **Approve** / **Deny**. No third option (see locked decision #2 — `approve_raise_limit` deferred until backend rule-write lands).
- Section B "Recent" (last 30d) — same row layout, dimmed, status pill (Approved · Approved (raised) · Denied · Expired) replaces the action buttons
- Empty state: "No requests need your decision."
- On screen-focus (`useFocusEffect`): `bumpsStore.refresh()`
- On first open AND `permissionStatus === 'undetermined'`: `navigation.navigate('EnableNotifications')` (one-shot, tracked by AsyncStorage flag `@amana/principal/enable-notifications-shown`)

### `NotificationsInboxScreen.tsx` (new)

- `FlatList` with `RefreshControl`, chronological newest-first
- Each row: kind icon, title, body, relative time, unread dot
- Tap behavior — uses the deep-link discriminator:
  - `kind: 'bump'` → navigate to `BumpsInbox` (scroll-to-specific-bump deferred to polish)
  - `kind: 'transaction'` → navigate to `SubWalletDetail` for `subWalletId` (transaction-detail screen out of scope; navigates to parent for v1)
  - `kind: 'none'` → tap just marks read
- Tap also calls `notificationsStore.markRead(id)` regardless of deep-link kind
- "Mark all as read" header button → loops `markRead` over unread items (sequential, simple)
- Empty state: "Nothing here yet."
- On screen-focus: `notificationsStore.refresh()`

### `EnableNotificationsScreen.tsx` (new)

- Modal-style single screen
- Large icon, headline "Get notified when an agent needs approval"
- Three benefit bullets: "Approve spend in one tap" / "Hear about settled transactions" / "Get anomaly alerts"
- Primary CTA "Enable notifications" → `pushStore.requestPermissionAndRegister()` → on grant or deny, `navigation.goBack()`
- Secondary CTA "Not now" → `navigation.goBack()` without prompting
- Trigger: navigated to from `BumpsInboxScreen` on first open when `permissionStatus === 'undetermined'`. Never auto-shown again. Settings entry-point ships in 6b-4.

### `HomeDashboardScreen.tsx` (modify)

- New tile: "Pending requests" → `BumpsInbox`, badge shows `bumpsStore.pending.length` if > 0
- New tile: "Notifications" → `NotificationsInbox`, badge shows `notificationsStore.unreadCount` if > 0
- On dashboard mount: refresh both stores so badges are current. No background polling.

## Token lifecycle

- **Register:** on permission grant in `EnableNotificationsScreen` flow. Persist `deviceId` to AsyncStorage under `@amana/principal/deviceId`.
- **Token refresh:** `Notifications.addPushTokenListener` — re-register with new token. Backend `POST /devices` must be upsert-by-token; verify in `devices.repo.ts`. Patch to upsert if it isn't.
- **Sign-out:** call `DeviceApi.unregister(deviceId)`, clear AsyncStorage entry. Hook into the existing `auth.store.signOut` action.
- **Simulator:** `Device.isDevice === false` → skip token fetch entirely (Expo simulators can't receive push); register/unregister become no-ops.

## Push payload contract

Expected from backend `expo-push.provider.ts`:

```ts
{
  title: string,
  body: string,
  data: {
    kind: NotificationKind,        // bump_requested | bump_decided | txn_settled | etc.
    deepLink?: NotificationDeepLink,
    notificationId: string,        // matches the row in /me/notifications
  }
}
```

If existing templates don't populate `data.kind` and `data.deepLink`, the implementation plan includes a Task to patch `notification.service.ts` and the relevant templates.

## Tests

- **Backend** — `apps/backend/tests/routes/bumps.test.ts` adds 6 cases (see backend section above)
- **api-client** — 3 new test files, ~12 cases total
- **Mobile** — typecheck-only continues per 6b-2 precedent. No RN Testing Library tests in this slice; introducing RN screen tests is its own deferred slice.

## Migration / data

No DB schema changes. `notification_devices` table already exists from Sub-plan 5.

## Out of scope for 6b-3 (deferred)

- **Notification preferences screen** → Sub-plan 6b-4 (channel toggles per template; backend prefs routes already exist and are unused)
- **Transaction detail screen** → 6b-4 or later (notifications-inbox tap on `kind: 'transaction'` navigates to parent sub-wallet for v1)
- **"Scroll to specific bump" deep-link refinement** → polish slice
- **Background-tap deep-link from killed-app cold start** → spec includes a one-shot `getLastNotificationResponseAsync` call; known-fragile RN behavior may need follow-up
- **Real Anchor virtual-account provisioning** → Sub-plan 7
- **Agent app push registration / inbox** → Sub-plan 6c
- **RN Testing Library screen tests** → its own slice
- **Snooze / mute per sub-wallet** → 6b-4 with prefs
- **`approve_raise_limit` UI** → reintroduce when the backend rule-write side lands (sub-wallet daily limit actually changes on this decision)

## Tag at completion

`v0.0.6b3-principal-inbox`

## Plan-complete criteria

When the implementation lands green:

- A principal can pair an agent by sharing a scannable QR code or via the native share sheet
- A principal sees pending bump requests in a single inbox screen and approves/denies them in one tap
- A principal sees their notification feed and can deep-link from a notification into the bumps inbox or sub-wallet detail
- A principal who has granted notification permission receives push for `bump_requested`, `bump_decided`, `txn_settled`, `txn_failed`, `refund_received`, and `anomaly_alert`, with foreground refresh and background-tap deep-linking working
- Backend exposes `GET /me/bumps` with pending+history shape, principal-scoped, 30-day history cutoff
- All existing tests still pass; ~6 new backend tests + ~12 new api-client tests added
