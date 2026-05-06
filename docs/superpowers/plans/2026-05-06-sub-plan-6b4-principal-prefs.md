# Sub-plan 6b-4 — Principal Mobile App: notification preferences + post-6b-3 cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A principal user can open Settings from the home dashboard, edit notification preferences (which kinds/channels reach them, with optional thresholds), and the five small final-review leftovers from 6b-3 (I2/I3/I4/I5/M3) are tied off.

**Architecture:** No backend changes — `notification-prefs.ts` already exposes the routes. Shared types get a `ChannelPreference`/`NotificationPreference` set; api-client gets `PreferenceApi` and a small fix to `BumpApi`. Mobile gets a Zustand `preferences.store` (with a hardcoded `DEFAULT_MATRIX` mirroring the server), three new screens (Settings, NotificationPreferences, NotificationKindDetail), and HomeDashboard/MainStack/App.tsx edits including the I3 listener race fix.

**Tech Stack:** Backend untouched. Mobile — Expo SDK 51 + React Navigation v7 + Zustand 5 (existing). No new deps.

---

## Pre-flight: dist build (do once at the start)

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
```

Repeat after each phase that touches the workspace packages, before mobile typecheck.

---

## File structure produced by this plan

**Shared types (modified in `packages/types/src`):**
- `notification.ts` — add `ChannelPreference`, `NotificationPreference`, `MyNotificationPreferencesResponse`, `UpsertPreferenceInput`. Restore `subWalletId` on `NotificationDeepLink.transaction`.

**API client (new in `packages/api-client/src`):**
- `preference-api.ts` — `PreferenceApi.listForMe`, `PreferenceApi.upsert`
- `tests/preference-api.test.ts`

**API client (modified):**
- `client.ts` — add `preference: PreferenceApi` field
- `index.ts` — re-export `PreferenceApi`
- `bump-api.ts` — drop redundant `?status=all` query string (I5)
- `tests/bump-api.test.ts` — add one test asserting `'all'` doesn't append the query

**Mobile state (modified/new in `apps/principal/src/state`):**
- `preferences.store.ts` — new
- `bumps.store.ts` — add concurrent-decide guard (I2)
- `notifications.store.ts` — add clarifying comment over `markAllRead` for-await (I4)

**Mobile screens (new in `apps/principal/src/screens`):**
- `SettingsScreen.tsx`
- `NotificationPreferencesScreen.tsx`
- `NotificationKindDetailScreen.tsx`

**Mobile screens (modified):**
- `HomeDashboardScreen.tsx` — add Settings tile, remove Log out button

**Mobile wiring (modified):**
- `nav/MainStack.tsx` — add 3 new routes
- `App.tsx` — add I3 listener authStatus guard

---

## Phase A — Shared types (Task 1)

### Task 1 — Add preference types + restore `subWalletId`

**Files:**
- Modify: `packages/types/src/notification.ts`

- [ ] **Step 1: Read the existing file**

```bash
cat packages/types/src/notification.ts
```

Note the existing exports — you'll preserve all of them.

- [ ] **Step 2: Replace the file with the updated content**

```ts
// packages/types/src/notification.ts
export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received';

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';

/**
 * UI-side preference enum. The backend enum also includes 'digest' but the
 * digest cron is not yet implemented, so the UI only reads/writes these three
 * for v1. When `digest` is reintroduced, add it here and to the upsert input.
 */
export type ChannelPreference = 'real_time' | 'threshold' | 'silent';

export type Notification = {
  id: string;
  recipientUserId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  dedupeKey: string;
  payloadJson: unknown;
  createdAt: string;
  updatedAt: string;
};

/**
 * The row shape the backend returns for `GET /me/notification-preferences`.
 * `preference` allows `'digest'` on the read side because a power user might
 * have set it via direct API; the UI displays such rows as if they were 'silent'.
 * `thresholdKobo` is BigInt-safe — string over the wire.
 */
export type NotificationPreference = {
  userId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  preference: ChannelPreference | 'digest';
  thresholdKobo: string | null;
  updatedAt: string;
};

export type MyNotificationPreferencesResponse = {
  preferences: NotificationPreference[];
};

/**
 * Write side. The UI never sends 'digest' for v1, so the input type is the
 * narrower ChannelPreference.
 */
export type UpsertPreferenceInput = {
  kind: NotificationKind;
  channel: NotificationChannel;
  preference: ChannelPreference;
  thresholdKobo?: string | null;
};

/**
 * Resolved client-side from `notification.payloadJson` + `notification.kind`.
 * `kind: 'none'` means the inbox tap should mark-read only — no navigation.
 */
export type NotificationDeepLink =
  | { kind: 'bump'; bumpRequestId: string }
  | { kind: 'transaction'; transactionId: string; subWalletId: string } // 6b-5: deep-link target when txn-detail screen ships
  | { kind: 'none' };

