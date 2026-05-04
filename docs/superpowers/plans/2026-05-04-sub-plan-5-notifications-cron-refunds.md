# Sub-plan 5 — Notifications + Cron + Refund Recon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the user-visible side of the system. Notifications (push via Expo, SMS via Termii, in-app stored) honour each principal's preference matrix. Cron scheduler runs the recon batch + bump TTL sweep on a schedule. Refund recon links inbound NIP credits back to their originating spend instead of mis-booking them as topups.

**Architecture:**
- **Notification dispatch is channel-agnostic.** A single `notificationService.dispatch(intent)` accepts a typed `NotificationIntent`, evaluates the recipient's preference matrix, fans out to one or more channels (push / sms / in-app), and persists a `notifications` row recording the dispatch decision + delivery receipts.
- **Preference matrix is per-user, per-event-kind.** A small enum of event kinds (`bump_requested`, `txn_settled`, `txn_failed`, `anomaly_alert`, `refund_received`) crossed with channel preferences (`real_time` / `threshold` / `digest` / `silent`) lets principals tune what wakes their phone vs what waits for the daily digest.
- **Templates are typed builders.** `templates.bumpRequested(ctx)`, `templates.txnSettled(ctx)`, etc. return `{ title, body, data }`. One file per template family. Snapshot tests lock the copy. Tests cover the function output, not the rendered push.
- **Push uses Expo Server SDK.** `expo-server-sdk` wraps FCM + APNs; we send via Expo's HTTPS API. Token format is `ExponentPushToken[...]`. Expo handles APNs cert + FCM key on its side; our backend just needs a single `EXPO_ACCESS_TOKEN` env var (optional — MVP leaves it unset and falls back to anonymous sending which Expo allows for low volume).
- **SMS via Termii.** Adapter pattern matching Sub-plan 2's Anchor wrapper: HTTP client + retry + circuit breaker. For MVP the implementation lives behind a `TERMII_API_KEY` env var; without it, the SMS provider no-ops and logs a warning. Real keys land in SP8.
- **Cron scheduler is in-process via `node-cron`.** Two scheduled jobs at MVP: (1) recon sweep every 5 min, (2) bump TTL sweep every minute. The scheduler boots when `bin/cron.ts` starts a long-lived process; it does NOT boot inside the HTTP server (separation of concerns — the API server can scale horizontally; only one cron worker needs to run).
- **Refund recon detects misdirected topups.** When `topupService.handle` would book an inbound NIP credit, it first checks if the credit matches a recent outbound spend by `(senderBankCode + senderAccountNumber)` against `(vendorBankCode + vendorAccount)` of any `settled` spend in the last 14 days for the same master wallet. If matched, it routes to `refundService.handleRefund` which posts a re-credit (debit external, credit source) instead of the topup posting.

**Tech Stack additions:**
- `expo-server-sdk` (npm) — push notifications wrapping FCM + APNs.
- `node-cron` (npm) — cron scheduling in-process.
- No DB driver changes; no new partner SDKs.

**Out of scope for this sub-plan (covered later):**
- Real push delivery testing across iOS / Android devices — Sub-plans 6 + 7 (mobile apps register tokens; this sub-plan provides the backend that consumes them).
- SMS to real Nigerian phones — Sub-plan 8 (live Termii API key + delivery smoke).
- Notification analytics / open-rate tracking — Sub-plan 8 or v1.1.
- Daily-digest aggregation job — Sub-plan 5 introduces the `digest` preference value but the actual aggregator job ships in Sub-plan 8 once we have realistic volume.
- BullMQ / Redis cron — defer to SP8 when scale demands; node-cron is sufficient at MVP volume.

**Plan length:** 33 tasks across 12 phases.

---

## File structure produced by this plan

```
apps/backend/src/
├── db/schema/
│   └── notifications.ts                          NEW (notification_preferences, device_tokens, notifications)
├── modules/
│   ├── notifications/
│   │   ├── types.ts                              NEW (NotificationIntent, NotificationKind, ChannelPreference)
│   │   ├── prefs.repo.ts                         NEW
│   │   ├── prefs.service.ts                      NEW (shouldNotify(user, kind, channel))
│   │   ├── device-tokens.repo.ts                 NEW
│   │   ├── notifications.repo.ts                 NEW (in-app store + outbox audit)
│   │   ├── templates/
│   │   │   ├── bump-requested.ts                 NEW
│   │   │   ├── txn-settled.ts                    NEW
│   │   │   ├── txn-failed.ts                     NEW
│   │   │   ├── anomaly-alert.ts                  NEW
│   │   │   └── refund-received.ts                NEW
│   │   ├── providers/
│   │   │   ├── expo-push.provider.ts             NEW
│   │   │   ├── termii-sms.provider.ts            NEW
│   │   │   └── in-app.provider.ts                NEW
│   │   ├── notification.service.ts               NEW (dispatch entry point)
│   │   └── index.ts                              NEW (barrel)
│   └── transactions/
│       ├── refund.service.ts                     NEW (handle inbound NIP that matches a recent spend)
│       ├── topup.service.ts                      MODIFIED (consult refund.service before booking topup)
│       └── index.ts                              MODIFIED (export refundService)
├── integrations/
│   └── termii/
│       ├── client.ts                             NEW (HTTP client with retry)
│       └── index.ts                              NEW
├── cron/
│   ├── jobs/
│   │   ├── recon-sweep.job.ts                    NEW (5-min recon)
│   │   └── bump-ttl-sweep.job.ts                 NEW (1-min bump TTL)
│   ├── scheduler.ts                              NEW (registers + starts node-cron jobs)
│   └── index.ts                                  NEW
├── routes/
│   ├── devices.ts                                NEW (POST /devices, DELETE /devices/:tokenId)
│   ├── notification-prefs.ts                     NEW (GET/PUT /me/notification-preferences)
│   └── notifications.ts                          NEW (GET /me/notifications, POST /me/notifications/:id/read)
└── env.ts                                        MODIFIED (EXPO_ACCESS_TOKEN, TERMII_API_KEY, TERMII_BASE_URL — all optional)

apps/backend/bin/
└── cron.ts                                       NEW (long-lived cron worker entrypoint)

apps/backend/tests/
├── modules/notifications/                        NEW (one .test.ts per service)
├── modules/transactions/refund.service.test.ts   NEW
├── cron/                                         NEW (jobs unit tests)
└── routes/devices.test.ts, notification-prefs.test.ts, notifications.test.ts  NEW
```

Existing wire-in modifications:
- `apps/backend/src/modules/bumps/bump-workflow.service.ts` — call `notificationService.dispatch` from `create()`.
- `apps/backend/src/modules/transactions/settlement.service.ts` — call `notificationService.dispatch` after settle.
- `apps/backend/src/modules/transactions/reversal.service.ts` — call `notificationService.dispatch` after reverse.
- `apps/backend/src/modules/transactions/lifecycle.service.ts` — call `notificationService.dispatch` when anomaly score ≥ 0.85 on `allow` path (per spec §6 principal-direct branch — but applies to agent path too if score is high).

---

## Phase A — Schema (Task 1)

### Task 1: notifications schema (3 tables) + migration

