# Sub-plan 6b-4 — Principal Mobile App: notification preferences + post-6b-3 cleanup (design spec)

> Status: design approved, ready for implementation-plan generation. Date: 2026-05-06.

## Goal

A principal user can open Settings from the home dashboard, see and edit their notification preferences (which kinds reach them on which channels, with optional amount/score thresholds), and trust that the small leftovers from the 6b-3 final review (push listener race, optimistic-decide guard, redundant query string, deferred forward-pointer types) are tied off rather than carried forward as quiet debt.

## Decisions locked during brainstorm

1. **Scope** — single slice covering the preferences UI plus five small final-review fixes from 6b-3 (I2/I3/I4/I5/M3). Sub-wallet snooze, global quiet hours, the digest cron, and the transaction-detail screen are deferred to later slices.
2. **Layout** — per-kind detail. Top-level prefs screen lists the 6 notification kinds with a one-line digest of current effective values; tapping a kind opens a detail screen with three channel rows.
3. **Modes** — three modes for v1: `real_time`, `silent`, and (where meaningful) `threshold`. The backend `digest` enum value is hidden in the UI because no digest cron exists yet — re-introduce when that backend work lands.
4. **Threshold scope** — exposed only on `txn_settled`, `txn_failed`, and `anomaly_alert`. The other three kinds (`bump_requested`, `bump_decided`, `refund_received`) get a binary on/off switch per channel.
5. **Settings entry-point** — a new "Settings" tile on the home dashboard, next to the existing Pending/Notifications/Agents/Sub-wallets/Pairing tiles. Inside Settings v1: notification preferences, log out (moved from the dashboard), and a read-only app-version line.
6. **Save semantics** — optimistic per-cell save. Toggling a switch updates the store immediately and fires `PUT /me/notification-preferences` in the background; revert on failure. No "Save" button.
7. **Default-vs-override visualization** — channels that haven't been explicitly set show a small "Default" badge so the user knows where the row's current value came from.

## Architecture

Two layers added on top of v0.0.6b3-principal-inbox. (1) Shared types and api-client get a new `PreferenceApi` and supporting types. (2) Mobile gets a `preferences.store`, three new screens (`Settings`, `NotificationPreferences`, `NotificationKindDetail`), and route additions in `MainStack`. Plus five small targeted edits in existing files for the 6b-3 final-review fixes. **No backend changes** — `notification-prefs.ts` already exposes `GET /me/notification-preferences` and `PUT /me/notification-preferences`, both of which are sufficient for this slice.

The default-matrix duplication between server (`prefs.service.ts:DEFAULT_MATRIX`) and client (`preferences.store.ts`) is a deliberate cost of keeping the backend untouched. The alternative — a backend route returning effective values — would save ~30 lines of mobile code at the cost of an HTTP route + tests + the round-trip every time a kind-detail screen renders. Per-cell semantics make duplication cheap to keep in sync; the mobile matrix is a literal mirror of the server's.

Tech stack: React Native + Zustand + react-hook-form + zod (existing). No new top-level dependencies.

## Backend gap fill

**Nothing.** The existing route is enough. We could optionally add a bulk-PUT endpoint to batch toggle changes, but per-toggle save on a low-frequency screen is fine; YAGNI.

## Shared types changes

`packages/types/src/notification.ts` — add to the existing file (no new file needed):