export type MyNotificationsResponse = {
  notifications: Notification[];
};
```

- [ ] **Step 3: Build the types package**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/types build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/types/src/notification.ts
git -C "C:/Users/alex_/amana" commit -m "feat(types): add NotificationPreference + restore NotificationDeepLink.transaction.subWalletId"
```

---

## Phase B — API client (Tasks 2-3)

### Task 2 — `PreferenceApi`

**Files:**
- Create: `packages/api-client/src/preference-api.ts`
- Create: `packages/api-client/tests/preference-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api-client/tests/preference-api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { PreferenceApi } from '../src/preference-api';

function fakeClient(impl: (path: string, init?: unknown) => Promise<unknown>) {
  return { request: vi.fn(impl) };
}

describe('PreferenceApi.listForMe', () => {
  it('GETs /me/notification-preferences', async () => {
    const client = fakeClient(async () => ({ preferences: [] }));
    const api = new PreferenceApi(client);
    await api.listForMe();
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences');
  });

  it('returns the parsed list', async () => {
    const client = fakeClient(async () => ({
      preferences: [
        {
          userId: 'u1',
          kind: 'bump_requested',
          channel: 'push',
          preference: 'real_time',
          thresholdKobo: null,
          updatedAt: '2026-05-06T00:00:00Z',
        },
      ],
    }));
    const api = new PreferenceApi(client);
    const r = await api.listForMe();
    expect(r.preferences).toHaveLength(1);
    expect(r.preferences[0]?.preference).toBe('real_time');
  });
});

describe('PreferenceApi.upsert', () => {
  it('PUTs /me/notification-preferences with real_time body', async () => {
    const client = fakeClient(async () => ({
      preference: {
        userId: 'u1',
        kind: 'bump_requested',
        channel: 'push',
        preference: 'real_time',
        thresholdKobo: null,
        updatedAt: '2026-05-06T00:00:00Z',
      },
    }));
    const api = new PreferenceApi(client);
    const r = await api.upsert({
      kind: 'bump_requested',
      channel: 'push',
      preference: 'real_time',
    });
    expect(r.preference.preference).toBe('real_time');
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: { kind: 'bump_requested', channel: 'push', preference: 'real_time' },
    });
  });

  it('PUTs threshold preference with thresholdKobo', async () => {
    const client = fakeClient(async () => ({
      preference: {
        userId: 'u1',
        kind: 'txn_settled',
        channel: 'push',
        preference: 'threshold',
        thresholdKobo: '500000',
        updatedAt: '2026-05-06T00:00:00Z',
      },
    }));
    const api = new PreferenceApi(client);
    await api.upsert({
      kind: 'txn_settled',
      channel: 'push',
      preference: 'threshold',
      thresholdKobo: '500000',
    });
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: {
        kind: 'txn_settled',
        channel: 'push',
        preference: 'threshold',
        thresholdKobo: '500000',
      },
    });
  });

  it('PUTs silent preference and clears thresholdKobo by passing null', async () => {
    const client = fakeClient(async () => ({
      preference: {
        userId: 'u1',
        kind: 'txn_settled',
        channel: 'sms',
        preference: 'silent',
        thresholdKobo: null,
        updatedAt: '2026-05-06T00:00:00Z',
      },
    }));
    const api = new PreferenceApi(client);
    await api.upsert({
      kind: 'txn_settled',
      channel: 'sms',
      preference: 'silent',
      thresholdKobo: null,
    });
    expect(client.request).toHaveBeenCalledWith('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: {
        kind: 'txn_settled',
        channel: 'sms',
        preference: 'silent',
        thresholdKobo: null,
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client test preference-api
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `preference-api.ts`**

```ts
// packages/api-client/src/preference-api.ts
import type {
  MyNotificationPreferencesResponse,
  NotificationPreference,
  UpsertPreferenceInput,
} from '@amana/types';
import type { AuthedClient } from './household-api';

export type UpsertPreferenceResult = { preference: NotificationPreference };