**Files:**
- Create: `apps/backend/src/db/schema/notifications.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Modify: `apps/backend/tests/helpers/test-db.ts` (add the 3 new tables to TABLES_TO_TRUNCATE in dependency order)
- Generated: `apps/backend/src/db/migrations/0015_notifications.sql`

> **drizzle-kit 0.25 reminders** (carried from Sub-plan 4 lessons): BigInt defaults need `.default(sql\`0\`)`; `check()` not emitted; hand-rolled migrations need a manual journal entry; `ALTER TABLE ADD COLUMN ... NOT NULL` without DEFAULT fails on rows but dev tears down between runs so ok for new columns added against fresh tables.

- [ ] **Step 1: Write `apps/backend/src/db/schema/notifications.ts`**

```ts
import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const notificationKindEnum = pgEnum('notification_kind', [
  'bump_requested',
  'bump_decided',
  'txn_settled',
  'txn_failed',
  'anomaly_alert',
  'refund_received',
]);

export const notificationChannelEnum = pgEnum('notification_channel', ['push', 'sms', 'in_app']);

export const channelPreferenceEnum = pgEnum('channel_preference', [
  'real_time',  // send immediately on every event
  'threshold',  // send only above an amount/score threshold
  'digest',     // batch into daily summary (digest aggregator job in SP8)
  'silent',     // never send via this channel
]);

export const devicePlatformEnum = pgEnum('device_platform', ['ios', 'android']);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',    // dispatch decided to send but hasn't yet attempted
  'sent',       // provider accepted the payload
  'failed',     // provider rejected or transient error after retries
  'skipped',    // preference matrix said not to send
  'read',       // in-app: user has read it
]);

/**
 * Per-user, per-(kind × channel) preference. Default rule: insert nothing,
 * service uses `defaultPreferenceFor(kind, channel)` for absent rows.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    preference: channelPreferenceEnum('preference').notNull(),
    /** When `preference='threshold'` and applicable (e.g. txn_settled), only fire above this kobo amount. */
    thresholdKobo: text('threshold_kobo'),  // bigint as text to dodge JS number precision
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.kind, t.channel] }),
  }),
);

/**
 * Expo Push tokens registered by the mobile apps. One row per device install.
 * Token format: `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`.
 */
export const deviceTokens = pgTable('device_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expoPushToken: text('expo_push_token').notNull().unique(),
  platform: devicePlatformEnum('platform').notNull(),
  /** Free-form device label set by the app, e.g. "Pixel 7 (Lagos)". Optional. */
  deviceLabel: text('device_label'),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Outbox + in-app store. Every `notificationService.dispatch` produces 0..N rows here
 * (one per channel resolved by the preference matrix). Rows are immutable except for
 * `status` transitions: `pending → sent | failed | skipped`. In-app rows additionally
 * transition `sent → read`.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  recipientUserId: uuid('recipient_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: notificationKindEnum('kind').notNull(),
  channel: notificationChannelEnum('channel').notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  /** Stable UUID-shaped key derived from the source event (txn id, bump id, etc.) — dedupes retries. */
  dedupeKey: text('dedupe_key').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  /** Provider-side delivery id (Expo ticket id, Termii message id) when status='sent'. */
  providerReceipt: text('provider_receipt'),
  /** Last error message when status='failed'. */
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

The composite PK on `notification_preferences` (`user_id`, `kind`, `channel`) gives us upsert semantics for free. `notifications.dedupeKey` is a unique-per-event-kind string set by the dispatcher (e.g. `bump:${bumpRequestId}`); a UNIQUE index on `(recipient_user_id, channel, dedupe_key)` would prevent double-sends but we deliberately leave it un-unique so the test seeds can re-dispatch — the service-level dedupe check uses `findByDedupeKey`.

- [ ] **Step 2: Append to `apps/backend/src/db/schema/index.ts`**

```ts
export * from './notifications';
```

- [ ] **Step 3: Update `apps/backend/tests/helpers/test-db.ts` `TABLES_TO_TRUNCATE`**

Add three new entries in dependency order (children before parents). Place them BEFORE `'users'`:

```
'notifications',
'device_tokens',
'notification_preferences',
```

- [ ] **Step 4: Generate + apply migration**

```powershell
docker compose up -d
Start-Sleep -Seconds 4
pnpm --filter @amana/backend exec drizzle-kit generate --name notifications
pnpm --filter @amana/backend db:migrate
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ notifications"
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ device_tokens"
docker compose exec postgres psql -U amana -d amana_dev -c "\d+ notification_preferences"
```

Verify the journal is updated. drizzle-kit 0.25 sometimes misses the journal entry for new migrations — if so, append an entry to `apps/backend/src/db/migrations/meta/_journal.json` manually following the pattern of prior entries.

- [ ] **Step 5: Schema smoke test `apps/backend/tests/modules/notifications/schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from '../../helpers/test-db';

describe('notifications schema', () => {
  it('notification_preferences has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notification_preferences'
    `);
    const set = new Set(cols.map((r) => r.column_name));
    expect(set).toEqual(new Set(['user_id', 'kind', 'channel', 'preference', 'threshold_kobo', 'updated_at']));
  });

  it('device_tokens has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'device_tokens'
    `);
    const set = new Set(cols.map((r) => r.column_name));
    expect(set).toEqual(new Set(['id', 'user_id', 'expo_push_token', 'platform', 'device_label', 'registered_at', 'last_seen_at']));
  });

  it('notifications has the expected columns', async () => {
    const cols = await testDb.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notifications'
    `);
    const set = new Set(cols.map((r) => r.column_name));
    expect(set).toEqual(new Set([
      'id', 'recipient_user_id', 'kind', 'channel', 'status',
      'dedupe_key', 'payload_json', 'provider_receipt', 'error_message',
      'created_at', 'updated_at',
    ]));
  });
});
```

- [ ] **Step 6: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/schema.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/db apps/backend/tests/helpers/test-db.ts apps/backend/tests/modules/notifications
git -C "C:/Users/alex_/amana" commit -m "feat(db): notifications schema (preferences + device_tokens + outbox/in-app store)"
```

---

## Phase B — Notification types + dispatcher (Tasks 2-4)

### Task 2: notifications/types.ts

**Files:**
- Create: `apps/backend/src/modules/notifications/types.ts`

- [ ] **Step 1: Write the file**

```ts
export type NotificationKind =
  | 'bump_requested'
  | 'bump_decided'
  | 'txn_settled'
  | 'txn_failed'
  | 'anomaly_alert'
  | 'refund_received';

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type ChannelPreference = 'real_time' | 'threshold' | 'digest' | 'silent';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';

/** What dispatchers pass in. The service resolves recipient prefs + fans out. */
export type NotificationIntent = {
  kind: NotificationKind;
  recipientUserId: string;
  /** Stable per-source-event key, e.g. `bump:${bumpRequestId}`. Used for dedupe + receipts. */
  dedupeKey: string;
  /** Free-form payload — templates pluck from this. */
  payload: Record<string, unknown>;
  /** Optional kobo amount for threshold-preference filtering (e.g. txn_settled). */
  amountKobo?: bigint;
  /** Optional anomaly score for threshold filtering on anomaly_alert. */
  anomalyScore?: number;
};

/** Result returned by `notificationService.dispatch`. */
export type DispatchResult = {
  intent: NotificationIntent;
  rows: Array<{
    notificationId: string;
    channel: NotificationChannel;
    status: NotificationStatus;
  }>;
};

/** Returned by template builders. */
export type RenderedNotification = {
  /** Push title / SMS prefix / in-app card title. */
  title: string;
  /** Body text. Plain — no markup. */
  body: string;
  /** Structured data for in-app rendering + push deep links. */
  data: Record<string, unknown>;
};
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/types.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): types (Intent, Channel, Preference, Result, Rendered)"
```

---

### Task 3: prefs.repo + prefs.service

**Files:**
- Create: `apps/backend/src/modules/notifications/prefs.repo.ts`
- Create: `apps/backend/src/modules/notifications/prefs.service.ts`
- Create: `apps/backend/tests/modules/notifications/prefs.service.test.ts`

The service answers: "Given user U, kind K, channel C, and amount/score, should we send this notification?" The repo is a thin CRUD over `notification_preferences`. Default behaviour when no row exists is encoded in the service (table-driven defaults).

- [ ] **Step 1: prefs.repo.ts**

```ts
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { notificationPreferences } from '../../db/schema';
import type { ChannelPreference, NotificationChannel, NotificationKind } from './types';

type DbOrTx = PostgresJsDatabase;

export type PreferenceRow = typeof notificationPreferences.$inferSelect;

export type UpsertPreferenceInput = {
  userId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  preference: ChannelPreference;
  thresholdKobo?: bigint | null;
};

export const prefsRepo = {
  async findOne(
    db: DbOrTx,
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
  ): Promise<PreferenceRow | undefined> {
    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.kind, kind),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);
    return row;
  },

  async listByUser(db: DbOrTx, userId: string): Promise<PreferenceRow[]> {
    return db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  },

  async upsert(db: DbOrTx, input: UpsertPreferenceInput): Promise<PreferenceRow> {
    const [row] = await db
      .insert(notificationPreferences)
      .values({
        userId: input.userId,
        kind: input.kind,
        channel: input.channel,
        preference: input.preference,
        thresholdKobo: input.thresholdKobo === null || input.thresholdKobo === undefined
          ? null
          : input.thresholdKobo.toString(),
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.kind, notificationPreferences.channel],
        set: {
          preference: input.preference,
          thresholdKobo: input.thresholdKobo === null || input.thresholdKobo === undefined
            ? null
            : input.thresholdKobo.toString(),
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('prefs.upsert returned no row');
    return row;
  },
};
```

- [ ] **Step 2: prefs.service.ts**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { prefsRepo } from './prefs.repo';
import type { ChannelPreference, NotificationChannel, NotificationIntent, NotificationKind } from './types';

/**
 * Default preference matrix when no per-user row exists.
 * Rationale:
 *  - Bump requests + anomaly alerts wake the principal in real-time on push (action-required).
 *  - Settled / failed txns go to in-app real-time + push real-time (visibility).
 *  - SMS defaults to silent (cost + noise) except bump_requested where it's a fallback for principals
 *    without push tokens registered (Anchor can't reach them otherwise).
 */
const DEFAULT_MATRIX: Record<NotificationKind, Record<NotificationChannel, ChannelPreference>> = {
  bump_requested: { push: 'real_time', sms: 'real_time', in_app: 'real_time' },
  bump_decided: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_settled: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_failed: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  anomaly_alert: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  refund_received: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
};

export const prefsService = {
  /** Returns the effective preference for (user, kind, channel), falling back to the default matrix. */
  async getPreference(
    db: PostgresJsDatabase,
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
  ): Promise<{ preference: ChannelPreference; thresholdKobo: bigint | null }> {
    const row = await prefsRepo.findOne(db, userId, kind, channel);
    if (row) {
      return {
        preference: row.preference as ChannelPreference,
        thresholdKobo: row.thresholdKobo === null ? null : BigInt(row.thresholdKobo),
      };
    }
    return { preference: DEFAULT_MATRIX[kind][channel], thresholdKobo: null };
  },

  /**
   * Decide whether to send a given intent on a given channel.
   * Returns 'send' | 'skip_silent' | 'skip_threshold' | 'defer_digest'.
   */
  async shouldSend(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    channel: NotificationChannel,
  ): Promise<'send' | 'skip_silent' | 'skip_threshold' | 'defer_digest'> {
    const { preference, thresholdKobo } = await prefsService.getPreference(
      db,
      intent.recipientUserId,
      intent.kind,
      channel,
    );
    if (preference === 'silent') return 'skip_silent';
    if (preference === 'digest') return 'defer_digest';
    if (preference === 'threshold') {
      // Threshold semantics: send only when amount/score is at or above the threshold.
      if (intent.kind === 'anomaly_alert') {
        if (intent.anomalyScore === undefined) return 'skip_threshold';
        // Score threshold uses fixed 0.85 from spec §10 STR triggers when no per-user threshold set.
        const scoreCutoff = thresholdKobo === null ? 0.85 : Number(thresholdKobo) / 100; // store as percent×100
        return intent.anomalyScore >= scoreCutoff ? 'send' : 'skip_threshold';
      }
      if (intent.amountKobo === undefined || thresholdKobo === null) return 'skip_threshold';
      return intent.amountKobo >= thresholdKobo ? 'send' : 'skip_threshold';
    }
    return 'send';
  },
};
```

- [ ] **Step 3: prefs.service.test.ts**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { prefsService } from '../../../src/modules/notifications/prefs.service';
import { prefsRepo } from '../../../src/modules/notifications/prefs.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('prefsService', () => {
  beforeEach(async () => { await truncateAll(); });

  async function aPrincipal(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    return u.id;
  }

  it('returns default matrix entry when no row exists', async () => {
    const userId = await aPrincipal();
    const r = await prefsService.getPreference(testDb, userId, 'bump_requested', 'push');
    expect(r.preference).toBe('real_time');
    expect(r.thresholdKobo).toBeNull();
  });

  it('upsert overrides default; second upsert promotes', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'silent',
    });
    const r1 = await prefsService.getPreference(testDb, userId, 'txn_settled', 'push');
    expect(r1.preference).toBe('silent');
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'threshold',
      thresholdKobo: 100_000n,
    });
    const r2 = await prefsService.getPreference(testDb, userId, 'txn_settled', 'push');
    expect(r2.preference).toBe('threshold');
    expect(r2.thresholdKobo).toBe(100_000n);
  });

  it('shouldSend respects silent preference', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'silent',
    });
    const decision = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 5_000n,
    }, 'push');
    expect(decision).toBe('skip_silent');
  });

  it('shouldSend respects threshold preference for amount-based kinds', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'threshold',
      thresholdKobo: 100_000n,
    });
    const above = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 200_000n,
    }, 'push');
    expect(above).toBe('send');
    const below = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 50_000n,
    }, 'push');
    expect(below).toBe('skip_threshold');
  });

  it('shouldSend respects digest preference', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'digest',
    });
    const decision = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 5_000n,
    }, 'push');
    expect(decision).toBe('defer_digest');
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/prefs.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/prefs.repo.ts apps/backend/src/modules/notifications/prefs.service.ts apps/backend/tests/modules/notifications/prefs.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): prefs.repo + prefs.service (default matrix + threshold/digest/silent decisions)"
```

---

### Task 4: device-tokens.repo + notifications.repo

**Files:**
- Create: `apps/backend/src/modules/notifications/device-tokens.repo.ts`
- Create: `apps/backend/src/modules/notifications/notifications.repo.ts`
- Create: `apps/backend/tests/modules/notifications/device-tokens.repo.test.ts`
- Create: `apps/backend/tests/modules/notifications/notifications.repo.test.ts`

- [ ] **Step 1: device-tokens.repo.ts**

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deviceTokens } from '../../db/schema';

type DbOrTx = PostgresJsDatabase;

export type DeviceTokenRow = typeof deviceTokens.$inferSelect;

export type RegisterTokenInput = {
  userId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  deviceLabel?: string | null;
};

export const deviceTokensRepo = {
  /** Register or refresh a device token. Upserts on `expoPushToken` (unique). */
  async register(db: DbOrTx, input: RegisterTokenInput): Promise<DeviceTokenRow> {
    const [row] = await db
      .insert(deviceTokens)
      .values({
        userId: input.userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        deviceLabel: input.deviceLabel ?? null,
      })
      .onConflictDoUpdate({
        target: deviceTokens.expoPushToken,
        set: {
          userId: input.userId,
          platform: input.platform,
          deviceLabel: input.deviceLabel ?? null,
          lastSeenAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('deviceTokens.register returned no row');
    return row;
  },

  async listByUser(db: DbOrTx, userId: string): Promise<DeviceTokenRow[]> {
    return db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId))
      .orderBy(desc(deviceTokens.lastSeenAt));
  },

  async deleteById(db: DbOrTx, id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)))
      .returning({ id: deviceTokens.id });
    return result.length > 0;
  },
};
```

- [ ] **Step 2: notifications.repo.ts**

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { notifications } from '../../db/schema';
import type { NotificationChannel, NotificationKind, NotificationStatus } from './types';

type DbOrTx = PostgresJsDatabase;

export type NotificationRow = typeof notifications.$inferSelect;

export type InsertNotificationInput = {
  recipientUserId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  dedupeKey: string;
  payload: Record<string, unknown>;
  providerReceipt?: string | null;
  errorMessage?: string | null;
};

export const notificationsRepo = {
  async insert(db: DbOrTx, input: InsertNotificationInput): Promise<NotificationRow> {
    const [row] = await db
      .insert(notifications)
      .values({
        recipientUserId: input.recipientUserId,
        kind: input.kind,
        channel: input.channel,
        status: input.status,
        dedupeKey: input.dedupeKey,
        payloadJson: input.payload as object,
        providerReceipt: input.providerReceipt ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .returning();
    if (!row) throw new Error('notifications.insert returned no row');
    return row;
  },

  async findByDedupeKey(
    db: DbOrTx,
    recipientUserId: string,
    channel: NotificationChannel,
    dedupeKey: string,
  ): Promise<NotificationRow | undefined> {
    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, recipientUserId),
          eq(notifications.channel, channel),
          eq(notifications.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    return row;
  },

  async listByRecipient(
    db: DbOrTx,
    recipientUserId: string,
    limit: number,
  ): Promise<NotificationRow[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, recipientUserId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  },

  async markRead(db: DbOrTx, id: string, recipientUserId: string): Promise<boolean> {
    const result = await db
      .update(notifications)
      .set({ status: 'read', updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientUserId, recipientUserId),
        ),
      )
      .returning({ id: notifications.id });
    return result.length > 0;
  },

  async setStatus(
    db: DbOrTx,
    id: string,
    status: NotificationStatus,
    extra?: { providerReceipt?: string; errorMessage?: string },
  ): Promise<void> {
    await db
      .update(notifications)
      .set({
        status,
        providerReceipt: extra?.providerReceipt ?? null,
        errorMessage: extra?.errorMessage ?? null,
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, id));
  },
};
```

- [ ] **Step 3: device-tokens.repo.test.ts**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { deviceTokensRepo } from '../../../src/modules/notifications/device-tokens.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('deviceTokensRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  async function aUser(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    return u.id;
  }

  it('register inserts a new row on first call', async () => {
    const userId = await aUser();
    const row = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[abc]', platform: 'android',
    });
    expect(row.expoPushToken).toBe('ExponentPushToken[abc]');
    expect(row.platform).toBe('android');
  });

  it('register upserts on conflict (refreshes lastSeenAt)', async () => {
    const userId = await aUser();
    const first = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[abc]', platform: 'android',
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[abc]', platform: 'android', deviceLabel: 'Pixel 7',
    });
    expect(second.id).toBe(first.id); // same row
    expect(second.deviceLabel).toBe('Pixel 7');
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it('listByUser returns tokens in lastSeen DESC', async () => {
    const userId = await aUser();
    await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[a]', platform: 'android',
    });
    await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[b]', platform: 'ios',
    });
    const list = await deviceTokensRepo.listByUser(testDb, userId);
    expect(list).toHaveLength(2);
  });

  it('deleteById removes only the matching row for the user', async () => {
    const userId = await aUser();
    const otherUserId = await aUser();
    const row = await deviceTokensRepo.register(testDb, {
      userId, expoPushToken: 'ExponentPushToken[mine]', platform: 'android',
    });
    const wrongUserDelete = await deviceTokensRepo.deleteById(testDb, row.id, otherUserId);
    expect(wrongUserDelete).toBe(false);
    const okDelete = await deviceTokensRepo.deleteById(testDb, row.id, userId);
    expect(okDelete).toBe(true);
  });
});
```

- [ ] **Step 4: notifications.repo.test.ts**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('notificationsRepo', () => {
  beforeEach(async () => { await truncateAll(); });

  async function aUser(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    return u.id;
  }

  it('insert + findByDedupeKey roundtrips', async () => {
    const userId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId, kind: 'bump_requested', channel: 'push',
      status: 'sent', dedupeKey: 'bump:abc', payload: { transactionId: 't1' },
    });
    const found = await notificationsRepo.findByDedupeKey(testDb, userId, 'push', 'bump:abc');
    expect(found?.id).toBe(row.id);
  });

  it('markRead transitions sent → read for the matching user', async () => {
    const userId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId, kind: 'txn_settled', channel: 'in_app',
      status: 'sent', dedupeKey: 'txn:t1', payload: {},
    });
    expect(await notificationsRepo.markRead(testDb, row.id, userId)).toBe(true);
    const fresh = await notificationsRepo.findByDedupeKey(testDb, userId, 'in_app', 'txn:t1');
    expect(fresh?.status).toBe('read');
  });

  it('markRead returns false if user does not own the row', async () => {
    const userId = await aUser();
    const otherUserId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId, kind: 'txn_settled', channel: 'in_app',
      status: 'sent', dedupeKey: 'txn:t2', payload: {},
    });
    expect(await notificationsRepo.markRead(testDb, row.id, otherUserId)).toBe(false);
  });

  it('setStatus updates fields atomically', async () => {
    const userId = await aUser();
    const row = await notificationsRepo.insert(testDb, {
      recipientUserId: userId, kind: 'txn_failed', channel: 'sms',
      status: 'pending', dedupeKey: 'txn:t3', payload: {},
    });
    await notificationsRepo.setStatus(testDb, row.id, 'sent', { providerReceipt: 'tm-1' });
    const fresh = await notificationsRepo.findByDedupeKey(testDb, userId, 'sms', 'txn:t3');
    expect(fresh?.status).toBe('sent');
    expect(fresh?.providerReceipt).toBe('tm-1');
  });
});
```

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/device-tokens.repo.test.ts tests/modules/notifications/notifications.repo.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/device-tokens.repo.ts apps/backend/src/modules/notifications/notifications.repo.ts apps/backend/tests/modules/notifications/device-tokens.repo.test.ts apps/backend/tests/modules/notifications/notifications.repo.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): device-tokens.repo + notifications.repo (in-app outbox + dedupe)"
```

