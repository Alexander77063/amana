# Sub-plan 6b-5 — Principal Mobile App: sub-wallet snooze + global quiet hours (design spec)

> Status: design approved, ready for implementation-plan generation. Date: 2026-05-07.

## Goal

A principal user can quiet a noisy sub-wallet (e.g., "my driver is running errands all day, hush them until 6pm") and configure a daily quiet-hours window (e.g., 22:00–07:00) so non-urgent notifications stop interrupting outside their attention window — while urgent ones (anomaly alerts, bump requests) and the in-app inbox continue to work, so the system remains a reliable source-of-truth for "what happened to my household today."

## Decisions locked during brainstorm

1. **Sub-wallet snooze granularity** — coarse, one-toggle-per-sub-wallet. Snoozing affects all kinds for that sub-wallet, except the breakthrough kinds (Q1-A). Per-(sub-wallet × kind) granularity is deferred — the existing per-kind Silent toggle already covers most needs.
2. **Channels affected by snooze + quiet hours** — push and SMS are suppressed; in-app row is still written so the inbox remains a complete catch-up surface (Q2-A). Mirrors iOS/Slack DND semantics.
3. **Breakthrough kinds** — `anomaly_alert` and `bump_requested` always reach the user, regardless of snooze or quiet hours (Q3-B). Hardcoded in code, not configurable in v1. Both kinds are operationally urgent: anomaly is fraud signal; bump is a real-time decision a dependent is waiting on.
4. **Snooze duration menu** — four presets: 1 hour / 4 hours / Until tomorrow morning (next 08:00 Africa/Lagos) / Until I unmute (Q4-A). No 30min, no 8h, no custom picker.
5. **Quiet hours shape** — single window per user, hardcoded `Africa/Lagos` timezone (Q5-A). Mirrors the "currency NGN only at MVP" lock from §2 of the master design. Per-user TZ and multiple windows are deferred until international expansion or observed need.
6. **Save semantics** — sub-wallet snooze is optimistic per-tap (mirrors 6b-4's per-cell prefs save). Quiet hours is form-style with a single "Save" tap (avoids ping-ponging while the user adjusts time pickers).
7. **Replay missed pushes when snooze ends** — explicitly **not** done. The in-app inbox is the catch-up surface; replaying a 3h-old "Bump request" push would be confusing.

## Architecture

Three layers added on top of v0.0.6b4-principal-prefs-and-cleanup. (1) Backend gets two new tables, two new repos, one new service (`quietService`), and one extension to `prefsService.shouldSend`. (2) Shared types and api-client get extensions to `SubWalletApi` and `PreferenceApi`. (3) Mobile gets one new screen (`QuietHoursScreen`), modifications to three existing screens (`SubWalletDetailScreen`, `SubWalletsListScreen`, `NotificationPreferencesScreen`), extensions to two existing stores, and two new pure-logic libs with vitest cases.

The check for "should this notification be quiet right now?" lives entirely on the backend in `quietService.reasonQuiet`, called from `prefsService.shouldSend` before the existing per-(kind, channel) matrix lookup. The dispatch loop in `notification.service.ts` already handles "any decision other than 'send' → write a `notifications` row with status='skipped' and `_decision` for audit"; zero changes needed there. New decision values: `'skip_snoozed'` and `'skip_quiet_hours'`.

Tech stack: existing only — React Native + Zustand + react-hook-form + zod on mobile; Drizzle + postgres-js + Hono on backend. No new dependencies.

## Backend changes

### Schema (one new migration, additive only)

```sql
-- Per (user, sub-wallet) snooze. Row exists iff snoozed; absence = active.
CREATE TABLE subwallet_snooze (
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_wallet_id  uuid        NOT NULL REFERENCES sub_wallets(id) ON DELETE CASCADE,
  expires_at     timestamptz,                      -- NULL = until-I-unmute
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sub_wallet_id)
);

-- One quiet-hours window per user. Lazy-created on first PUT.
CREATE TABLE user_quiet_hours (
  user_id       uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled       boolean     NOT NULL DEFAULT false,
  start_minute  smallint    NOT NULL,              -- 0..1439
  end_minute    smallint    NOT NULL,              -- 0..1439; if end < start, window crosses midnight
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

`subwallet_snooze` row presence is the truth — read filters with `WHERE expires_at IS NULL OR expires_at > now()`. Expired rows are dead state; lazy GC on read for v1, with a daily prune job deferred to v1.1 if row volume warrants it.

`user_quiet_hours.start_minute > end_minute` encodes the cross-midnight case (22:00 → 07:00) without two columns or a `crosses_midnight` flag — the predicate `(start ≤ end) ? (m ≥ start ∧ m < end) : (m ≥ start ∨ m < end)` handles both shapes.

Hardcoded `Africa/Lagos` lives as a constant in `quietService`, not the schema. Adding per-row TZ later is a one-column migration with `DEFAULT 'Africa/Lagos'` — no shape rework.

### Repos

`apps/backend/src/modules/notifications/subwallet-snooze.repo.ts`:
```ts
isActive(db, userId, subWalletId): Promise<boolean>
upsert(db, userId, subWalletId, expiresAt: Date | null): Promise<void>
delete(db, userId, subWalletId): Promise<void>
listForUser(db, userId): Promise<{ subWalletId, expiresAt }[]>
```

`apps/backend/src/modules/notifications/quiet-hours.repo.ts`:
```ts
get(db, userId): Promise<{ enabled, startMinute, endMinute } | null>
upsert(db, userId, input): Promise<void>
```

### `quietService` (new)

`apps/backend/src/modules/notifications/quiet.service.ts`:
```ts
const QUIET_TZ = 'Africa/Lagos';                  // FORWARD: per-user TZ in user_quiet_hours.timezone
const BREAKTHROUGH_KINDS: NotificationKind[] = [  // FORWARD: user-configurable list
  'anomaly_alert',
  'bump_requested',
];

export const quietService = {
  /** null = not quiet. Reason ∈ { 'snooze' | 'quiet_hours' } when quiet. */
  async reasonQuiet(db, intent, channel): Promise<'snooze' | 'quiet_hours' | null> {
    if (channel === 'in_app') return null;
    if (BREAKTHROUGH_KINDS.includes(intent.kind)) return null;
    if (intent.subWalletId &&
        await subwalletSnoozeRepo.isActive(db, intent.recipientUserId, intent.subWalletId)) {
      return 'snooze';
    }
    const qh = await quietHoursRepo.get(db, intent.recipientUserId);
    if (qh?.enabled && nowMinuteInWindow(QUIET_TZ, qh.startMinute, qh.endMinute)) {
      return 'quiet_hours';
    }
    return null;
  },
};
```

`nowMinuteInWindow` is a small pure helper using `Intl.DateTimeFormat` with `timeZone: 'Africa/Lagos'`. No Luxon / date-fns-tz dependency.

### Order of checks in `prefsService.shouldSend`

The user's explicit per-kind preference is the most specific signal, so it runs first. Quiet (snooze + quiet hours) is a layer that only kicks in when the matrix said `'send'`.

1. Resolve the existing per-(kind, channel) matrix → `matrixDecision ∈ { 'send', 'skip_silent', 'skip_threshold', 'defer_digest' }`.
2. If `matrixDecision !== 'send'`, return `matrixDecision` immediately. The user's explicit `silent` / `threshold` / `digest` choice already filtered this out and is the more accurate `_decision` to log.
3. Otherwise — matrix said `'send'`, so we ask `quietService.reasonQuiet(intent, channel)`:
   - `channel === 'in_app'` → never quieted; return `'send'`.
   - `kind ∈ BREAKTHROUGH_KINDS` → never quieted; return `'send'`.
   - sub-wallet snooze active → return `'skip_snoozed'`.
   - quiet-hours window active → return `'skip_quiet_hours'`.
   - else → return `'send'`.

Snooze beats quiet hours within step 3 so the inbox `_decision` field accurately attributes the skip when both are active.

### `NotificationIntent` extension

Add one optional field to `apps/backend/src/modules/notifications/types.ts`:
```ts
// FORWARD: per-kind sub-wallet snooze (subwallet_snooze_kind table) — see 6b-5 spec §6a
export type NotificationIntent = {
  // ... existing fields ...
  subWalletId?: string;
};
```

All six existing dispatchers (`bumpRequested`, `bumpDecided`, `txnSettled`, `txnFailed`, `anomalyAlert`, `refundReceived`) get a one-line update to populate `subWalletId` from the originating txn or bump (both already carry it). Principal direct-spend (decision #17) leaves it undefined → snooze never applies (correct).

### New return values from `shouldSend`

`'send' | 'skip_silent' | 'skip_threshold' | 'defer_digest' | 'skip_snoozed' | 'skip_quiet_hours'`. Dispatch loop is unchanged: `decision !== 'send'` already writes a `notifications` row with status `'skipped'` and `_decision: <value>` in payload.

## API contract

Two route files extended; no new files.

### `apps/backend/src/routes/sub-wallets.ts` — sub-wallet snooze

```
PUT    /me/sub-wallets/:subWalletId/snooze
       Body:    { until: string | null }       // ISO8601 (one of 4 presets); null = indefinite
       200:     { snoozedUntil: string | null }
       400:     ERR_INVALID_INPUT               // bad ISO, past timestamp
       403:     ERR_NOT_HOUSEHOLD_PRINCIPAL     // sub-wallet not in caller's household
       404:     ERR_SUB_WALLET_NOT_FOUND

DELETE /me/sub-wallets/:subWalletId/snooze
       200:     { snoozedUntil: null }          // idempotent — succeeds even if no row exists
```

Auth: existing `requirePrincipal` middleware (only the principal of a sub-wallet's household can snooze it). Reuses the same checks already in `sub-wallets.ts` for rule edits.

### `apps/backend/src/routes/notification-prefs.ts` — quiet hours

```
GET  /me/quiet-hours
     200:  { enabled, startMinute, endMinute }
            // when no row exists, returns the placeholder defaults
            // { enabled: false, startMinute: 1320, endMinute: 420 } (22:00 → 07:00, disabled)

PUT  /me/quiet-hours
     Body: { enabled: boolean, startMinute: number, endMinute: number }
     200:  { enabled, startMinute, endMinute }
     400:  ERR_INVALID_INPUT  // start/end out of [0, 1439]; start === end
```

Returning sensible defaults from `GET` when no row exists (rather than 404 / null) means the mobile screen has nothing to special-case — it always renders a populated form. When a row does exist, its actual values are returned even if `enabled === false` (so a user who disabled their window doesn't lose their previous start/end choice).

### Snooze surfacing on existing sub-wallet list

`GET /me/sub-wallets` (existing) gets one new field on each row's response shape:
```ts
type SubWalletSummary = {
  // ... existing fields ...
  snoozedUntil: string | null;  // ISO8601 if currently snoozed (active), null otherwise
};
```
Backend joins `subwallet_snooze` with `expires_at IS NULL OR expires_at > now()`.

## Shared types changes

`packages/types/src/notification.ts` — add:
```ts
export type QuietHours = {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
};
```

`packages/types/src/sub-wallet.ts` — add:
```ts
export type SubWalletSnoozeInput = {
  until: string | null;  // ISO8601 or null (indefinite)
};
```
And the optional `snoozedUntil: string | null` field on `SubWalletSummary`.

## API client changes

`packages/api-client/src/sub-wallet-api.ts` — add two methods:
```ts
snooze(subWalletId: string, until: string | null): Promise<{ snoozedUntil: string | null }>;
unsnooze(subWalletId: string): Promise<{ snoozedUntil: null }>;
```

`packages/api-client/src/preference-api.ts` — add two methods:
```ts
getQuietHours(): Promise<QuietHours>;
upsertQuietHours(input: QuietHours): Promise<QuietHours>;
```

## Validation changes

`packages/validation/src/` — add:
```ts
SubWalletSnoozeInputSchema = z.object({
  until: z.string().datetime().nullable(),
}).refine((v) => v.until === null || new Date(v.until) > new Date(),
          { message: 'until must be in the future' });

QuietHoursSchema = z.object({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
}).refine((v) => v.startMinute !== v.endMinute,
          { message: 'startMinute and endMinute must differ' });
```

## Mobile state changes

`apps/principal/src/state/subwallets.store.ts` — extend existing store:
```ts
type SubWallet = {
  // ... existing ...
  snoozedUntil: string | null;
};
type SubWalletsState = {
  // ... existing ...
  snooze(subWalletId: string, until: string | null): Promise<void>;  // optimistic
  unsnooze(subWalletId: string): Promise<void>;
};
```
Optimistic update mirrors `preferences.store.set` from 6b-4: write the new `snoozedUntil` into `byId[id]` immediately, fire the API call, reconcile on response, revert on error. Concurrent-edit handling (preventing a stale snooze response from clobbering a subsequent unmute, etc.) is implementation-level and resolved in the plan — unlike 6b-4's prefs row, `subwallet_snooze` has no monotonic `updatedAt` field, so the guard can't be a direct timestamp comparison; a request-sequence counter or action-token is the likely shape.

`apps/principal/src/state/preferences.store.ts` — extend with quiet-hours slice:
```ts
type PreferencesState = {
  // ... existing ...
  quietHours: QuietHours | null;       // null = not loaded yet
  loadQuietHours(): Promise<void>;     // GET /me/quiet-hours
  saveQuietHours(input: QuietHours): Promise<void>;  // PUT, optimistic
};
```
`bootstrap` is extended to fan out to `loadQuietHours` in parallel with the existing `listForMe` call (independent endpoints, two concurrent requests is the same wall-time as one).

## Mobile lib changes

Two new pure-logic files under `apps/principal/src/lib/`, vitest-tested (extends the pattern from 6b-4's `threshold-conversion.ts`):

### `snooze-presets.ts`

```ts
// FORWARD: 'custom' preset opens a date/time picker — see 6b-5 spec §6a
export type SnoozePreset = 'one_hour' | 'four_hours' | 'tomorrow_morning' | 'indefinite';

/** Returns ISO8601 string, or null for indefinite. `now` is parameterized for testability. */
export function presetToExpiresAt(preset: SnoozePreset, now: Date): string | null;
```

### `quiet-window.ts`

```ts
/** Mirrors backend `nowMinuteInWindow`. Used for client-side "active now" preview. */
export function nowMinuteInWindow(now: Date, startMinute: number, endMinute: number, tz: string): boolean;
```

## Mobile screen changes

### `QuietHoursScreen.tsx` (new)

Accessed from `NotificationPreferencesScreen`. Layout:
```
[ Toggle: Quiet hours ] On ●
─────────────────────
Start    [ 22 : 00 ]   ← two HH and MM TextInputs, numeric keyboard
End      [ 07 : 00 ]
─────────────────────
Notifications about anomaly alerts and bump requests will still come through.

                                       [ Save ]
```

- Time picker: two `TextInput`s with `keyboardType="number-pad"` and `maxLength={2}`. iOS/Android `@react-native-community/datetimepicker` deferred — the existing app is dep-light and this is a once-and-forget setting.
- Save behavior: form-style — the toggle and both times commit together on a single Save tap. Avoids ping-ponging while the user is editing. Disabled until both inputs are valid (00–23 hour, 00–59 minute, start ≠ end).

### `SubWalletDetailScreen.tsx` (modified)

Add a "Notifications" section above the existing rules section:
```
[Notifications]
  Snooze: Active until 6:00 PM today      [Unmute]
  ─── or ───
  Snooze: Off                              [Snooze ▾]
```

Tapping Snooze opens a custom 5-option modal (1 hour / 4 hours / Until tomorrow morning / Until I unmute / Cancel) — `ActionSheetIOS` is iOS-only, custom modal works on both platforms with ~30 lines.

`presetToExpiresAt` (from the new lib file) computes the `until` ISO timestamp client-side; passed to `subwallets.store.snooze`. While snoozed, the row shows a relative countdown ("ends in 3h 47m") and an Unmute button.

### `SubWalletsListScreen.tsx` (modified)

One new icon (🌙) on each card row when `snoozedUntil` is set and active:
```
[Avatar]  Tunde's allowance         ₦12,300       🌙
          12,000 daily limit
```

Filtering: dimmed icon if the snooze has expired client-side (server is the source of truth, but this reduces visual noise during the brief window before the next refresh).

### `NotificationPreferencesScreen.tsx` (modified)

One new row at the top, above the existing kind list:
```
[Quiet hours]
  On · 10:00 PM – 7:00 AM         ›        ← navigates to QuietHoursScreen
  ─ or ─
  Off                              ›
```

## Top-level wiring changes

`apps/principal/src/nav/MainStack.tsx` — add one route:
```ts
QuietHours: undefined;
```
And the corresponding `<Stack.Screen name="QuietHours" component={QuietHoursScreen} />` registration. No other route changes.

## Tests

| Layer | New files | Cases (approx.) | Style |
|---|---|---|---|
| Backend repos | `subwallet-snooze.repo.test.ts`, `quiet-hours.repo.test.ts` | ~10 | Real Postgres |
| Backend service | `quiet.service.test.ts` | ~12 | `vi.setSystemTime` table-driven |
| Backend routes | extend `sub-wallets.test.ts` + `notification-prefs.test.ts` | ~10 | Supertest + Postgres |
| Backend dispatch | extend `notification.service.test.ts` | ~1 | Integration |
| API client | extend `sub-wallet-api.test.ts` + `preference-api.test.ts` | ~7 | Fake-client unit |
| Validation | extend existing schemas tests | ~8 | Schema unit |
| Mobile lib | `snooze-presets.test.ts` + `quiet-window.test.ts` | ~14 | Pure-logic vitest |
| **Total** | **~6 new + ~3 extended files** | **~62 new cases** | |

Mobile screens stay typecheck-only (no RN testing-library), consistent with 6b-4.

`quiet.service.test.ts` covers explicitly:
- `channel === 'in_app'` → null across all 6 kinds, snoozed or not
- breakthrough kinds → null on push and sms regardless of snooze / window
- intent without `subWalletId` (principal direct spend) — snooze never applies; quiet hours still does
- snooze takes precedence over quiet hours when both active
- cross-midnight window (22:00 → 07:00) — 21:59 (out), 22:00 (in), 03:00 (in), 06:59 (in), 07:00 (out)
- non-cross-midnight window (13:00 → 14:00) — boundary checks
- `enabled: false` → never quiet

Tests use `vi.setSystemTime` with explicit Africa/Lagos local times so they're timezone-deterministic.

## Migration / data

One new Drizzle migration: `XXXX_subwallet_snooze_and_quiet_hours.sql`. Additive only — two new tables, no changes to existing tables. Safe to run on a populated database; no backfill required.

## Out of scope for 6b-5 (deferred)

- Per-(sub-wallet × kind) snooze granularity — covered by existing per-kind Silent toggle in 6b-4.
- 30min / 8h / custom snooze duration presets — extend `snooze-presets.ts` later if usage data warrants.
- Multiple quiet-hours windows / per-day schedule — would migrate `user_quiet_hours` to a list table.
- Per-row timezone for quiet hours — Nigeria-only at MVP, mirrors `currency = NGN` lock.
- User-configurable breakthrough kinds — adds a join table; current hardcoding matches operational urgency.
- Native `@react-native-community/datetimepicker` — drop-in replacement for the two TextInputs.
- Replay missed pushes when snooze ends — explicitly not done; in-app inbox is the catch-up surface.
- Server-side cron to GC expired `subwallet_snooze` rows — read predicate filters them; revisit at scale.
- Quiet hours / snooze on the agent app — agents don't receive the suppressed notifications (principal does).

### Adjacent slices

- **Transaction detail screen** (deferred from 6b-4 via `subWalletId` forward-pointer) — independent of 6b-5; can ship in parallel or after.
- **Digest cron slice** — independent of 6b-5; `'defer_digest'` already exists in `shouldSend`. New `'skip_*'` decisions layer cleanly with digest.
- **6c (vendor capture / principal direct-spend)** — independent. Direct-spend intents have `subWalletId === undefined`, which is already the path where snooze never applies — no special-casing.

## Tag at completion

`v0.0.6b5-snooze-and-quiet-hours` after CI green on the final commit.

## Plan-complete criteria

- A principal can open a sub-wallet's detail screen and snooze it for 1h / 4h / Until tomorrow morning / indefinitely; while snoozed, push and SMS for that sub-wallet's non-urgent kinds are skipped, and the in-app inbox still records every event.
- A principal can configure a single daily quiet-hours window in `Africa/Lagos`; while the window is active, push and SMS for non-urgent kinds are skipped across all sub-wallets, and the in-app inbox still records every event.
- `anomaly_alert` and `bump_requested` always reach the user on push and SMS, regardless of snooze or quiet hours.
- The sub-wallet list shows a 🌙 indicator on snoozed rows.
- Snooze and quiet-hours decisions are visible in the `notifications` audit table via `_decision: 'skip_snoozed'` / `'skip_quiet_hours'`.
- All existing 6b-4 tests still pass; ~62 new test cases added across the layer cake.