export class PreferenceApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(): Promise<MyNotificationPreferencesResponse> {
    return this.client.request<MyNotificationPreferencesResponse>(
      '/me/notification-preferences',
    );
  }

  upsert(input: UpsertPreferenceInput): Promise<UpsertPreferenceResult> {
    return this.client.request<UpsertPreferenceResult>('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: input,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @amana/api-client test preference-api
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/preference-api.ts packages/api-client/tests/preference-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): PreferenceApi — listForMe + upsert"
```

---

### Task 3 — Wire `PreferenceApi` into client + I5 fix on `BumpApi`

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/src/bump-api.ts`
- Modify: `packages/api-client/tests/bump-api.test.ts`

- [ ] **Step 1: Update `client.ts`**

Read the file first to find insertion points. Then:

a. Add the new import alphabetically (between `NotificationApi` and `PairingApi`):

```ts
import { PreferenceApi } from './preference-api';
```

b. Add a `public readonly preference: PreferenceApi` field next to existing `notification`/`subWallet`/`pairing` fields:

```ts
  public readonly preference: PreferenceApi;
```

c. In the constructor, after `this.device = new DeviceApi(this);`, add:

```ts
    this.preference = new PreferenceApi(this);
```

- [ ] **Step 2: Update `index.ts`**

Append after the existing exports:

```ts
export { PreferenceApi } from './preference-api';
export type { UpsertPreferenceResult } from './preference-api';
```

- [ ] **Step 3: I5 fix in `bump-api.ts`**

Read the file. Replace the `listForMe` method body. Find:

```ts
  listForMe(input?: ListForMeInput): Promise<MyBumpsResponse> {
    const path = input?.status ? `/me/bumps?status=${input.status}` : '/me/bumps';
    return this.client.request<MyBumpsResponse>(path);
  }
```

Replace with:

```ts
  listForMe(input?: ListForMeInput): Promise<MyBumpsResponse> {
    // status === 'all' is the server default; only send the query string for non-default values.
    const path =
      input?.status && input.status !== 'all'
        ? `/me/bumps?status=${input.status}`
        : '/me/bumps';
    return this.client.request<MyBumpsResponse>(path);
  }
```

- [ ] **Step 4: Add the I5 regression test**

Read `packages/api-client/tests/bump-api.test.ts`. APPEND a new `it` case INSIDE the existing `describe('BumpApi.listForMe', ...)` block (do not modify the existing 3 cases):

```ts
  it("does not append ?status=all (server default) when status === 'all'", async () => {
    const client = fakeClient(async () => ({ pending: [], history: [] }));
    const api = new BumpApi(client);
    await api.listForMe({ status: 'all' });
    expect(client.request).toHaveBeenCalledWith('/me/bumps');
  });
```

- [ ] **Step 5: Build the api-client package**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/api-client build
```

Expected: build succeeds.

- [ ] **Step 6: Run the full api-client test suite**

```bash
pnpm --filter @amana/api-client test
```

Expected: ≥47 tests pass (41 from 6b-3 + 5 PreferenceApi + 1 BumpApi `'all'` case).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/alex_/amana" add packages/api-client/src/client.ts packages/api-client/src/index.ts packages/api-client/src/bump-api.ts packages/api-client/tests/bump-api.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(api-client): wire PreferenceApi into AmanaApiClient + drop redundant ?status=all"
```

---

## Phase C — Final-review fold-ins (Tasks 4-5)

### Task 4 — I2 (bumps store concurrent-decide guard) + I4 (notifications store comment)

**Files:**
- Modify: `apps/principal/src/state/bumps.store.ts`
- Modify: `apps/principal/src/state/notifications.store.ts`

- [ ] **Step 1: Edit `bumps.store.ts` for I2**

Read the file. In the `decide` action, find the existing first line:

```ts
  async decide(bumpId, decision) {
    const before = get();
```

Insert a guard immediately after `async decide(bumpId, decision) {` and before `const before = get();`:

```ts
  async decide(bumpId, decision) {
    if (get().decidingId !== null) return; // I2: ignore if a decide is already inflight
    const before = get();
```

- [ ] **Step 2: Edit `notifications.store.ts` for I4**

Read the file. Find the existing `markAllRead` action:

```ts
  async markAllRead() {
    const unread = get().items.filter((n) => n.status !== 'read' && n.status !== 'skipped');
    for (const n of unread) {
      await get().markRead(n.id);
    }
  },
```

Replace with the same code but with a clarifying comment on the loop:

```ts
  async markAllRead() {
    const unread = get().items.filter((n) => n.status !== 'read' && n.status !== 'skipped');
    // Sequential by design — each markRead's `before` snapshot must include prior iterations'
    // marks so a mid-loop failure reverts only the failing call, not previously-succeeded ones.
    for (const n of unread) {
      await get().markRead(n.id);
    }
  },
```

- [ ] **Step 3: Typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/bumps.store.ts apps/principal/src/state/notifications.store.ts
git -C "C:/Users/alex_/amana" commit -m "fix(principal): guard concurrent decide (I2) + clarify markAllRead loop semantics (I4)"
```

---

### Task 5 — I3 (App.tsx listener auth-status guard)

**Files:**
- Modify: `apps/principal/App.tsx`

- [ ] **Step 1: Edit `App.tsx`**

Read the file. Find the foreground listener registration block:

```tsx
    // Foreground push: refresh the relevant store.
    fgSubRef.current = setupForegroundListener((n) => {
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });
```

Replace with:

```tsx
    // Foreground push: refresh the relevant store.
    fgSubRef.current = setupForegroundListener((n) => {
      // I3: skip refreshes that arrive after logout has cleared tokens — would 401.
      if (useAuthStore.getState().status !== 'logged_in') return;
      const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind;
      if (isBumpKind(kind)) void refreshBumps();
      else void refreshNotifications();
    });
```

Then find the response listener registration:

```tsx
    // Background tap: navigate to deep-link target.
    responseSubRef.current = setupResponseListener(navigateForResponse);
```

Replace with:

```tsx
    // Background tap: navigate to deep-link target.
    responseSubRef.current = setupResponseListener((response) => {
      // I3: skip if logout is in flight — nav target would be the auth stack.
      if (useAuthStore.getState().status !== 'logged_in') return;
      navigateForResponse(response);
    });
```

`useAuthStore` is already imported at the top of the file. No new imports needed.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/App.tsx
git -C "C:/Users/alex_/amana" commit -m "fix(principal): skip push listener side-effects when not logged in (I3)"
```

---

## Phase D — Mobile state (Task 6)

### Task 6 — `preferences.store.ts`

**Files:**
- Create: `apps/principal/src/state/preferences.store.ts`

The store mirrors the server's `DEFAULT_MATRIX` so the UI can render correct defaults before the user has overridden anything. The duplication is intentional — see spec rationale.

- [ ] **Step 1: Implement**

```ts
// apps/principal/src/state/preferences.store.ts
import { ApiError } from '@amana/api-client';
import type {
  ChannelPreference,
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  UpsertPreferenceInput,
} from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';

/**
 * Mirrors the server's DEFAULT_MATRIX in
 * `apps/backend/src/modules/notifications/prefs.service.ts`.
 * If the server matrix changes, update this in lockstep.
 *
 * The server enum includes 'digest' but no kind/channel uses it as a default,
 * so we restrict the type here to ChannelPreference.
 */
const DEFAULT_MATRIX: Record<NotificationKind, Record<NotificationChannel, ChannelPreference>> = {
  bump_requested: { push: 'real_time', sms: 'real_time', in_app: 'real_time' },
  bump_decided: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_settled: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_failed: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  anomaly_alert: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  refund_received: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
};

export type PreferencesStatus = 'idle' | 'loading' | 'ready' | 'error';

export type EffectivePreference = {
  preference: ChannelPreference;
  thresholdKobo: string | null;
  /** True if no override row exists — falling back to DEFAULT_MATRIX. */
  isDefault: boolean;
};

export type PreferencesState = {
  status: PreferencesStatus;
  rows: NotificationPreference[];
  errorCode: string | null;

  bootstrap(): Promise<void>;
  getEffective(kind: NotificationKind, channel: NotificationChannel): EffectivePreference;
  set(input: UpsertPreferenceInput): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

/**
 * Replace or append a row keyed by (kind, channel).
 * Returns a fresh array — does not mutate the input.
 */
function upsertRow(
  rows: NotificationPreference[],
  next: NotificationPreference,
): NotificationPreference[] {
  const idx = rows.findIndex((r) => r.kind === next.kind && r.channel === next.channel);
  if (idx === -1) return [...rows, next];
  const copy = rows.slice();
  copy[idx] = next;
  return copy;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  status: 'idle',
  rows: [],
  errorCode: null,

  async bootstrap() {
    if (get().status === 'loading') return;
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.preference.listForMe();
      set({ status: 'ready', rows: r.preferences });
    } catch (e) {
      set({ status: 'error', errorCode: ERR(e) });
    }
  },

  getEffective(kind, channel) {
    const row = get().rows.find((r) => r.kind === kind && r.channel === channel);
    if (!row) {
      return {
        preference: DEFAULT_MATRIX[kind][channel],
        thresholdKobo: null,
        isDefault: true,
      };
    }
    // 'digest' read from a power-user row → display as 'silent' for v1.
    const preference: ChannelPreference =
      row.preference === 'digest' ? 'silent' : row.preference;
    return {
      preference,
      thresholdKobo: row.thresholdKobo,
      isDefault: false,
    };
  },

  async set(input) {
    const before = get().rows;
    // Optimistic: synthesize a row matching the upsert. UpdatedAt is a placeholder
    // that gets reconciled to the server's response.
    const optimistic: NotificationPreference = {
      userId: '',
      kind: input.kind,
      channel: input.channel,
      preference: input.preference,
      thresholdKobo: input.thresholdKobo ?? null,
      updatedAt: new Date().toISOString(),
    };
    set({ rows: upsertRow(before, optimistic), errorCode: null });
    try {
      const r = await api.preference.upsert(input);
      set((s) => ({ rows: upsertRow(s.rows, r.preference) }));
    } catch (e) {
      set({ rows: before, errorCode: ERR(e) });
    }
  },
}));
```

- [ ] **Step 2: Typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/state/preferences.store.ts
git -C "C:/Users/alex_/amana" commit -m "feat(principal): preferences.store — effective-pref resolution + optimistic upsert"
```

---

## Phase E — Mobile screens (Tasks 7-10)

### Task 7 — `SettingsScreen.tsx`

**Files:**
- Create: `apps/principal/src/screens/SettingsScreen.tsx`

The screen has three rows: notification preferences, log out, and a read-only app version. Logout is moved here from `HomeDashboardScreen` (Task 10 removes the dashboard's button).

- [ ] **Step 1: Implement**

```tsx
// apps/principal/src/screens/SettingsScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { useAuthStore } from '../state/auth.store';

type Props = NativeStackScreenProps<MainStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const logout = useAuthStore((s) => s.logout);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate('NotificationPreferences')}
      >
        <Text style={styles.rowTitle}>Notification preferences</Text>
        <Text style={styles.muted}>Choose which alerts reach you and how</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => void logout()}>
        <Text style={[styles.rowTitle, styles.danger]}>Log out</Text>
      </Pressable>

      <View style={styles.row}>
        <Text style={styles.rowTitle}>App version</Text>
        <Text style={styles.muted}>Amana {version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
  danger: { color: '#b00020' },
});
```

- [ ] **Step 2: Typecheck (will fail until Task 11 wires the route)**

Skip typecheck; deferred to Task 11.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/SettingsScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): SettingsScreen — prefs entry, logout, app version"
```