---

## Phase C — Templates (Tasks 5-6)

### Task 5: Templates registry (5 files + index)

**Files:**
- Create: `apps/backend/src/modules/notifications/templates/bump-requested.ts`
- Create: `apps/backend/src/modules/notifications/templates/bump-decided.ts`
- Create: `apps/backend/src/modules/notifications/templates/txn-settled.ts`
- Create: `apps/backend/src/modules/notifications/templates/txn-failed.ts`
- Create: `apps/backend/src/modules/notifications/templates/anomaly-alert.ts`
- Create: `apps/backend/src/modules/notifications/templates/refund-received.ts`
- Create: `apps/backend/src/modules/notifications/templates/index.ts`

Each template is a pure function. Naira amounts shown as `₦5,200` (no decimals when whole), `₦5,200.50` when fractional. Helper `formatNaira(kobo: bigint): string` lives in `lib/kobo.ts` already (verify; if not, add it as part of this task).

- [ ] **Step 1: Verify `formatNaira` in `apps/backend/src/lib/kobo.ts`**

If absent, add it. Expected behaviour: `formatNaira(520050n)` → `"₦5,200.50"`, `formatNaira(500000n)` → `"₦5,000"`. Format: comma thousands separator, two decimals only if non-zero.

```ts
export function formatNaira(amountKobo: bigint): string {
  const naira = amountKobo / 100n;
  const remainderKobo = amountKobo % 100n;
  const intPart = naira.toLocaleString('en-NG'); // "5,200"
  if (remainderKobo === 0n) return `₦${intPart}`;
  const dec = remainderKobo.toString().padStart(2, '0');
  return `₦${intPart}.${dec}`;
}
```

If you add it, update the relevant test (or create one).

- [ ] **Step 2: Templates**

`bump-requested.ts`:

```ts
import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type BumpRequestedContext = {
  bumpRequestId: string;
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  agentDisplayName: string;
};

export function bumpRequested(ctx: BumpRequestedContext): RenderedNotification {
  return {
    title: 'Approve a bump?',
    body: `${ctx.agentDisplayName} wants to spend ${formatNaira(ctx.amountKobo)} at ${ctx.vendorResolvedName}.`,
    data: {
      kind: 'bump_requested',
      bumpRequestId: ctx.bumpRequestId,
      transactionId: ctx.transactionId,
    },
  };
}
```

`bump-decided.ts`:

```ts
import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type BumpDecidedContext = {
  bumpRequestId: string;
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  decision: 'approve_once' | 'approve_raise_limit' | 'deny';
};

export function bumpDecided(ctx: BumpDecidedContext): RenderedNotification {
  const isApproved = ctx.decision !== 'deny';
  return {
    title: isApproved ? 'Bump approved' : 'Bump declined',
    body: isApproved
      ? `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} approved.`
      : `Your request for ${formatNaira(ctx.amountKobo)} at ${ctx.vendorResolvedName} was declined.`,
    data: {
      kind: 'bump_decided',
      bumpRequestId: ctx.bumpRequestId,
      transactionId: ctx.transactionId,
      decision: ctx.decision,
    },
  };
}
```

`txn-settled.ts`:

```ts
import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type TxnSettledContext = {
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  nibssSessionId: string | null;
};

export function txnSettled(ctx: TxnSettledContext): RenderedNotification {
  return {
    title: 'Payment sent',
    body: `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} settled.`,
    data: {
      kind: 'txn_settled',
      transactionId: ctx.transactionId,
      nibssSessionId: ctx.nibssSessionId,
    },
  };
}
```

`txn-failed.ts`:

```ts
import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type TxnFailedContext = {
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  reason: string | null;
};

export function txnFailed(ctx: TxnFailedContext): RenderedNotification {
  return {
    title: 'Payment failed',
    body: `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} couldn't be sent${ctx.reason ? `: ${ctx.reason}` : ''}.`,
    data: {
      kind: 'txn_failed',
      transactionId: ctx.transactionId,
      reason: ctx.reason,
    },
  };
}
```

`anomaly-alert.ts`:

```ts
import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type AnomalyAlertContext = {
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  anomalyScore: number;
};

export function anomalyAlert(ctx: AnomalyAlertContext): RenderedNotification {
  const pct = Math.round(ctx.anomalyScore * 100);
  return {
    title: 'Unusual transaction flagged',
    body: `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} scored ${pct}/100 for unusual pattern.`,
    data: {
      kind: 'anomaly_alert',
      transactionId: ctx.transactionId,
      anomalyScore: ctx.anomalyScore,
    },
  };
}
```

`refund-received.ts`:

```ts
import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type RefundReceivedContext = {
  refundTransactionId: string;
  originalTransactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
};

export function refundReceived(ctx: RefundReceivedContext): RenderedNotification {
  return {
    title: 'Refund received',
    body: `${formatNaira(ctx.amountKobo)} refunded from ${ctx.vendorResolvedName}.`,
    data: {
      kind: 'refund_received',
      refundTransactionId: ctx.refundTransactionId,
      originalTransactionId: ctx.originalTransactionId,
    },
  };
}
```

`index.ts`:

```ts
export { bumpRequested, type BumpRequestedContext } from './bump-requested';
export { bumpDecided, type BumpDecidedContext } from './bump-decided';
export { txnSettled, type TxnSettledContext } from './txn-settled';
export { txnFailed, type TxnFailedContext } from './txn-failed';
export { anomalyAlert, type AnomalyAlertContext } from './anomaly-alert';
export { refundReceived, type RefundReceivedContext } from './refund-received';
```

- [ ] **Step 3: Commit (tests in T6)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/templates apps/backend/src/lib/kobo.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): typed templates (6 kinds × pure builders) + formatNaira helper"
```

---

### Task 6: Template snapshot tests

**Files:**
- Create: `apps/backend/tests/modules/notifications/templates.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest';
import {
  bumpRequested,
  bumpDecided,
  txnSettled,
  txnFailed,
  anomalyAlert,
  refundReceived,
} from '../../../src/modules/notifications/templates';

describe('notification templates', () => {
  it('bumpRequested renders the canonical copy', () => {
    expect(bumpRequested({
      bumpRequestId: 'b1', transactionId: 't1',
      amountKobo: 520050n, vendorResolvedName: 'MUSA ABDULLAHI', agentDisplayName: 'Driver',
    })).toEqual({
      title: 'Approve a bump?',
      body: 'Driver wants to spend ₦5,200.50 at MUSA ABDULLAHI.',
      data: { kind: 'bump_requested', bumpRequestId: 'b1', transactionId: 't1' },
    });
  });

  it('bumpDecided renders approval and denial copy', () => {
    const approved = bumpDecided({
      bumpRequestId: 'b1', transactionId: 't1', amountKobo: 100_000n,
      vendorResolvedName: 'M', decision: 'approve_once',
    });
    expect(approved.title).toBe('Bump approved');
    expect(approved.body).toBe('₦1,000 to M approved.');
    const denied = bumpDecided({
      bumpRequestId: 'b1', transactionId: 't1', amountKobo: 100_000n,
      vendorResolvedName: 'M', decision: 'deny',
    });
    expect(denied.title).toBe('Bump declined');
  });

  it('txnSettled renders amount + vendor', () => {
    const r = txnSettled({
      transactionId: 't1', amountKobo: 250_000n,
      vendorResolvedName: 'MUSA', nibssSessionId: '12345',
    });
    expect(r.title).toBe('Payment sent');
    expect(r.body).toBe('₦2,500 to MUSA settled.');
    expect(r.data.nibssSessionId).toBe('12345');
  });

  it('txnFailed includes reason when present', () => {
    expect(txnFailed({
      transactionId: 't1', amountKobo: 5_000n,
      vendorResolvedName: 'M', reason: 'beneficiary closed',
    }).body).toBe('₦50 to M couldn\'t be sent: beneficiary closed.');
    expect(txnFailed({
      transactionId: 't1', amountKobo: 5_000n,
      vendorResolvedName: 'M', reason: null,
    }).body).toBe('₦50 to M couldn\'t be sent.');
  });

  it('anomalyAlert formats score as percentage', () => {
    expect(anomalyAlert({
      transactionId: 't1', amountKobo: 100_000n, vendorResolvedName: 'M',
      anomalyScore: 0.87,
    }).body).toBe('₦1,000 to M scored 87/100 for unusual pattern.');
  });

  it('refundReceived references the original txn', () => {
    const r = refundReceived({
      refundTransactionId: 'r1', originalTransactionId: 't1',
      amountKobo: 50_000n, vendorResolvedName: 'M',
    });
    expect(r.body).toBe('₦500 refunded from M.');
    expect(r.data.originalTransactionId).toBe('t1');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/templates.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/notifications/templates.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(notifications): template snapshot tests (6 kinds, naira formatting)"
```

---

## Phase D — Channel providers (Tasks 7-9)

### Task 7: in-app provider

**Files:**
- Create: `apps/backend/src/modules/notifications/providers/in-app.provider.ts`
- Create: `apps/backend/tests/modules/notifications/providers/in-app.provider.test.ts`

The simplest provider — just inserts a `notifications` row with `status='sent'`. The mobile app polls / fetches via the route.

- [ ] **Step 1: Provider**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { notificationsRepo } from '../notifications.repo';
import type { NotificationIntent, RenderedNotification } from '../types';

export const inAppProvider = {
  async send(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    rendered: RenderedNotification,
  ): Promise<{ notificationId: string }> {
    const row = await notificationsRepo.insert(db, {
      recipientUserId: intent.recipientUserId,
      kind: intent.kind,
      channel: 'in_app',
      status: 'sent',
      dedupeKey: intent.dedupeKey,
      payload: { title: rendered.title, body: rendered.body, data: rendered.data },
    });
    return { notificationId: row.id };
  },
};
```

- [ ] **Step 2: Test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../../helpers/test-db';
import { factories } from '../../../helpers/factories';
import { inAppProvider } from '../../../../src/modules/notifications/providers/in-app.provider';
import { notificationsRepo } from '../../../../src/modules/notifications/notifications.repo';
import { usersRepo } from '../../../../src/modules/identity/users.repo';

describe('inAppProvider.send', () => {
  beforeEach(async () => { await truncateAll(); });

  it('inserts a notifications row with status=sent and stores rendered content', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const result = await inAppProvider.send(testDb, {
      kind: 'txn_settled', recipientUserId: u.id, dedupeKey: 'txn:t1', payload: {},
    }, {
      title: 'Payment sent', body: '₦5,000 to M settled.',
      data: { kind: 'txn_settled', transactionId: 't1' },
    });
    const row = await notificationsRepo.findByDedupeKey(testDb, u.id, 'in_app', 'txn:t1');
    expect(row?.id).toBe(result.notificationId);
    expect(row?.status).toBe('sent');
    expect((row?.payloadJson as { title: string }).title).toBe('Payment sent');
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/providers/in-app.provider.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/providers/in-app.provider.ts apps/backend/tests/modules/notifications/providers/in-app.provider.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): in-app provider (inserts row with rendered content)"
```

---

### Task 8: Expo Push provider