- `ChannelPreference = 'real_time' | 'threshold' | 'silent'` (note: `digest` omitted; backend enum still has it but UI doesn't expose it for v1)
- `NotificationPreference` row type:
  ```ts
  { userId: string; kind: NotificationKind; channel: NotificationChannel; preference: ChannelPreference | 'digest'; thresholdKobo: string | null; updatedAt: string }
  ```
  The `'digest'` is included on the row type so reads from the backend don't error if a stored row already has that value (e.g., from a power user who set it via direct API call). The UI treats it as `silent` for display purposes.
- `MyNotificationPreferencesResponse = { preferences: NotificationPreference[] }`
- `UpsertPreferenceInput = { kind: NotificationKind; channel: NotificationChannel; preference: ChannelPreference; thresholdKobo?: string | null }` (the input type rejects `'digest'` since the UI never sends it)

**M3 fold-in (forward-pointer fix):** restore the `subWalletId: string` field on `NotificationDeepLink.transaction`:

```ts
export type NotificationDeepLink =
  | { kind: 'bump'; bumpRequestId: string }
  | { kind: 'transaction'; transactionId: string; subWalletId: string } // 6b-5: deep-link target when txn-detail screen ships
  | { kind: 'none' };
```

`deepLinkFor` in `lib/push.ts` continues to return `{ kind: 'none' }` for txn kinds in v1 — no behavior change, just type-shape preparation for the next slice.

## API client changes

**New: `packages/api-client/src/preference-api.ts`**

```ts
export class PreferenceApi {
  constructor(private readonly client: AuthedClient) {}
  listForMe(): Promise<MyNotificationPreferencesResponse>;
  upsert(input: UpsertPreferenceInput): Promise<{ preference: NotificationPreference }>;
}
```

Wired into `AmanaApiClient` as `client.preference`. Re-exported from `index.ts`.

**Tests** (`packages/api-client/tests/preference-api.test.ts`): 5 cases against `fakeClient` — listForMe path, upsert with `real_time`, upsert with `silent`, upsert with `threshold` + thresholdKobo, error path on bad payload bubbling through.

**I5 fold-in (`bump-api.ts`):** drop the redundant `?status=all` query string when the input is the default. Add one new test case to `bump-api.test.ts` asserting `'all'` does not append the query.

## Mobile state changes

**New: `apps/principal/src/state/preferences.store.ts`**

- State: `{ rows: NotificationPreference[]; status: 'idle'|'loading'|'ready'|'error'; errorCode: string | null }`
- `bootstrap()` — calls `api.preference.listForMe()`, sets `rows`, `status='ready'`. Failure → `status='error'` + `errorCode`.
- `getEffective(kind, channel) → { preference: ChannelPreference; thresholdKobo: string | null }` — reads from `rows`; falls back to a hard-coded `DEFAULT_MATRIX` mirroring `apps/backend/src/modules/notifications/prefs.service.ts`. (Comment notes the duplication and where to update both.)
- `set(kind, channel, preference, thresholdKobo?)` — optimistic: replaces or appends the matching row, fires `api.preference.upsert(...)` in the background, reverts on failure to the prior `rows` snapshot.

**I2 fold-in (`bumps.store.ts`):** add `if (get().decidingId !== null) return;` at the top of `decide()`. Concurrent decides are dropped silently — UI gates them already, this is defense-in-depth.

**I4 fold-in (`notifications.store.ts`):** add a one-line comment above the `markAllRead` for-await loop documenting why sequential is required (each iteration's `before` snapshot must reflect prior iterations' marks for revert correctness).

## Mobile lib changes

None.

## Mobile screen changes

**New: `apps/principal/src/screens/SettingsScreen.tsx`**

A simple list of three rows:
1. **Notification preferences** → `navigation.navigate('NotificationPreferences')`
2. **Log out** → calls `useAuthStore.getState().logout()` (moved from `HomeDashboardScreen`)
3. **App version** — read-only label showing `Constants.expoConfig?.version ?? '0.0.0'`

Plain styling matching the existing dashboard rows (border-bottom hairline, gap pattern).

**New: `apps/principal/src/screens/NotificationPreferencesScreen.tsx`**

- On mount: `preferencesStore.bootstrap()` (idempotent — won't re-fetch if `status === 'ready'`)
- Renders a `FlatList` of 6 rows (one per kind: `bump_requested`, `bump_decided`, `txn_settled`, `txn_failed`, `anomaly_alert`, `refund_received`).
- Each row: title (human-readable label) + a one-line digest computed from `getEffective(kind, channel)` for all three channels, e.g. "Push, in-app", "Push only", "Off", "Push (over ₦5,000)".
- Tap → `navigation.navigate('NotificationKindDetail', { kind })`.
- On error state: retry button.

**New: `apps/principal/src/screens/NotificationKindDetailScreen.tsx`**

- Route param: `{ kind: NotificationKind }`. Header title is the kind's human-readable name.
- Three rows (one per channel: Push, In-app, SMS). Each row contains:
  - **Bumps + refunds** (`bump_requested`, `bump_decided`, `refund_received`): a single switch — On = `real_time`, Off = `silent`
  - **Threshold-eligible** (`txn_settled`, `txn_failed`, `anomaly_alert`): a 3-segment control — "Real-time" (`real_time`) / "Above amount" (`threshold`) / "Off" (`silent`). When "Above amount" is selected, a numeric input appears below.
- For `txn_settled` / `txn_failed`: input is "Notify me above ₦___" (naira, converted to kobo on save).
- For `anomaly_alert`: input is "Score above ___ %" (0–100; backend stores percent×100 in `thresholdKobo`, mirroring `prefs.service.ts`'s convention).
- "Default" badge (small grey pill) next to channels with no override row.
- Each control change calls `preferencesStore.set(...)` immediately (optimistic).

**Modified: `apps/principal/src/screens/HomeDashboardScreen.tsx`**

- Add a `Settings` tile alongside the existing tiles.
- Remove the existing `<Pressable style={[styles.button, styles.danger]}>Log out</Pressable>` block. Logout now lives in Settings.
- Drop the `logout` selector from the component's hook calls (no longer used here).

**Modified: `apps/principal/src/nav/MainStack.tsx`**

Three new routes:
- `Settings: undefined`
- `NotificationPreferences: undefined`
- `NotificationKindDetail: { kind: NotificationKind }`

## Top-level wiring changes

**Modified: `apps/principal/App.tsx`** (I3 fold-in)

Add an early-bail at the top of the foreground listener and response listener callbacks:

```tsx
fgSubRef.current = setupForegroundListener((n) => {
  if (useAuthStore.getState().status !== 'logged_in') return; // I3: skip if logout in flight
  ...
});
```

Same guard on the response listener. The auth-store import `useAuthStore` already exists in App.tsx.

## Tests

- **api-client** — new `tests/preference-api.test.ts` (~5 cases) + 1 new case in `bump-api.test.ts` for the `'all'` query elision.
- **Backend** — no new tests (no backend changes).
- **Mobile** — typecheck-only per established precedent.

## Migration / data

None. The `notificationPreferences` and `deviceTokens` tables already exist from Sub-plan 5. Existing user rows (none, since 6b-3 just shipped) carry no orphan state — the prefs route returns an empty array for new principals and the store falls back to the default matrix until a user makes their first change.

## Out of scope for 6b-4 (deferred)

- **Sub-wallet snooze / mute** → Sub-plan 6b-5 (needs schema additions: `subWallets.muted` bool or `subWallets.snoozedUntil` timestamp; new filter clause in `prefs.service.shouldSend`)
- **Global quiet hours** → Sub-plan 6b-5 (same shape — needs `users.quietHoursStart/End` columns; same filter site)
- **Digest mode in the UI** → blocked on the digest cron (separate slice). Backend currently classifies digest preferences as "skip" without any deferred-send mechanism.
- **Bulk PUT** of preferences — YAGNI at this UI volume; per-toggle save is fine.
- **Transaction detail screen** → its own slice. The `NotificationDeepLink.transaction.subWalletId` field is added now as a forward-pointer; `deepLinkFor` continues to return `'none'` for txn kinds until the screen ships.
- **Bulk-edit "Quiet" preset / "Everything" preset** — punted; explicit per-cell control is enough for v1.

## Tag at completion

`v0.0.6b4-principal-prefs-and-cleanup`

## Plan-complete criteria

When the implementation lands green:

- A principal can open Settings from the home dashboard
- A principal sees a top-level list of 6 notification kinds, each with a one-line summary of current effective preferences
- A principal can tap a kind and edit per-channel preferences (Real-time / Above amount / Off, with threshold input where relevant)
- Toggling a preference takes effect immediately (optimistic) and is persisted via `PUT /me/notification-preferences`
- Logout has moved from HomeDashboard to Settings
- All five 6b-3 final-review minor fixes (I2/I3/I4/I5/M3) land in this slice
- All existing tests still pass; ~6 new api-client tests added (5 PreferenceApi + 1 bump-api `'all'` elision)