---

### Task 8 — `NotificationPreferencesScreen.tsx`

**Files:**
- Create: `apps/principal/src/screens/NotificationPreferencesScreen.tsx`

Top-level prefs screen. Lists 6 kinds with a one-line digest of effective values.

- [ ] **Step 1: Implement**

```tsx
// apps/principal/src/screens/NotificationPreferencesScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationChannel, NotificationKind } from '@amana/types';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { usePreferencesStore } from '../state/preferences.store';

type Props = NativeStackScreenProps<MainStackParamList, 'NotificationPreferences'>;

const KINDS: NotificationKind[] = [
  'bump_requested',
  'bump_decided',
  'txn_settled',
  'txn_failed',
  'anomaly_alert',
  'refund_received',
];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push',
  in_app: 'In-app',
  sms: 'SMS',
};

function kindTitle(kind: NotificationKind): string {
  switch (kind) {
    case 'bump_requested':
      return 'Bump requests';
    case 'bump_decided':
      return 'Bump decisions';
    case 'txn_settled':
      return 'Payments sent';
    case 'txn_failed':
      return 'Failed payments';
    case 'anomaly_alert':
      return 'Anomaly alerts';
    case 'refund_received':
      return 'Refunds received';
  }
}

export function NotificationPreferencesScreen({ navigation }: Props): JSX.Element {
  const status = usePreferencesStore((s) => s.status);
  const errorCode = usePreferencesStore((s) => s.errorCode);
  const bootstrap = usePreferencesStore((s) => s.bootstrap);
  const getEffective = usePreferencesStore((s) => s.getEffective);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const summarize = (kind: NotificationKind): string => {
    const channels: NotificationChannel[] = ['push', 'in_app', 'sms'];
    const on = channels.filter((c) => getEffective(kind, c).preference !== 'silent');
    if (on.length === 0) return 'Off';
    const labels = on.map((c) => CHANNEL_LABELS[c]);
    return labels.join(', ');
  };

  if (status === 'idle' || (status === 'loading' && usePreferencesStore.getState().rows.length === 0)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load: {errorCode}</Text>
        <Pressable style={styles.button} onPress={() => void bootstrap()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={KINDS}
      keyExtractor={(k) => k}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            navigation.navigate('NotificationKindDetail', { kind: item })
          }
        >
          <Text style={styles.rowTitle}>{kindTitle(item)}</Text>
          <Text style={styles.muted}>{summarize(item)}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  row: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666' },
  err: { color: '#b00020' },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 2: Typecheck (will fail until Task 11 wires the route)**

Skip typecheck; deferred to Task 11.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/NotificationPreferencesScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): NotificationPreferencesScreen — per-kind list with one-line digest"
```