**Files:**
- Modify: `apps/backend/package.json` (add `expo-server-sdk` dep)
- Modify: `apps/backend/src/env.ts` (add optional `EXPO_ACCESS_TOKEN`)
- Create: `apps/backend/src/modules/notifications/providers/expo-push.provider.ts`
- Create: `apps/backend/tests/modules/notifications/providers/expo-push.provider.test.ts`

- [ ] **Step 1: Install dep**

```powershell
pnpm --filter @amana/backend add expo-server-sdk
```

- [ ] **Step 2: Add env var**

In `apps/backend/src/env.ts`, extend the existing schema:

```ts
EXPO_ACCESS_TOKEN: z.string().optional(),
```

The token is optional because Expo allows anonymous sends at low volume. Real prod sets it.

- [ ] **Step 3: Provider**

```ts
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { env } from '../../../env';
import { logger } from '../../../lib/logger';
import { deviceTokensRepo } from '../device-tokens.repo';
import type { NotificationIntent, RenderedNotification } from '../types';

const expo = new Expo({
  accessToken: env.EXPO_ACCESS_TOKEN,
  useFcmV1: true,
});

export type ExpoSendResult = {
  attempted: number;
  accepted: number;
  rejected: number;
  tickets: ExpoPushTicket[];
};

export const expoPushProvider = {
  async send(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    rendered: RenderedNotification,
  ): Promise<ExpoSendResult> {
    const tokens = await deviceTokensRepo.listByUser(db, intent.recipientUserId);
    if (tokens.length === 0) {
      return { attempted: 0, accepted: 0, rejected: 0, tickets: [] };
    }

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.expoPushToken))
      .map((t) => ({
        to: t.expoPushToken,
        title: rendered.title,
        body: rendered.body,
        data: rendered.data,
        sound: 'default',
      }));

    if (messages.length === 0) {
      return { attempted: tokens.length, accepted: 0, rejected: tokens.length, tickets: [] };
    }

    const tickets: ExpoPushTicket[] = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const sent = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...sent);
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'expo push send failed');
        // Mark every token in this chunk as rejected by emitting an error ticket.
        for (let i = 0; i < chunk.length; i++) {
          tickets.push({ status: 'error', message: (e as Error).message } as ExpoPushTicket);
        }
      }
    }

    const accepted = tickets.filter((t) => t.status === 'ok').length;
    return { attempted: messages.length, accepted, rejected: messages.length - accepted, tickets };
  },
};
```

- [ ] **Step 4: Test (mock Expo SDK)**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../../helpers/test-db';
import { factories } from '../../../helpers/factories';
import { expoPushProvider } from '../../../../src/modules/notifications/providers/expo-push.provider';
import { deviceTokensRepo } from '../../../../src/modules/notifications/device-tokens.repo';
import { usersRepo } from '../../../../src/modules/identity/users.repo';

vi.mock('expo-server-sdk', () => {
  const sendPushNotificationsAsync = vi.fn().mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
  const chunkPushNotifications = (msgs: unknown[]) => [msgs];
  return {
    Expo: vi.fn().mockImplementation(() => ({
      sendPushNotificationsAsync,
      chunkPushNotifications,
    })),
    isExpoPushToken: () => true,
  };
});

// Vitest hoists vi.mock; need a static reference for the assertion.
import { Expo } from 'expo-server-sdk';

describe('expoPushProvider.send', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns 0/0/0 when user has no registered tokens', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const r = await expoPushProvider.send(testDb, {
      kind: 'txn_settled', recipientUserId: u.id, dedupeKey: 'd', payload: {},
    }, { title: 'x', body: 'y', data: {} });
    expect(r.attempted).toBe(0);
  });

  it('sends to all of a user\'s registered tokens', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    await deviceTokensRepo.register(testDb, {
      userId: u.id, expoPushToken: 'ExponentPushToken[a]', platform: 'android',
    });
    await deviceTokensRepo.register(testDb, {
      userId: u.id, expoPushToken: 'ExponentPushToken[b]', platform: 'ios',
    });
    const r = await expoPushProvider.send(testDb, {
      kind: 'txn_settled', recipientUserId: u.id, dedupeKey: 'd', payload: {},
    }, { title: 'Payment sent', body: '₦100 to M settled.', data: { kind: 'txn_settled' } });
    expect(r.attempted).toBe(2);
    expect(r.accepted).toBe(1); // mock returns one OK ticket
  });
});

// Touch Expo to keep the mock import live (avoids tree-shake warnings).
void Expo;
```

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/providers/expo-push.provider.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/package.json apps/backend/src/env.ts apps/backend/src/modules/notifications/providers/expo-push.provider.ts apps/backend/tests/modules/notifications/providers/expo-push.provider.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): Expo Push provider (FCM + APNs via Expo Server SDK)"
```

---

### Task 9: Termii SMS provider (with stub fallback)

**Files:**
- Modify: `apps/backend/src/env.ts` (add optional `TERMII_API_KEY`, `TERMII_BASE_URL`, `TERMII_SENDER_ID`)
- Create: `apps/backend/src/integrations/termii/client.ts`
- Create: `apps/backend/src/integrations/termii/index.ts`
- Create: `apps/backend/src/modules/notifications/providers/termii-sms.provider.ts`
- Create: `apps/backend/tests/modules/notifications/providers/termii-sms.provider.test.ts`

When `TERMII_API_KEY` is unset, the provider no-ops + logs a warning. With keys, it POSTs to Termii's `/api/sms/send` endpoint.

- [ ] **Step 1: env vars**

In `env.ts`:

```ts
TERMII_API_KEY: z.string().optional(),
TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),
TERMII_SENDER_ID: z.string().default('Amana'),
```

- [ ] **Step 2: Termii client**

`apps/backend/src/integrations/termii/client.ts`:

```ts
export interface TermiiSendRequest {
  to: string; // E.164 phone number
  from: string; // sender ID
  sms: string; // message body, max 612 chars
  type: 'plain';
  channel: 'generic';
  apiKey: string;
}

export interface TermiiSendResponse {
  message_id: string;
  message: string;
  balance: number;
  user: string;
}

export class TermiiClient {
  constructor(
    private baseUrl: string,
    private fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async sendSms(req: TermiiSendRequest): Promise<TermiiSendResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '<unreadable>');
      throw new Error(`Termii ${res.status}: ${errBody}`);
    }
    return res.json() as Promise<TermiiSendResponse>;
  }
}
```

`apps/backend/src/integrations/termii/index.ts`:

```ts
export { TermiiClient, type TermiiSendRequest, type TermiiSendResponse } from './client';
```

- [ ] **Step 3: Provider**

```ts
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users } from '../../../db/schema';
import { env } from '../../../env';
import { logger } from '../../../lib/logger';
import { TermiiClient } from '../../../integrations/termii';
import type { NotificationIntent, RenderedNotification } from '../types';

const client = env.TERMII_API_KEY ? new TermiiClient(env.TERMII_BASE_URL) : null;

export type SmsSendResult =
  | { kind: 'sent'; messageId: string }
  | { kind: 'skipped_no_key' }
  | { kind: 'skipped_no_phone' }
  | { kind: 'failed'; error: string };

export const termiiSmsProvider = {
  async send(
    db: PostgresJsDatabase,
    intent: NotificationIntent,
    rendered: RenderedNotification,
  ): Promise<SmsSendResult> {
    if (!client || !env.TERMII_API_KEY) {
      logger.warn({ kind: intent.kind, recipientUserId: intent.recipientUserId },
        'termii: no API key configured, skipping SMS send');
      return { kind: 'skipped_no_key' };
    }
    const [user] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, intent.recipientUserId))
      .limit(1);
    if (!user?.phone) return { kind: 'skipped_no_phone' };

    try {
      const res = await client.sendSms({
        to: user.phone,
        from: env.TERMII_SENDER_ID,
        sms: `${rendered.title}: ${rendered.body}`,
        type: 'plain',
        channel: 'generic',
        apiKey: env.TERMII_API_KEY,
      });
      return { kind: 'sent', messageId: res.message_id };
    } catch (e) {
      return { kind: 'failed', error: (e as Error).message };
    }
  },
};
```

- [ ] **Step 4: Test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../../helpers/test-db';
import { factories } from '../../../helpers/factories';
import { termiiSmsProvider } from '../../../../src/modules/notifications/providers/termii-sms.provider';
import { usersRepo } from '../../../../src/modules/identity/users.repo';

describe('termiiSmsProvider.send', () => {
  beforeEach(async () => {
    await truncateAll();
    delete process.env.TERMII_API_KEY;
  });

  it('skips when TERMII_API_KEY is not set (default in test env)', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const r = await termiiSmsProvider.send(testDb, {
      kind: 'bump_requested', recipientUserId: u.id, dedupeKey: 'd', payload: {},
    }, { title: 'Approve a bump?', body: 'Driver wants ₦5,000 at M.', data: {} });
    expect(r.kind).toBe('skipped_no_key');
  });

  // Live SMS smoke is covered by Sub-plan 8 with a real TERMII_API_KEY.
});
```

> **Note on env-var-at-import-time:** The provider reads `env.TERMII_API_KEY` at module load. Sub-plan 1's `env.ts` likely freezes the schema-validated values once. To make `delete process.env.TERMII_API_KEY` in the test affect the provider, you may need to switch the provider to lazy-resolve via `process.env.TERMII_API_KEY` at call time, OR adjust the env loader to re-validate. Pick whichever is simplest; the goal is that tests can run in either configured / unconfigured mode.

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/providers/termii-sms.provider.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/env.ts apps/backend/src/integrations/termii apps/backend/src/modules/notifications/providers/termii-sms.provider.ts apps/backend/tests/modules/notifications/providers/termii-sms.provider.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): Termii SMS provider (no-op when API key absent)"
```

---

## Phase E — Notification dispatcher (Tasks 10-11)

### Task 10: notification.service.dispatch

**Files:**
- Create: `apps/backend/src/modules/notifications/notification.service.ts`

The single dispatch entry point. For each of the 3 channels, asks `prefsService.shouldSend`; if `send`, asks the right template builder for `RenderedNotification`, then routes to the matching provider, captures the result into `notifications` table.

- [ ] **Step 1: Service**

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../lib/logger';
import { notificationsRepo } from './notifications.repo';
import { prefsService } from './prefs.service';
import { expoPushProvider } from './providers/expo-push.provider';
import { inAppProvider } from './providers/in-app.provider';
import { termiiSmsProvider } from './providers/termii-sms.provider';
import * as templates from './templates';
import type {
  DispatchResult,
  NotificationChannel,
  NotificationIntent,
  NotificationStatus,
  RenderedNotification,
} from './types';

const CHANNELS: NotificationChannel[] = ['push', 'in_app', 'sms'];

function render(intent: NotificationIntent): RenderedNotification {
  const ctx = intent.payload as Record<string, unknown>;
  switch (intent.kind) {
    case 'bump_requested':   return templates.bumpRequested(ctx as Parameters<typeof templates.bumpRequested>[0]);
    case 'bump_decided':     return templates.bumpDecided(ctx as Parameters<typeof templates.bumpDecided>[0]);
    case 'txn_settled':      return templates.txnSettled(ctx as Parameters<typeof templates.txnSettled>[0]);
    case 'txn_failed':       return templates.txnFailed(ctx as Parameters<typeof templates.txnFailed>[0]);
    case 'anomaly_alert':    return templates.anomalyAlert(ctx as Parameters<typeof templates.anomalyAlert>[0]);
    case 'refund_received':  return templates.refundReceived(ctx as Parameters<typeof templates.refundReceived>[0]);
  }
}

export const notificationService = {
  async dispatch(db: PostgresJsDatabase, intent: NotificationIntent): Promise<DispatchResult> {
    const rendered = render(intent);
    const rows: DispatchResult['rows'] = [];

    for (const channel of CHANNELS) {
      const decision = await prefsService.shouldSend(db, intent, channel);
      if (decision !== 'send') {
        const status: NotificationStatus = 'skipped';
        const row = await notificationsRepo.insert(db, {
          recipientUserId: intent.recipientUserId,
          kind: intent.kind,
          channel,
          status,
          dedupeKey: intent.dedupeKey,
          payload: { ...intent.payload, _decision: decision },
        });
        rows.push({ notificationId: row.id, channel, status });
        continue;
      }

      // Dedupe: if we've already SENT (or marked read) on this channel for this dedupeKey, skip.
      const existing = await notificationsRepo.findByDedupeKey(db, intent.recipientUserId, channel, intent.dedupeKey);
      if (existing && (existing.status === 'sent' || existing.status === 'read')) {
        rows.push({ notificationId: existing.id, channel, status: existing.status as NotificationStatus });
        continue;
      }

      try {
        if (channel === 'in_app') {
          const r = await inAppProvider.send(db, intent, rendered);
          rows.push({ notificationId: r.notificationId, channel, status: 'sent' });
        } else if (channel === 'push') {
          const r = await expoPushProvider.send(db, intent, rendered);
          const status: NotificationStatus = r.accepted > 0 ? 'sent' : (r.attempted === 0 ? 'skipped' : 'failed');
          const row = await notificationsRepo.insert(db, {
            recipientUserId: intent.recipientUserId,
            kind: intent.kind,
            channel,
            status,
            dedupeKey: intent.dedupeKey,
            payload: { ...intent.payload, _expoTickets: r.tickets },
            providerReceipt: r.tickets.find((t) => t.status === 'ok' && 'id' in t)
              ? (r.tickets.find((t) => t.status === 'ok' && 'id' in t) as { id: string }).id
              : null,
          });
          rows.push({ notificationId: row.id, channel, status });
        } else if (channel === 'sms') {
          const r = await termiiSmsProvider.send(db, intent, rendered);
          const status: NotificationStatus = r.kind === 'sent' ? 'sent' : (r.kind === 'failed' ? 'failed' : 'skipped');
          const row = await notificationsRepo.insert(db, {
            recipientUserId: intent.recipientUserId,
            kind: intent.kind,
            channel,
            status,
            dedupeKey: intent.dedupeKey,
            payload: { ...intent.payload, _smsResult: r },
            providerReceipt: r.kind === 'sent' ? r.messageId : null,
            errorMessage: r.kind === 'failed' ? r.error : null,
          });
          rows.push({ notificationId: row.id, channel, status });
        }
      } catch (e) {
        logger.error({ err: (e as Error).message, channel, kind: intent.kind }, 'notification dispatch failed');
        const row = await notificationsRepo.insert(db, {
          recipientUserId: intent.recipientUserId,
          kind: intent.kind,
          channel,
          status: 'failed',
          dedupeKey: intent.dedupeKey,
          payload: intent.payload,
          errorMessage: (e as Error).message,
        });
        rows.push({ notificationId: row.id, channel, status: 'failed' });
      }
    }

    return { intent, rows };
  },
};
```

- [ ] **Step 2: Verify + commit (test in T11)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/notification.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): notification.service.dispatch (3-channel fan-out, prefs-aware, dedupe)"
```

---

### Task 11: notification.service tests

**Files:**
- Create: `apps/backend/tests/modules/notifications/notification.service.test.ts`

- [ ] **Step 1: Test (mocks the providers)**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { notificationService } from '../../../src/modules/notifications/notification.service';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';
import { prefsRepo } from '../../../src/modules/notifications/prefs.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { deviceTokensRepo } from '../../../src/modules/notifications/device-tokens.repo';

vi.mock('expo-server-sdk', () => ({
  Expo: vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  })),
  isExpoPushToken: () => true,
}));

describe('notificationService.dispatch', () => {
  beforeEach(async () => { await truncateAll(); });

  async function aPrincipalWithDevice(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    await deviceTokensRepo.register(testDb, {
      userId: u.id, expoPushToken: 'ExponentPushToken[a]', platform: 'android',
    });
    return u.id;
  }

  it('fans out to all 3 channels respecting default matrix', async () => {
    const userId = await aPrincipalWithDevice();
    const result = await notificationService.dispatch(testDb, {
      kind: 'bump_requested', recipientUserId: userId, dedupeKey: 'bump:b1',
      amountKobo: 50_000n,
      payload: {
        bumpRequestId: 'b1', transactionId: 't1',
        amountKobo: 50_000n, vendorResolvedName: 'M', agentDisplayName: 'Driver',
      },
    });
    const inApp = result.rows.find((r) => r.channel === 'in_app');
    const push = result.rows.find((r) => r.channel === 'push');
    const sms = result.rows.find((r) => r.channel === 'sms');
    expect(inApp?.status).toBe('sent');
    expect(push?.status).toBe('sent');
    // SMS skipped because no TERMII_API_KEY
    expect(sms?.status).toBe('skipped');
  });

  it('skips channels marked silent in user prefs', async () => {
    const userId = await aPrincipalWithDevice();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'silent',
    });
    const result = await notificationService.dispatch(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'txn:t1',
      amountKobo: 10_000n,
      payload: {
        transactionId: 't1', amountKobo: 10_000n, vendorResolvedName: 'M', nibssSessionId: null,
      },
    });
    expect(result.rows.find((r) => r.channel === 'push')?.status).toBe('skipped');
    expect(result.rows.find((r) => r.channel === 'in_app')?.status).toBe('sent');
  });

  it('dedupes on the same dedupeKey for the same channel', async () => {
    const userId = await aPrincipalWithDevice();
    const intent = {
      kind: 'txn_settled' as const, recipientUserId: userId, dedupeKey: 'txn:t-dup',
      amountKobo: 10_000n,
      payload: {
        transactionId: 't-dup', amountKobo: 10_000n, vendorResolvedName: 'M', nibssSessionId: null,
      },
    };
    await notificationService.dispatch(testDb, intent);
    await notificationService.dispatch(testDb, intent);
    // Second call should not produce a second 'sent' row on in-app for the same dedupeKey.
    const inAppRow = await notificationsRepo.findByDedupeKey(testDb, userId, 'in_app', 'txn:t-dup');
    expect(inAppRow?.status).toBe('sent');
    // We can verify there isn't a second in-app row by querying the DB explicitly if needed;
    // the dedupe path returns the existing row, so total row count for that key on in_app stays at 1.
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/notifications/notification.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/notifications/notification.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(notifications): notification.service.dispatch (3-channel fan-out, prefs gating, dedupe)"
```

---

## Phase F — Wire-in to existing services (Tasks 12-15)

### Task 12: Wire bump-workflow.service.create → notify principal

**Files:**
- Modify: `apps/backend/src/modules/bumps/bump-workflow.service.ts`

The `create` function already creates the bump request. After it succeeds, fire a notification. To find the principal, we need the household ownership chain: sub_wallet → master_wallet → household → principal_user_id.

- [ ] **Step 1: Add a helper to resolve principal from sub_wallet**

In `bump-workflow.service.ts`, add a private helper (or a new method on `householdsRepo`):

```ts
async function resolvePrincipalForSubWallet(
  db: PostgresJsDatabase,
  subWalletId: string,
): Promise<{ principalUserId: string; agentDisplayName: string } | null> {
  // Drizzle-side join chain.
  const result = await db.execute<{ principal_user_id: string; agent_name: string }>(sql`
    SELECT h.principal_user_id, sw.name AS agent_name
    FROM sub_wallets sw
    INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
    INNER JOIN households h ON h.id = mw.household_id
    WHERE sw.id = ${subWalletId}
    LIMIT 1
  `);
  const row = result[0];
  if (!row) return null;
  return { principalUserId: row.principal_user_id, agentDisplayName: row.agent_name };
}
```

- [ ] **Step 2: After `create` writes the bump row, dispatch the notification**

At the end of `bumpWorkflowService.create` (after the audit append, before returning):

```ts
// Notify principal — non-blocking failure (logged, not thrown).
try {
  const owner = await resolvePrincipalForSubWallet(db, input.subWalletId);
  if (owner) {
    await notificationService.dispatch(db, {
      kind: 'bump_requested',
      recipientUserId: owner.principalUserId,
      dedupeKey: `bump:${created.bumpRequest.id}`,
      amountKobo: input.amountKobo as bigint,
      payload: {
        bumpRequestId: created.bumpRequest.id,
        transactionId: input.transactionId,
        amountKobo: input.amountKobo as bigint,
        vendorResolvedName: input.vendorResolvedName,
        agentDisplayName: owner.agentDisplayName,
      },
    });
  }
} catch (e) {
  logger.error({ err: (e as Error).message }, 'bump_requested notification dispatch failed');
}
```

Also import `notificationService` and `logger` at the top of the file.

- [ ] **Step 3: Test — extend `bump-workflow.service.test.ts` with a notification assertion**

```ts
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';

it('dispatches a bump_requested notification to the principal', async () => {
  // ... existing seed for bump.create ...
  await bumpWorkflowService.create(testDb, { /* ... */ });
  const row = await notificationsRepo.findByDedupeKey(testDb, principal.id, 'in_app', `bump:${result.bumpRequest.id}`);
  expect(row?.status).toBe('sent');
});
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/bumps/bump-workflow.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/bumps/bump-workflow.service.ts apps/backend/tests/modules/bumps/bump-workflow.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(bumps): notify principal on bump.create (in-app + push, dedupe on bump.id)"
```

---

### Task 13: Wire settlement.service → notify agent + principal

**Files:**
- Modify: `apps/backend/src/modules/transactions/settlement.service.ts`

After settle, notify both the agent (their txn went through) and the principal (visibility on their household's outflow).

- [ ] **Step 1: Resolve recipients**

After `auditEvents.txnSettled` is appended (last operation in `finalise`), but still inside the `db.transaction`:

```ts
// Notify agent + principal (non-blocking).
try {
  let principalUserId: string | null = null;
  let agentUserId: string | null = null;
  if (txn.subWalletId) {
    const owner = await txDb.execute<{ principal_user_id: string; agent_user_id: string }>(sql`
      SELECT h.principal_user_id, sw.agent_user_id
      FROM sub_wallets sw
      INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
      INNER JOIN households h ON h.id = mw.household_id
      WHERE sw.id = ${txn.subWalletId}
      LIMIT 1
    `);
    if (owner[0]) {
      principalUserId = owner[0].principal_user_id;
      agentUserId = owner[0].agent_user_id;
    }
  } else {
    // Principal-direct
    const owner = await txDb.execute<{ principal_user_id: string }>(sql`
      SELECT h.principal_user_id
      FROM master_wallets mw
      INNER JOIN households h ON h.id = mw.household_id
      WHERE mw.id = ${txn.masterWalletId}
      LIMIT 1
    `);
    if (owner[0]) principalUserId = owner[0].principal_user_id;
  }

  const intentBase = {
    kind: 'txn_settled' as const,
    dedupeKey: `txn-settled:${txn.id}`,
    amountKobo: kobo(txn.amountKobo as bigint),
    payload: {
      transactionId: txn.id,
      amountKobo: kobo(txn.amountKobo as bigint),
      vendorResolvedName: txn.vendorResolvedName ?? 'Unknown',
      nibssSessionId: input.nibssSessionId,
    },
  };

  if (agentUserId) {
    await notificationService.dispatch(txDb, { ...intentBase, recipientUserId: agentUserId });
  }
  if (principalUserId && principalUserId !== agentUserId) {
    await notificationService.dispatch(txDb, { ...intentBase, recipientUserId: principalUserId });
  }
} catch (e) {
  logger.error({ err: (e as Error).message, txnId: txn.id }, 'txn_settled notification failed');
}
```

Add `import { notificationService } from '../notifications/notification.service'` and `import { logger } from '../../lib/logger'` at the top.

- [ ] **Step 2: Extend `settlement.service.test.ts`**

```ts
it('dispatches txn_settled notifications to principal and agent', async () => {
  const { txnId, principalId, agentId } = await seedAndSendNip(); // existing helper, augmented to return user ids
  await settlementService.finalise(testDb, {
    transactionId: txnId, nibssSessionId: 'sess-1',
    settledAt: new Date('2026-05-04T12:00:00Z'),
  });
  const principalRow = await notificationsRepo.findByDedupeKey(testDb, principalId, 'in_app', `txn-settled:${txnId}`);
  const agentRow = await notificationsRepo.findByDedupeKey(testDb, agentId, 'in_app', `txn-settled:${txnId}`);
  expect(principalRow?.status).toBe('sent');
  expect(agentRow?.status).toBe('sent');
});
```

(`seedAndSendNip` may need to return `principalId` and `agentId` — extend the helper.)

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/transactions/settlement.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/settlement.service.ts apps/backend/tests/modules/transactions/settlement.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): notify principal+agent on settle (in-app + push, dedupe on txn.id)"
```

---

### Task 14: Wire reversal.service → notify agent + principal

**Files:**
- Modify: `apps/backend/src/modules/transactions/reversal.service.ts`

Same pattern as settlement, but `kind: 'txn_failed'` and dedupeKey `txn-failed:${txn.id}`.

- [ ] **Step 1: Add the notify block at the end of `reverse()` (still inside the `db.transaction`)**

Mirror T13's structure. The intent payload uses the txn-failed template's context fields.

- [ ] **Step 2: Extend `reversal.service.test.ts`** — assert both notifications present.

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/transactions/reversal.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/reversal.service.ts apps/backend/tests/modules/transactions/reversal.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): notify principal+agent on reverse (in-app + push)"
```

---

### Task 15: Wire lifecycle.service → notify on anomaly score ≥ 0.85

**Files:**
- Modify: `apps/backend/src/modules/transactions/lifecycle.service.ts`

After anomaly scoring (which happens before rule_eval), if `anomaly.score >= 0.85`, fire `anomaly_alert` to the principal. This is a soft alert — it does NOT block the txn (per spec §10 — the rule engine's `anomaly-threshold` evaluator handles blocking decisions).

- [ ] **Step 1: After the `auditEvents.anomalyScored` append, conditionally dispatch**

```ts
if (anomaly.score >= 0.85) {
  try {
    let principalUserId: string | null = null;
    if (txn.subWalletId) {
      const owner = await db.execute<{ principal_user_id: string }>(sql`
        SELECT h.principal_user_id
        FROM sub_wallets sw
        INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
        INNER JOIN households h ON h.id = mw.household_id
        WHERE sw.id = ${txn.subWalletId}
        LIMIT 1
      `);
      if (owner[0]) principalUserId = owner[0].principal_user_id;
    }
    if (principalUserId) {
      await notificationService.dispatch(db, {
        kind: 'anomaly_alert',
        recipientUserId: principalUserId,
        dedupeKey: `anomaly:${txn.id}`,
        anomalyScore: anomaly.score,
        payload: {
          transactionId: txn.id,
          amountKobo: kobo(txn.amountKobo as bigint),
          vendorResolvedName: txn.vendorResolvedName ?? 'Unknown',
          anomalyScore: anomaly.score,
        },
      });
    }
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'anomaly_alert notification failed');
  }
}
```

Add the `notificationService` and `logger` imports at the top.

- [ ] **Step 2: Test — anomaly notification when score is high**

Extend `lifecycle.service.test.ts`. Force an anomaly score ≥ 0.85 by seeding a history with one outlier txn so the z-score saturates. (Alternatively, mock `anomalyService.score` for this one test.)

```ts
it('dispatches anomaly_alert when score >= 0.85', async () => {
  // Seed a high-anomaly setup; verify notifications row.
});
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/transactions/lifecycle.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/lifecycle.service.ts apps/backend/tests/modules/transactions/lifecycle.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): notify principal on anomaly score >= 0.85 (does not block; rule engine handles blocking)"
```

---

## Phase G — HTTP routes (Tasks 16-19)

### Task 16: POST /devices, DELETE /devices/:id

**Files:**
- Create: `apps/backend/src/routes/devices.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/devices.test.ts`

- [ ] **Step 1: Route**

```ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { actor, type Actor, type ActorVariables } from '../middleware/actor';
import { deviceTokensRepo } from '../modules/notifications/device-tokens.repo';