---

### Task 9 — `NotificationKindDetailScreen.tsx`

**Files:**
- Create: `apps/principal/src/screens/NotificationKindDetailScreen.tsx`

Per-kind detail. Three channel rows. Bumps + refunds get a switch; threshold-eligible kinds (`txn_settled`, `txn_failed`, `anomaly_alert`) get a 3-segment control with conditional numeric input.

- [ ] **Step 1: Implement**

```tsx
// apps/principal/src/screens/NotificationKindDetailScreen.tsx
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  ChannelPreference,
  NotificationChannel,
  NotificationKind,
} from '@amana/types';
import { useLayoutEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MainStackParamList } from '../nav/MainStack';
import { usePreferencesStore } from '../state/preferences.store';

type Props = NativeStackScreenProps<MainStackParamList, 'NotificationKindDetail'>;

const CHANNELS: NotificationChannel[] = ['push', 'in_app', 'sms'];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push',
  in_app: 'In-app',
  sms: 'SMS',
};

const THRESHOLD_KINDS: NotificationKind[] = ['txn_settled', 'txn_failed', 'anomaly_alert'];

function isThresholdKind(kind: NotificationKind): boolean {
  return THRESHOLD_KINDS.includes(kind);
}

function kindTitle(kind: NotificationKind): string {
  switch (kind) {
    case 'bump_requested':
      return 'Bump requests';
    case 'bump_decided':
      return 'Bump decisions';
    case 'txn_settled':
      return 'Payments sent';
    case 'txn_failed':
      return 'Failed payments';
    case 'anomaly_alert':
      return 'Anomaly alerts';
    case 'refund_received':
      return 'Refunds received';
  }
}

/** Convert naira (string from input) → kobo (string). Returns null on empty/invalid. */
function nairaInputToKoboString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const naira = Number(trimmed);
  if (!Number.isFinite(naira) || naira < 0) return null;
  return Math.round(naira * 100).toString();
}

/** Convert kobo string → naira display string. */
function koboToNairaDisplay(kobo: string | null): string {
  if (kobo === null) return '';
  const kn = BigInt(kobo);
  const naira = kn / 100n;
  const remainder = kn % 100n;
  if (remainder === 0n) return naira.toString();
  return `${naira}.${remainder.toString().padStart(2, '0')}`;
}

/** For anomaly_alert: backend stores percent×100 in thresholdKobo (e.g., 8500 = 0.85 score). */
function thresholdKoboToScorePercentDisplay(kobo: string | null): string {
  if (kobo === null) return '';
  return (Number(kobo) / 100).toString();
}

function scorePercentInputToThresholdKobo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.round(pct * 100).toString();
}

export function NotificationKindDetailScreen({ route, navigation }: Props): JSX.Element {
  const { kind } = route.params;
  const getEffective = usePreferencesStore((s) => s.getEffective);
  const setPref = usePreferencesStore((s) => s.set);

  useLayoutEffect(() => {
    navigation.setOptions({ title: kindTitle(kind) });
  }, [navigation, kind]);

  const isThreshold = isThresholdKind(kind);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {CHANNELS.map((channel) => {
        const eff = getEffective(kind, channel);
        return (
          <View key={channel} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{CHANNEL_LABELS[channel]}</Text>
              {eff.isDefault && (
                <View style={styles.defaultPill}>
                  <Text style={styles.defaultPillText}>Default</Text>
                </View>
              )}
            </View>
            {isThreshold ? (
              <ThresholdControl
                kind={kind}
                channel={channel}
                effective={eff}
                onSet={setPref}
              />
            ) : (
              <BinaryControl
                kind={kind}
                channel={channel}
                effective={eff}
                onSet={setPref}
              />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function BinaryControl({
  kind,
  channel,
  effective,
  onSet,
}: {
  kind: NotificationKind;
  channel: NotificationChannel;
  effective: { preference: ChannelPreference };
  onSet: (input: { kind: NotificationKind; channel: NotificationChannel; preference: ChannelPreference; thresholdKobo?: string | null }) => Promise<void>;
}): JSX.Element {
  const on = effective.preference !== 'silent';
  return (
    <View style={styles.controlRow}>
      <Text style={styles.muted}>{on ? 'On' : 'Off'}</Text>
      <Switch
        value={on}
        onValueChange={(next) => {
          void onSet({
            kind,
            channel,
            preference: next ? 'real_time' : 'silent',
            thresholdKobo: null,
          });
        }}
      />
    </View>
  );
}

function ThresholdControl({
  kind,
  channel,
  effective,
  onSet,
}: {
  kind: NotificationKind;
  channel: NotificationChannel;
  effective: { preference: ChannelPreference; thresholdKobo: string | null };
  onSet: (input: { kind: NotificationKind; channel: NotificationChannel; preference: ChannelPreference; thresholdKobo?: string | null }) => Promise<void>;
}): JSX.Element {
  const isAnomaly = kind === 'anomaly_alert';
  const initial =
    effective.preference === 'threshold'
      ? isAnomaly
        ? thresholdKoboToScorePercentDisplay(effective.thresholdKobo)
        : koboToNairaDisplay(effective.thresholdKobo)
      : '';
  const [draft, setDraft] = useState(initial);

  const choose = (next: ChannelPreference) => {
    // Preserve the saved thresholdKobo across all mode toggles. Backend stores it
    // regardless of preference; shouldSend only consults it when preference === 'threshold',
    // so the saved value is harmless when off and ready when the user toggles back.
    void onSet({
      kind,
      channel,
      preference: next,
      thresholdKobo: effective.thresholdKobo,
    });
  };

  const commitThreshold = () => {
    const koboStr = isAnomaly
      ? scorePercentInputToThresholdKobo(draft)
      : nairaInputToKoboString(draft);
    if (koboStr === null) return; // ignore invalid input; user can correct
    void onSet({
      kind,
      channel,
      preference: 'threshold',
      thresholdKobo: koboStr,
    });
  };

  return (
    <View>
      <View style={styles.segmented}>
        <SegBtn
          label="Real-time"
          active={effective.preference === 'real_time'}
          onPress={() => choose('real_time')}
        />
        <SegBtn
          label={isAnomaly ? 'Above score' : 'Above amount'}
          active={effective.preference === 'threshold'}
          onPress={() => choose('threshold')}
        />
        <SegBtn
          label="Off"
          active={effective.preference === 'silent'}
          onPress={() => choose('silent')}
        />
      </View>
      {effective.preference === 'threshold' && (
        <View style={styles.thresholdInput}>
          <Text style={styles.muted}>
            {isAnomaly ? 'Score above (%, 0–100):' : 'Notify me above (₦):'}
          </Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onBlur={commitThreshold}
            keyboardType="numeric"
            placeholder={isAnomaly ? '85' : '5000'}
          />
        </View>
      )}
    </View>
  );
}

function SegBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable style={[styles.seg, active && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 24 },
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  defaultPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
  },
  defaultPillText: { fontSize: 11, fontWeight: '600', color: '#444' },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { color: '#666' },
  segmented: { flexDirection: 'row', borderRadius: 999, backgroundColor: '#f3f3f3', padding: 4 },
  seg: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 999 },
  segActive: { backgroundColor: '#222' },
  segText: { fontSize: 13, color: '#444', fontWeight: '500' },
  segTextActive: { color: 'white' },
  thresholdInput: { marginTop: 12, gap: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbb',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
});
```