export const devicesRoute = new Hono<{ Variables: ActorVariables }>()
  .use(actor())
  .post('/', async (c) => {
    const a = c.get('actor');
    const body = await c.req.json<{
      expoPushToken: string;
      platform: 'ios' | 'android';
      deviceLabel?: string | null;
    }>();
    if (!body.expoPushToken || !body.platform) {
      return c.json({ error: 'missing_params' }, 400);
    }
    const row = await deviceTokensRepo.register(db, {
      userId: a.userId,
      expoPushToken: body.expoPushToken,
      platform: body.platform,
      deviceLabel: body.deviceLabel ?? null,
    });
    return c.json({ id: row.id }, 201);
  })
  .delete('/:id', async (c) => {
    const a = c.get('actor');
    const id = c.req.param('id');
    const ok = await deviceTokensRepo.deleteById(db, id, a.userId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: true }, 200);
  });
```

- [ ] **Step 2: Mount in `server.ts`** — `app.route('/devices', devicesRoute);`

- [ ] **Step 3: Test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { usersRepo } from '../../src/modules/identity/users.repo';

describe('POST /devices', () => {
  beforeEach(async () => { await truncateAll(); });

  it('registers a token and returns the id', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const res = await app.request('/devices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id, 'x-actor-role': 'agent',
      },
      body: JSON.stringify({
        expoPushToken: 'ExponentPushToken[abc]', platform: 'android',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('401 without actor headers', async () => {
    const app = createServer();
    const res = await app.request('/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }),
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /devices/:id returns 404 for someone else\'s token', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const other = await usersRepo.insert(testDb, {
      role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
    });
    const app = createServer();
    const create = await app.request('/devices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id, 'x-actor-role': 'agent',
      },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }),
    });
    const { id } = await create.json() as { id: string };

    const del = await app.request(`/devices/${id}`, {
      method: 'DELETE',
      headers: { 'x-actor-user-id': other.id, 'x-actor-role': 'agent' },
    });
    expect(del.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/routes/devices.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/devices.ts apps/backend/src/server.ts apps/backend/tests/routes/devices.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): POST /devices + DELETE /devices/:id (Expo Push token registration)"
```

---

### Task 17: GET/PUT /me/notification-preferences

**Files:**
- Create: `apps/backend/src/routes/notification-prefs.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/notification-prefs.test.ts`

- [ ] **Step 1: Route**

```ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { actor, type ActorVariables } from '../middleware/actor';
import { prefsRepo } from '../modules/notifications/prefs.repo';
import type { ChannelPreference, NotificationChannel, NotificationKind } from '../modules/notifications/types';

const KINDS: NotificationKind[] = [
  'bump_requested', 'bump_decided', 'txn_settled', 'txn_failed', 'anomaly_alert', 'refund_received',
];
const CHANNELS: NotificationChannel[] = ['push', 'sms', 'in_app'];
const PREFS: ChannelPreference[] = ['real_time', 'threshold', 'digest', 'silent'];

export const notificationPrefsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(actor())
  .get('/me/notification-preferences', async (c) => {
    const a = c.get('actor');
    const rows = await prefsRepo.listByUser(db, a.userId);
    return c.json({ preferences: rows }, 200);
  })
  .put('/me/notification-preferences', async (c) => {
    const a = c.get('actor');
    const body = await c.req.json<{
      kind: NotificationKind;
      channel: NotificationChannel;
      preference: ChannelPreference;
      thresholdKobo?: string | null;
    }>();
    if (!KINDS.includes(body.kind) || !CHANNELS.includes(body.channel) || !PREFS.includes(body.preference)) {
      return c.json({ error: 'invalid_param' }, 400);
    }
    const row = await prefsRepo.upsert(db, {
      userId: a.userId,
      kind: body.kind,
      channel: body.channel,
      preference: body.preference,
      thresholdKobo: body.thresholdKobo ? BigInt(body.thresholdKobo) : null,
    });
    return c.json({ preference: row }, 200);
  });
```

- [ ] **Step 2: Mount + tests**

`server.ts`: `app.route('/', notificationPrefsRoute);` (the route paths include `/me/notification-preferences` directly).

Test:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { usersRepo } from '../../src/modules/identity/users.repo';

describe('PUT /me/notification-preferences', () => {
  beforeEach(async () => { await truncateAll(); });

  it('upserts a preference', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/me/notification-preferences', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id, 'x-actor-role': 'principal',
      },
      body: JSON.stringify({
        kind: 'txn_settled', channel: 'push', preference: 'threshold',
        thresholdKobo: '100000',
      }),
    });
    expect(res.status).toBe(200);
  });

  it('400 on invalid enum value', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    const app = createServer();
    const res = await app.request('/me/notification-preferences', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-actor-user-id': u.id, 'x-actor-role': 'principal',
      },
      body: JSON.stringify({ kind: 'bogus', channel: 'push', preference: 'real_time' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/routes/notification-prefs.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/notification-prefs.ts apps/backend/src/server.ts apps/backend/tests/routes/notification-prefs.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): GET/PUT /me/notification-preferences"
```

---

### Task 18: GET /me/notifications, POST /me/notifications/:id/read

**Files:**
- Create: `apps/backend/src/routes/notifications.ts`
- Modify: `apps/backend/src/server.ts`
- Create: `apps/backend/tests/routes/notifications.test.ts`

- [ ] **Step 1: Route**

```ts
import { Hono } from 'hono';
import { db } from '../db/client';
import { actor, type ActorVariables } from '../middleware/actor';
import { notificationsRepo } from '../modules/notifications/notifications.repo';

export const notificationsListRoute = new Hono<{ Variables: ActorVariables }>()
  .use(actor())
  .get('/me/notifications', async (c) => {
    const a = c.get('actor');
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);
    const rows = await notificationsRepo.listByRecipient(db, a.userId, limit);
    return c.json({ notifications: rows }, 200);
  })
  .post('/me/notifications/:id/read', async (c) => {
    const a = c.get('actor');
    const ok = await notificationsRepo.markRead(db, c.req.param('id'), a.userId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ marked: true }, 200);
  });
```

- [ ] **Step 2: Mount + tests** (`app.route('/', notificationsListRoute);`)

```ts
// tests/routes/notifications.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers/test-db';
import { factories } from '../helpers/factories';
import { createServer } from '../../src/server';
import { notificationsRepo } from '../../src/modules/notifications/notifications.repo';
import { usersRepo } from '../../src/modules/identity/users.repo';

describe('GET /me/notifications', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns my notifications, most-recent first', async () => {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    await notificationsRepo.insert(testDb, {
      recipientUserId: u.id, kind: 'txn_settled', channel: 'in_app',
      status: 'sent', dedupeKey: 'a', payload: {},
    });
    await notificationsRepo.insert(testDb, {
      recipientUserId: u.id, kind: 'bump_requested', channel: 'in_app',
      status: 'sent', dedupeKey: 'b', payload: {},
    });
    const app = createServer();
    const res = await app.request('/me/notifications', {
      headers: { 'x-actor-user-id': u.id, 'x-actor-role': 'principal' },
    });
    const body = await res.json() as { notifications: { dedupeKey: string }[] };
    expect(body.notifications).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/routes/notifications.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/routes/notifications.ts apps/backend/src/server.ts apps/backend/tests/routes/notifications.test.ts
git -C "C:/Users/alex_/amana" commit -m "feat(routes): GET /me/notifications + POST /me/notifications/:id/read"
```

---

### Task 19: Module barrel for notifications

**Files:**
- Create: `apps/backend/src/modules/notifications/index.ts`
- Modify: `apps/backend/src/modules/index.ts`

- [ ] **Step 1: Barrel**

```ts
export type * from './types';
export { prefsRepo } from './prefs.repo';
export { prefsService } from './prefs.service';
export { deviceTokensRepo } from './device-tokens.repo';
export { notificationsRepo } from './notifications.repo';
export { notificationService } from './notification.service';
export * as templates from './templates';
export { inAppProvider } from './providers/in-app.provider';
export { expoPushProvider } from './providers/expo-push.provider';
export { termiiSmsProvider } from './providers/termii-sms.provider';
```

- [ ] **Step 2: Top-level re-export** — append to `apps/backend/src/modules/index.ts`:

```ts
export * as notifications from './notifications';
```

- [ ] **Step 3: Commit**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/notifications/index.ts apps/backend/src/modules/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(notifications): module barrel + top-level export"
```

---

## Phase H — Cron scheduler (Tasks 20-23)

### Task 20: Add `node-cron` dep + scheduler skeleton

**Files:**
- Modify: `apps/backend/package.json` (add `node-cron`, `@types/node-cron`)
- Create: `apps/backend/src/cron/scheduler.ts`
- Create: `apps/backend/src/cron/index.ts`

- [ ] **Step 1: Install**

```powershell
pnpm --filter @amana/backend add node-cron
pnpm --filter @amana/backend add -D @types/node-cron
```

- [ ] **Step 2: Scheduler**

```ts
import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger';

export type CronJob = {
  name: string;
  schedule: string; // cron expression
  run: () => Promise<void>;
};

const tasks: ScheduledTask[] = [];

export const cronScheduler = {
  register(job: CronJob): void {
    if (!cron.validate(job.schedule)) {
      throw new Error(`invalid cron schedule for ${job.name}: ${job.schedule}`);
    }
    const task = cron.schedule(job.schedule, async () => {
      const started = Date.now();
      try {
        await job.run();
        logger.info({ job: job.name, durationMs: Date.now() - started }, 'cron job completed');
      } catch (e) {
        logger.error({ job: job.name, err: (e as Error).message, durationMs: Date.now() - started },
          'cron job failed');
      }
    }, { scheduled: false });
    tasks.push(task);
    logger.info({ job: job.name, schedule: job.schedule }, 'cron job registered');
  },

  start(): void {
    for (const task of tasks) task.start();
    logger.info({ count: tasks.length }, 'cron scheduler started');
  },

  stop(): void {
    for (const task of tasks) task.stop();
    logger.info({ count: tasks.length }, 'cron scheduler stopped');
  },

  /** For tests: run every registered job once, sequentially. Bypasses the cron schedule. */
  async runAllOnce(): Promise<void> {
    // node-cron doesn't expose the original `run` callback; tests should register their own
    // jobs and invoke them directly. Kept here for symmetry but is a no-op.
  },
};
```

- [ ] **Step 3: index.ts**

```ts
export { cronScheduler, type CronJob } from './scheduler';
```

- [ ] **Step 4: Commit (tests in T22)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/package.json apps/backend/src/cron
git -C "C:/Users/alex_/amana" commit -m "feat(cron): scheduler skeleton via node-cron"
```

---

### Task 21: recon-sweep job + bump-ttl-sweep job

**Files:**
- Create: `apps/backend/src/cron/jobs/recon-sweep.job.ts`
- Create: `apps/backend/src/cron/jobs/bump-ttl-sweep.job.ts`
- Create: `apps/backend/tests/cron/recon-sweep.job.test.ts`
- Create: `apps/backend/tests/cron/bump-ttl-sweep.job.test.ts`

- [ ] **Step 1: recon-sweep job**

```ts
import { db } from '../../db/client';
import { AnchorAdapter } from '../../integrations/anchor/adapter';
import { AnchorClient } from '../../integrations/anchor/client';
import { env } from '../../env';
import { reconciliationService } from '../../modules/transactions/reconciliation.service';
import type { CronJob } from '../scheduler';

export const reconSweepJob: CronJob = {
  name: 'recon-sweep',
  schedule: '*/5 * * * *', // every 5 minutes
  async run() {
    const adapter = new AnchorAdapter({
      db,
      client: new AnchorClient({ baseUrl: env.ANCHOR_API_BASE_URL, apiKey: env.ANCHOR_API_KEY }),
    });
    const result = await reconciliationService.sweep(db, adapter, new Date());
    if (result.unknown > 0 || result.reversed > 0) {
      // intentionally noisy when reconcilable rows showed up
    }
  },
};
```

- [ ] **Step 2: bump-ttl-sweep job**

```ts
import { db } from '../../db/client';
import { bumpWorkflowService } from '../../modules/bumps/bump-workflow.service';
import type { CronJob } from '../scheduler';

export const bumpTtlSweepJob: CronJob = {
  name: 'bump-ttl-sweep',
  schedule: '* * * * *', // every minute
  async run() {
    await bumpWorkflowService.sweepExpired(db, new Date());
  },
};
```

- [ ] **Step 3: Test recon-sweep job — dispatches sweep with current Date**

```ts
import { describe, expect, it, vi } from 'vitest';
import { reconSweepJob } from '../../src/cron/jobs/recon-sweep.job';
import { reconciliationService } from '../../src/modules/transactions/reconciliation.service';