- [ ] **Step 2: Typecheck (will fail until Task 11 wires the route)**

Skip typecheck; deferred to Task 11.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/NotificationKindDetailScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): NotificationKindDetailScreen — per-channel pref editor with threshold input"
```

---

### Task 10 — `HomeDashboardScreen.tsx` (add Settings tile, remove Logout)

**Files:**
- Modify: `apps/principal/src/screens/HomeDashboardScreen.tsx`

- [ ] **Step 1: Read the existing file** to know its current structure.

- [ ] **Step 2: Edit the file**

a. Remove the `useAuthStore` import line at the top — `logout` is no longer needed here.

Find:
```tsx
import { useAuthStore } from '../state/auth.store';
```
Delete it.

b. Remove the `logout` selector and the import inside the component body. Find:
```tsx
  const logout = useAuthStore((s) => s.logout);
```
Delete it.

c. Remove the existing logout button JSX. Find:
```tsx
      <Pressable
        style={[styles.button, styles.danger]}
        onPress={() => {
          void logout();
        }}
      >
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
```
Delete the entire block.

d. Add a new Settings tile. AFTER the existing "Pair an agent" tile (the last tile before the now-removed Log out button), insert:

```tsx
      <Pressable style={styles.row} onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.rowTitle}>Settings</Text>
        <Text style={styles.muted}>Notifications, log out, and more</Text>
      </Pressable>
```

e. The `button`, `danger`, and `buttonText` style entries are now unused. Remove them from the `StyleSheet.create({ ... })` call.

- [ ] **Step 3: Typecheck (will fail until Task 11 wires `Settings` route)**

Skip typecheck; deferred to Task 11.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/screens/HomeDashboardScreen.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): HomeDashboard — Settings tile (logout moves to Settings)"
```

---

## Phase F — Wiring (Task 11)

### Task 11 — `MainStack` adds 3 new routes

**Files:**
- Modify: `apps/principal/src/nav/MainStack.tsx`

- [ ] **Step 1: Read the existing file** to know its current structure.

- [ ] **Step 2: Edit the file**

a. Add three imports next to the existing screen imports (alphabetical insertion):

```tsx
import { NotificationKindDetailScreen } from '../screens/NotificationKindDetailScreen';
import { NotificationPreferencesScreen } from '../screens/NotificationPreferencesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
```

b. Add `NotificationKind` import at the top of the file:

```tsx
import type { NotificationKind } from '@amana/types';
```

c. Add three new entries to `MainStackParamList`:

```tsx
export type MainStackParamList = {
  HomeDashboard: undefined;
  HouseholdSetup: undefined;
  Pairing: undefined;
  Members: undefined;
  SubWalletsList: undefined;
  CreateSubWallet: undefined;
  SubWalletDetail: { subWalletId: string };
  EditRules: { subWalletId: string };
  BumpsInbox: undefined;
  NotificationsInbox: undefined;
  EnableNotifications: undefined;
  Settings: undefined;
  NotificationPreferences: undefined;
  NotificationKindDetail: { kind: NotificationKind };
};
```