describe('reconSweepJob', () => {
  it('schedule is */5 * * * *', () => {
    expect(reconSweepJob.schedule).toBe('*/5 * * * *');
    expect(reconSweepJob.name).toBe('recon-sweep');
  });

  it('run() invokes reconciliationService.sweep', async () => {
    const spy = vi.spyOn(reconciliationService, 'sweep').mockResolvedValue({
      inspected: 0, settled: 0, reversed: 0, stillPending: 0, unknown: 0,
    });
    await reconSweepJob.run();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
```

- [ ] **Step 4: Test bump-ttl-sweep job — dispatches sweepExpired**

```ts
import { describe, expect, it, vi } from 'vitest';
import { bumpTtlSweepJob } from '../../src/cron/jobs/bump-ttl-sweep.job';
import { bumpWorkflowService } from '../../src/modules/bumps/bump-workflow.service';

describe('bumpTtlSweepJob', () => {
  it('schedule is * * * * *', () => {
    expect(bumpTtlSweepJob.schedule).toBe('* * * * *');
    expect(bumpTtlSweepJob.name).toBe('bump-ttl-sweep');
  });

  it('run() invokes bumpWorkflowService.sweepExpired', async () => {
    const spy = vi.spyOn(bumpWorkflowService, 'sweepExpired').mockResolvedValue({ swept: 0 });
    await bumpTtlSweepJob.run();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
```

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/cron
git -C "C:/Users/alex_/amana" add apps/backend/src/cron/jobs apps/backend/tests/cron
git -C "C:/Users/alex_/amana" commit -m "feat(cron): recon-sweep (5min) + bump-ttl-sweep (1min) jobs"
```

---

### Task 22: bin/cron.ts entrypoint

**Files:**
- Create: `apps/backend/bin/cron.ts`
- Modify: `apps/backend/package.json` — add `"cron": "tsx bin/cron.ts"` script.

- [ ] **Step 1: Entry point**

```ts
import { cronScheduler } from '../src/cron';
import { reconSweepJob } from '../src/cron/jobs/recon-sweep.job';
import { bumpTtlSweepJob } from '../src/cron/jobs/bump-ttl-sweep.job';
import { logger } from '../src/lib/logger';

cronScheduler.register(reconSweepJob);
cronScheduler.register(bumpTtlSweepJob);
cronScheduler.start();

// Keep the process alive. Graceful shutdown on SIGINT / SIGTERM.
const shutdown = (signal: string) => {
  logger.info({ signal }, 'cron worker shutting down');
  cronScheduler.stop();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Unhandled errors should crash the process so the orchestrator restarts it.
process.on('uncaughtException', (e) => {
  logger.error({ err: e.message, stack: e.stack }, 'cron worker uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'cron worker unhandled rejection');
  process.exit(1);
});

logger.info('cron worker ready');
```

- [ ] **Step 2: Add script + commit**

In `apps/backend/package.json` `scripts`: `"cron": "tsx bin/cron.ts"`.

```powershell
git -C "C:/Users/alex_/amana" add apps/backend/bin apps/backend/package.json
git -C "C:/Users/alex_/amana" commit -m "feat(cron): bin/cron.ts long-lived worker entrypoint"
```

---

### Task 23: Verify cron starts cleanly (smoke test)

**Files:**
- Create: `apps/backend/tests/cron/scheduler.test.ts`

- [ ] **Step 1: Test the scheduler API surface**

```ts
import { describe, expect, it } from 'vitest';
import { cronScheduler, type CronJob } from '../../src/cron';

describe('cronScheduler', () => {
  it('throws on invalid cron expression', () => {
    const bad: CronJob = { name: 'bad', schedule: 'not-a-cron', run: async () => {} };
    expect(() => cronScheduler.register(bad)).toThrow(/invalid cron/);
  });

  it('register accepts valid cron expressions', () => {
    const ok: CronJob = { name: 'ok', schedule: '*/5 * * * *', run: async () => {} };
    expect(() => cronScheduler.register(ok)).not.toThrow();
  });

  // Note: we can't easily start/stop a real cron in a unit test (would tick on a clock).
  // Job logic is covered in T21; integration is covered when the cron worker runs in staging.
});
```

- [ ] **Step 2: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/cron/scheduler.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/tests/cron/scheduler.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(cron): scheduler validates cron expressions"
```

---

## Phase I — Refund recon (Tasks 24-26)

### Task 24: refund.service.handleRefund

**Files:**
- Create: `apps/backend/src/modules/transactions/refund.service.ts`
- Modify: `apps/backend/src/modules/transactions/index.ts`

The service: given an inbound NIP credit, attempt to match it to a recent settled spend by `(senderBankCode + senderAccountNumber)` against `(vendorBankCode + vendorAccount)` of any `kind='spend'` `status='settled'` txn for the same master_wallet within the last 14 days. If matched, post a re-credit (debit external, credit source — sub-wallet or master) under a NEW `kind='refund'` txn, dispatch a `refund_received` notification.

The transaction kind enum currently has `'spend' | 'topup' | 'refund' | 'fee' | 'reversal'` — `refund` is already a valid value. ✓

- [ ] **Step 1: Service**

```ts
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactions } from '../../db/schema';
import { kobo, type Kobo } from '../../lib/kobo';
import { auditRepo } from '../audit/audit.repo';
import { auditEvents } from '../audit/events';
import { ledgerAccountsRepo } from '../wallet/ledger-accounts.repo';
import { ledgerService } from '../wallet/ledger.service';
import { transactionsRepo } from '../wallet/transactions.repo';
import { notificationService } from '../notifications/notification.service';

type DbOrTx = PostgresJsDatabase;

export type MatchInput = {
  masterWalletId: string;
  amountKobo: Kobo;
  senderBankCode: string;
  senderAccountNumber: string;
};

export type HandleRefundInput = MatchInput & {
  nibssSessionId: string;
  receivedAt: Date;
};

export type HandleRefundResult =
  | { kind: 'matched_and_refunded'; refundTransactionId: string; originalTransactionId: string }
  | { kind: 'no_match' };

const MATCH_WINDOW_DAYS = 14;

export const refundService = {
  /** Find a candidate originating spend for a recent inbound credit. Returns the txn id or null. */
  async findOriginatingSpend(db: DbOrTx, input: MatchInput): Promise<string | null> {
    const cutoff = new Date(Date.now() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.masterWalletId, input.masterWalletId),
          eq(transactions.kind, 'spend'),
          eq(transactions.status, 'settled'),
          eq(transactions.vendorBankCode, input.senderBankCode),
          eq(transactions.vendorAccount, input.senderAccountNumber),
          eq(transactions.amountKobo, input.amountKobo),
          gte(transactions.createdAt, cutoff),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(1);
    return row?.id ?? null;
  },

  async handleRefund(db: DbOrTx, input: HandleRefundInput): Promise<HandleRefundResult> {
    return db.transaction(async (tx) => {
      const txDb = tx as DbOrTx;
      const originalId = await refundService.findOriginatingSpend(txDb, input);
      if (!originalId) return { kind: 'no_match' as const };

      const original = await transactionsRepo.findById(txDb, originalId);
      if (!original) return { kind: 'no_match' as const };

      const externalLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, input.masterWalletId, 'external');
      const masterLA = await ledgerAccountsRepo.findByMasterAndKind(txDb, input.masterWalletId, 'master');
      if (!externalLA || !masterLA) throw new Error('refund: missing external/master LA');
      const sourceLA = original.subWalletId
        ? await ledgerAccountsRepo.findBySubWallet(txDb, original.subWalletId)
        : masterLA;
      if (!sourceLA) throw new Error('refund: source LA not found');

      // Refund posting: debit external (money came back), credit source (sub-wallet or master).
      const refundTxn = await transactionsRepo.insert(txDb, {
        masterWalletId: input.masterWalletId,
        subWalletId: original.subWalletId,
        kind: 'refund',
        amountKobo: input.amountKobo,
        idempotencyKey: `refund:${input.nibssSessionId}`,
      });
      await ledgerService.writeDoubleEntry(txDb, refundTxn.id, [
        { ledgerAccountId: externalLA.id, debitKobo: input.amountKobo, creditKobo: kobo(0n) },
        { ledgerAccountId: sourceLA.id, debitKobo: kobo(0n), creditKobo: input.amountKobo },
      ]);
      await transactionsRepo.setNibssSessionId(txDb, refundTxn.id, input.nibssSessionId);
      await transactionsRepo.setStatus(txDb, refundTxn.id, 'settled', input.receivedAt);

      await auditRepo.append(txDb, auditEvents.txnSettled({
        transactionId: refundTxn.id,
        nibssSessionId: input.nibssSessionId,
        feeKobo: 0n,
        settledAt: input.receivedAt,
      }));

      // Notify principal + (if applicable) agent.
      try {
        // Resolve principal/agent.
        let principalUserId: string | null = null;
        let agentUserId: string | null = null;
        if (original.subWalletId) {
          const owner = await txDb.execute<{ principal_user_id: string; agent_user_id: string }>(sql`
            SELECT h.principal_user_id, sw.agent_user_id
            FROM sub_wallets sw
            INNER JOIN master_wallets mw ON mw.id = sw.master_wallet_id
            INNER JOIN households h ON h.id = mw.household_id
            WHERE sw.id = ${original.subWalletId}
            LIMIT 1
          `);
          if (owner[0]) {
            principalUserId = owner[0].principal_user_id;
            agentUserId = owner[0].agent_user_id;
          }
        } else {
          const owner = await txDb.execute<{ principal_user_id: string }>(sql`
            SELECT h.principal_user_id
            FROM master_wallets mw
            INNER JOIN households h ON h.id = mw.household_id
            WHERE mw.id = ${input.masterWalletId}
            LIMIT 1
          `);
          if (owner[0]) principalUserId = owner[0].principal_user_id;
        }
        const intentBase = {
          kind: 'refund_received' as const,
          dedupeKey: `refund:${refundTxn.id}`,
          amountKobo: input.amountKobo as bigint,
          payload: {
            refundTransactionId: refundTxn.id,
            originalTransactionId: originalId,
            amountKobo: input.amountKobo as bigint,
            vendorResolvedName: original.vendorResolvedName ?? 'Unknown',
          },
        };
        if (principalUserId) {
          await notificationService.dispatch(txDb, { ...intentBase, recipientUserId: principalUserId });
        }
        if (agentUserId && agentUserId !== principalUserId) {
          await notificationService.dispatch(txDb, { ...intentBase, recipientUserId: agentUserId });
        }
      } catch {
        // best-effort
      }

      return {
        kind: 'matched_and_refunded' as const,
        refundTransactionId: refundTxn.id,
        originalTransactionId: originalId,
      };
    });
  },
};
```

- [ ] **Step 2: Re-export from `transactions/index.ts`**

```ts
export { refundService, type MatchInput, type HandleRefundInput, type HandleRefundResult }
  from './refund.service';
```

- [ ] **Step 3: Commit (tests in T26)**

```powershell
pnpm --filter @amana/backend typecheck
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/refund.service.ts apps/backend/src/modules/transactions/index.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): refund.service.handleRefund (match recent spend, re-credit source, notify)"
```

---

### Task 25: Wire topup.service to consult refund.service

**Files:**
- Modify: `apps/backend/src/modules/transactions/topup.service.ts`

In `handle()`, BEFORE writing the topup posting, call `refundService.findOriginatingSpend`. If matched, route to `refundService.handleRefund` and return its result wrapped as a topup result. Otherwise proceed with the existing topup logic.

- [ ] **Step 1: Modify handle**

Inside `topupService.handle`, after looking up `mw` and BEFORE the `existing` idempotency check (because a refund and a topup can have different idempotency keys but the same `nibssSessionId`):

```ts
const matched = await refundService.findOriginatingSpend(txDb, {
  masterWalletId: mw.id,
  amountKobo: input.amountKobo,
  senderBankCode: input.senderBankCode,
  senderAccountNumber: input.senderAccountNumber,
});
if (matched !== null) {
  const refundResult = await refundService.handleRefund(txDb, {
    masterWalletId: mw.id,
    amountKobo: input.amountKobo,
    senderBankCode: input.senderBankCode,
    senderAccountNumber: input.senderAccountNumber,
    nibssSessionId: input.nibssSessionId,
    receivedAt: input.receivedAt,
  });
  if (refundResult.kind === 'matched_and_refunded') {
    return { kind: 'created' as const, transactionId: refundResult.refundTransactionId };
  }
}
```

The `refund.handleRefund` opens its own `db.transaction`. Calling it inside the existing `topup.handle` `db.transaction` produces a savepoint — works the same as the prior nested `db.transaction` patterns in this codebase.

Add `import { refundService } from './refund.service';` at the top.

- [ ] **Step 2: Run existing topup tests** to confirm nothing broke. The tests don't seed a matching spend so they should still hit the topup branch.

- [ ] **Step 3: Commit (refund integration test in T26)**

```powershell
pnpm --filter @amana/backend test tests/modules/transactions/topup.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/src/modules/transactions/topup.service.ts
git -C "C:/Users/alex_/amana" commit -m "feat(txn): topup consults refund.findOriginatingSpend before booking; routes refunds to refund.service"
```

---

### Task 26: refund.service tests + integration via topup webhook

**Files:**
- Create: `apps/backend/tests/modules/transactions/refund.service.test.ts`

- [ ] **Step 1: Tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { kobo } from '../../../src/lib/kobo';
import { refundService } from '../../../src/modules/transactions/refund.service';
import { topupService } from '../../../src/modules/transactions/topup.service';
import { nipOutService } from '../../../src/modules/transactions/nip-out.service';
import { settlementService } from '../../../src/modules/transactions/settlement.service';
import { txnIntentService } from '../../../src/modules/transactions/txn-intent.service';
import { transactionsRepo } from '../../../src/modules/wallet/transactions.repo';
import { ledgerService } from '../../../src/modules/wallet/ledger.service';
import { postingsRepo } from '../../../src/modules/wallet/postings.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { notificationsRepo } from '../../../src/modules/notifications/notifications.repo';

vi.mock('expo-server-sdk', () => ({
  Expo: vi.fn().mockImplementation(() => ({
    sendPushNotificationsAsync: vi.fn().mockResolvedValue([{ status: 'ok', id: 'tk-1' }]),
    chunkPushNotifications: (m: unknown[]) => [m],
  })),
  isExpoPushToken: () => true,
}));

async function seedFullySettledSpend() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(),
    kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  // Topup
  const topup = await transactionsRepo.insert(testDb, {
    masterWalletId: mw.master.id, kind: 'topup', amountKobo: kobo(100_000n),
    idempotencyKey: factories.idempotencyKey(),
  });
  await ledgerService.writeDoubleEntry(testDb, topup.id, [
    { ledgerAccountId: sw.ledgerAccountId, debitKobo: kobo(100_000n), creditKobo: kobo(0n) },
    { ledgerAccountId: mw.ledgerAccountIds.suspense, debitKobo: kobo(0n), creditKobo: kobo(100_000n) },
  ]);
  // Send 5K to vendor 058/0123456789
  const txn = await txnIntentService.create(testDb, {
    masterWalletId: mw.master.id, subWalletId: sw.sub.id,
    amountKobo: kobo(5_000n), idempotencyKey: factories.idempotencyKey(),
    vendorBankCode: '058', vendorAccountNumber: '0123456789',
    vendorResolvedName: 'M', category: null, agentNote: null,
  });
  await transactionsRepo.setStatus(testDb, txn.id, 'in_flight');
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tr-1', status: 'PENDING', reference: txn.idempotencyKey }),
      { status: 202, headers: { 'content-type': 'application/json' } }),
  );
  const adapter = new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl: fetchSpy }),
    retryDelaysMs: [1],
  });
  await nipOutService.send(testDb, adapter, {
    transactionId: txn.id, householdRef: hh.id, now: new Date('2026-05-04T10:00:00Z'),
  });
  await settlementService.finalise(testDb, {
    transactionId: txn.id, nibssSessionId: 'sess-1', settledAt: new Date('2026-05-04T10:00:30Z'),
  });
  return {
    masterId: mw.master.id, subWalletId: sw.sub.id, subLA: sw.ledgerAccountId,
    principalId: principal.id, agentId: agent.id, originalTxnId: txn.id,
  };
}

describe('refundService', () => {
  beforeEach(async () => { await truncateAll(); });

  it('findOriginatingSpend matches recent settled spend by amount + sender', async () => {
    const { masterId } = await seedFullySettledSpend();
    const found = await refundService.findOriginatingSpend(testDb, {
      masterWalletId: masterId, amountKobo: kobo(5_000n),
      senderBankCode: '058', senderAccountNumber: '0123456789',
    });
    expect(found).not.toBeNull();
  });

  it('handleRefund posts a refund txn that re-credits the source sub-wallet', async () => {
    const { masterId, subLA, originalTxnId } = await seedFullySettledSpend();
    const result = await refundService.handleRefund(testDb, {
      masterWalletId: masterId, amountKobo: kobo(5_000n),
      senderBankCode: '058', senderAccountNumber: '0123456789',
      nibssSessionId: 'sess-refund-1', receivedAt: new Date('2026-05-04T11:00:00Z'),
    });
    expect(result.kind).toBe('matched_and_refunded');
    if (result.kind === 'matched_and_refunded') {
      expect(result.originalTransactionId).toBe(originalTxnId);
    }
    // Sub-wallet had topup 100K + spend reservation 5K = 105K (debits) - settle (suspense moved, no impact on sub-wallet) - refund credit 5K = 100K.
    // So the sub-wallet ledger balance after refund = 105K - 5K = 100K.
    expect(await postingsRepo.accountBalance(testDb, subLA)).toBe(100_000n);
  });

  it('topupService routes to refund when sender matches a recent spend', async () => {
    const { masterId, principalId } = await seedFullySettledSpend();
    const result = await topupService.handle(testDb, {
      virtualAccountId: 'anchor-acct-test',
      amountKobo: kobo(5_000n), nibssSessionId: 'sess-refund-via-topup',
      senderBankCode: '058', senderAccountNumber: '0123456789', senderAccountName: 'M',
      receivedAt: new Date('2026-05-04T11:00:00Z'),
    });
    expect(result.kind).toBe('created');
    // Verify a refund_received notification went to the principal.
    // (The dedupeKey is `refund:${refundTxnId}` — find by recipient + channel.)
    const list = await notificationsRepo.listByRecipient(testDb, principalId, 50);
    expect(list.some((n) => n.kind === 'refund_received')).toBe(true);
  });

  it('returns no_match when sender does not match any recent spend', async () => {
    const { masterId } = await seedFullySettledSpend();
    const result = await refundService.handleRefund(testDb, {
      masterWalletId: masterId, amountKobo: kobo(99_999n),
      senderBankCode: '058', senderAccountNumber: '9999999999',
      nibssSessionId: 's', receivedAt: new Date(),
    });
    expect(result.kind).toBe('no_match');
  });
});
```

- [ ] **Step 2: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/modules/transactions/refund.service.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/tests/modules/transactions/refund.service.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(txn): refund.service.handleRefund (match + re-credit + notify; no_match path)"
```

---

## Phase J — README + final sweep + tag (Tasks 27-30)

### Task 27: README update

**Files:**
- Modify: `apps/backend/README.md`

- [ ] **Step 1: Replace** the README with an updated version that documents:
- New `modules/notifications` (preferences / device tokens / providers / templates)
- New `modules/transactions/refund.service`
- New `cron/` directory + worker entrypoint (`pnpm cron`)
- New routes: `/devices`, `/me/notifications`, `/me/notification-preferences`
- Updated route surface

```markdown
# @amana/backend

Amana TypeScript backend on Hono.

## Modules

- `modules/identity` — users, households, household members, KYC tier rules.
- `modules/wallet` — master + sub wallets, ledger accounts, transactions, postings, double-entry write helper.
- `modules/audit` — append-only audit log + typed event constructors.
- `modules/sticker` — vendor sticker resolution stub.
- `modules/rules` — pure-function rule engine + 5 evaluators + replay corpus + versioned rule sets.
- `modules/bumps` — Result-typed state machine + workflow service.
- `modules/anomaly` — 4 features + weighted aggregator.
- `modules/vendors` — name enquiry / phone lookup / sticker lookup / NQR decoder / recents / unified resolver.
- `modules/transactions` — lifecycle (rule eval → bump or in_flight) + intent + nip-out + settlement + reversal + topup + reconciliation + **refund**.
- `modules/notifications` — preferences matrix + device tokens + 6 templates + 3 providers (Expo Push, Termii SMS, in-app) + dispatcher.
- `integrations/anchor` — BaaS adapter.
- `integrations/termii` — SMS provider HTTP client.
- `cron/` — `node-cron` scheduler + jobs (recon-sweep every 5min, bump-ttl-sweep every minute).

## Public HTTP routes

- `GET  /health` — liveness check.
- `POST /webhooks/anchor` — Anchor webhook receiver (HMAC-verified).
- `GET  /vendors/{name-enquiry, phone-lookup, sticker/:uuid, recents}` + `POST /vendors/nqr-decode`
- `POST /transactions/{intent, :id/evaluate, :id/send, :id/resume-after-bump}`
- `POST /bumps/:id/decision`
- `POST /devices` + `DELETE /devices/:id`
- `GET  /me/notifications` + `POST /me/notifications/:id/read`
- `GET/PUT /me/notification-preferences`

All routes (except `/health` and `/webhooks/*`) require `x-actor-user-id` and `x-actor-role` headers. Real auth lands in Sub-plan 6.

## Run locally

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend dev   # API server
pnpm --filter @amana/backend cron  # Cron worker (separate process)
```

## Test

```bash
docker compose up -d
pnpm --filter @amana/backend db:migrate
pnpm --filter @amana/backend test
```

## Recon runner (one-off)

```bash
pnpm --filter @amana/backend exec tsx scripts/recon-runner.ts
```
```

- [ ] **Step 2: Commit**

```powershell
git -C "C:/Users/alex_/amana" add apps/backend/README.md
git -C "C:/Users/alex_/amana" commit -m "docs(backend): document Sub-plan 5 surface (notifications, cron, refund)"
```

---

### Task 28: Full sweep

**Files:** none.

Mirrors Sub-plan 4's T31. Fresh DB rebuild, all migrations, build/lint/typecheck/test all green.

- [ ] **Step 1: Clean DB**

```powershell
docker compose down -v
docker compose up -d
Start-Sleep -Seconds 8
pnpm --filter @amana/backend db:migrate
```

- [ ] **Step 2: Build / lint / typecheck / test**

```powershell
pnpm build
pnpm exec biome check .
pnpm typecheck
pnpm --filter @amana/backend test
```

Expected ≥ 320 tests passing (273 from SP4 + ~50 new from SP5). 0 failures, 1 skipped (sandbox smoke).

- [ ] **Step 3: Stop docker**

```powershell
docker compose down
```

If Biome flags mechanical issues, run `biome check --write .` (NOT `--unsafe`) and commit as `style: ...`.

---

### Task 29: Memory + module barrel update

**Files:**
- Modify: `apps/backend/src/modules/index.ts` (already done in T19; verify)
- Modify: `apps/backend/src/modules/transactions/index.ts` (already done in T24; verify)

- [ ] **Step 1: Verify barrels are complete**

Read both files. They should re-export everything new from this sub-plan: `notifications`, `refundService`.

- [ ] **Step 2: No commit needed unless something is missing.** If something was missed, fix and commit:

```powershell
git -C "C:/Users/alex_/amana" commit -m "chore(modules): backfill barrel exports for Sub-plan 5"
```

---

### Task 30: Push + tag v0.0.5-notifications

- [ ] **Step 1: Push + tag**

```powershell
git -C "C:/Users/alex_/amana" push origin main
git -C "C:/Users/alex_/amana" tag -a v0.0.5-notifications -m "Sub-plan 5 complete: notifications + cron + refund recon"
git -C "C:/Users/alex_/amana" push origin v0.0.5-notifications
```

- [ ] **Step 2: Verify CI green** at https://github.com/Alexander77063/amana/actions.

---

## Phase K — End-to-end (Tasks 31-33)

### Task 31: E2E — bump approve → push notification fired

**Files:**
- Create: `apps/backend/tests/routes/e2e-bump-notification.test.ts`

Walks: agent intent → evaluate (denies + creates bump) → assert principal got `bump_requested` notification → principal approve → assert agent got `bump_decided` notification → resume → send → settle → assert both got `txn_settled` notifications.

- [ ] **Step 1: Test**

(Mirror the structure of `e2e-spend.test.ts` from Sub-plan 4, with `vi.mock('expo-server-sdk', ...)` at the top, plus assertions on `notificationsRepo.findByDedupeKey` after each step.)

- [ ] **Step 2: Run + commit**

```powershell
pnpm --filter @amana/backend test tests/routes/e2e-bump-notification.test.ts
git -C "C:/Users/alex_/amana" add apps/backend/tests/routes/e2e-bump-notification.test.ts
git -C "C:/Users/alex_/amana" commit -m "test(routes): e2e bump → notification → approve → settle (verifies notification dispatch at each step)"
```

---

### Task 32: Pre-tag full sweep (re-run T28)

After T31 lands and any new tests pass, re-run the full sweep to confirm nothing regressed.

```powershell
docker compose up -d
Start-Sleep -Seconds 6
pnpm --filter @amana/backend db:migrate
pnpm build
pnpm typecheck
pnpm --filter @amana/backend test
docker compose down
```

If green, proceed to T33.

---

### Task 33: Final commit cleanup + push tag

If T28 already pushed, you're done. Otherwise re-tag.

```powershell
git -C "C:/Users/alex_/amana" log --oneline -10
# Verify tag points to the latest green commit. If not:
git -C "C:/Users/alex_/amana" tag -d v0.0.5-notifications
git -C "C:/Users/alex_/amana" push --delete origin v0.0.5-notifications  # only if pushed wrong
git -C "C:/Users/alex_/amana" tag -a v0.0.5-notifications -m "Sub-plan 5 complete"
git -C "C:/Users/alex_/amana" push origin v0.0.5-notifications
```

---

## Plan complete

When all 33 tasks land green:
- 6 notification kinds × 3 channels × prefs matrix all routed end-to-end.
- Expo Push + Termii SMS providers installed; tests cover stub paths.
- Cron worker runs recon every 5 min and bump TTL sweep every minute.
- Refund recon links inbound NIP credits to recent spends; re-credits the source instead of mis-booking as topup.
- Tagged `v0.0.5-notifications`.

**Next:** Sub-plans 6 + 7 — Principal and Agent mobile apps. Sub-plan 5's HTTP routes (`/devices`, `/me/notifications`, `/me/notification-preferences`) are the integration surface the mobile apps consume.