d. Add three `<Stack.Screen>` declarations inside the `<Stack.Navigator>`. Insert AFTER the existing `EnableNotifications` screen entry:

```tsx
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: 'Notification preferences' }}
      />
      <Stack.Screen
        name="NotificationKindDetail"
        component={NotificationKindDetailScreen}
        options={{ title: 'Notification kind' }}
      />
```

(`title: 'Notification kind'` is overridden at runtime by the screen via `navigation.setOptions`.)

- [ ] **Step 3: Run the full principal typecheck**

```bash
cd "C:/Users/alex_/amana"
pnpm --filter @amana/principal typecheck
```

Expected: PASS. This is the first full typecheck since Task 6 — it covers all screens added in Tasks 7-10. If it fails, fix the offending screen file rather than skipping verification.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/alex_/amana" add apps/principal/src/nav/MainStack.tsx
git -C "C:/Users/alex_/amana" commit -m "feat(principal): wire Settings, NotificationPreferences, NotificationKindDetail routes"
```

---

## Phase G — Verification + ship (Tasks 12-14)

### Task 12 — Pre-flight all green

- [ ] **Step 1: Run the full sweep**

```bash
cd "C:/Users/alex_/amana"
docker compose up -d postgres
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
pnpm -r build
pnpm exec biome check .
pnpm typecheck
pnpm --filter @amana/api-client test
pnpm --filter @amana/backend test
docker compose down
```

Expected:
- Build: 6/6 successful
- Biome: 0 errors (warnings allowed)
- Typecheck: 9/9 clean
- api-client tests: ≥47 passing (41 from 6b-3 + 5 PreferenceApi + 1 BumpApi `'all'` case)
- backend tests: ≥402 passing (no backend changes; same as 6b-3 baseline)

If anything fails, fix and re-run before continuing.

---

### Task 13 — Biome auto-format sweep

- [ ] **Step 1: Run auto-format**

```bash
cd "C:/Users/alex_/amana"
pnpm exec biome check --write .
git -C "C:/Users/alex_/amana" status
```

If any files were changed, stage ONLY the files you've actually touched in 6b-4 (do not `git add -A` — that would sweep up the long-untracked `.claude/` and `docs/business/` directories):

```bash
git -C "C:/Users/alex_/amana" add packages/types/src packages/api-client/src packages/api-client/tests apps/principal/src apps/principal/App.tsx
git -C "C:/Users/alex_/amana" commit -m "style: biome auto-format (Sub-plan 6b-4 sweep)"
```

(Skip the commit if `git status` reports no changes after the auto-format.)

- [ ] **Step 2: Re-verify biome is clean**

```bash
pnpm exec biome check . 2>&1 | tail -3
```

Expected: 0 errors. Warnings (e.g., pre-existing `noNonNullAssertion`) are OK and pre-existing.

---

### Task 14 — Push + tag v0.0.6b4-principal-prefs-and-cleanup

- [ ] **Step 1: Push + tag**

```bash
cd "C:/Users/alex_/amana"
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.6b4-principal-prefs-and-cleanup -m "Sub-plan 6b-4 complete: Principal — notification preferences UI + post-6b-3 cleanup (I2/I3/I4/I5/M3)"
git -C "C:/Users/alex_/amana" push origin v0.0.6b4-principal-prefs-and-cleanup
```

- [ ] **Step 2: Verify CI green** at https://github.com/Alexander77063/amana/actions on the v0.0.6b4-principal-prefs-and-cleanup tag.

---

## Plan complete

When all 14 tasks land green:

- A principal can open Settings from the home dashboard
- A principal sees a list of 6 notification kinds with one-line summaries of current effective preferences
- A principal can tap a kind and edit per-channel preferences (Real-time / Above amount / Off, with threshold input where relevant)
- Toggling a preference takes effect immediately (optimistic) and is persisted via `PUT /me/notification-preferences`
- Logout has moved from HomeDashboard to Settings
- All five 6b-3 final-review minor fixes (I2/I3/I4/I5/M3) are tied off
- All existing tests still pass; ~6 new api-client tests added

## Out-of-scope for this slice (handled later)

- Sub-wallet snooze/mute → Sub-plan 6b-5
- Global quiet hours → Sub-plan 6b-5
- Digest mode in the UI → blocked on the digest cron (separate slice)
- Bulk PUT of preferences → YAGNI at this UI volume
- Transaction detail screen → its own slice (`subWalletId` field added to deep-link type as forward-pointer only)
- Bulk-edit "Quiet" / "Everything" presets → punted; explicit per-cell control is enough for v1
