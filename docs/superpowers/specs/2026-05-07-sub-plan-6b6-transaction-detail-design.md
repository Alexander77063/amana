# Sub-plan 6b-6 — Principal Mobile App: transaction detail screen (design spec)

> Status: design approved, ready for implementation-plan generation. Date: 2026-05-07.

## Goal

A principal user can tap a transaction-related notification (settled / failed / refund / anomaly alert) in the inbox or as a push and land on a detail screen that shows the receipt-grade view of that transaction — amount, status, vendor, who initiated it, settled time, NIBSS session ID, agent note, anomaly badge if scored ≥ 0.85, and a tap-out to maps if the agent's location was captured. Closes the dead-end deep-link gap left as a forward-pointer in 6b-4.

## Decisions locked during brainstorm

1. **Slice scope** — read-only detail screen + push-template patches only (Q1-A). No history list, no per-txn actions (dispute / report / share). The actual itch is "the inbox tap-through is dead-ended" — A fixes that minimally; list and actions are separate slices.
2. **Response shape** — server-enriched DTO (Q2-A). Backend joins txn + sub-wallet + initiating user (+ optional bump decision when relevant) and returns one ready-to-render `TransactionDetail` object. Mobile screen is dumb — single fetch, render fields.
3. **Fields surfaced** — Q3-B (agent context) + geolocation. Includes amount, status, vendor name + masked account, sub-wallet, initiating actor + role, initiated/settled timestamps, NIBSS session ID, error message (when failed), agent note, anomaly score (badge only when ≥ 0.85), geolocation. Excludes attached media and bump-decision metadata for v1 (forward-pointers only).
4. **Geolocation rendering** — link-out via `Linking.openURL` (Q4-A). Tappable "📍 View location" row opens Google Maps URL; iOS opens Apple Maps via the URL handler, Android opens Google Maps app. Zero new native deps.
5. **Auth** — principal-only at v1. Agent app doesn't exist yet; deferring agent-side viewing of own txns until that app ships.
6. **No existence leak** — txn not found and "txn exists but belongs to another household" both return 404 with the same code, so callers can't probe for the existence of other households' txns.
7. **State management** — local component state (`useState`), no new Zustand store. Single screen, single fetch — a `transactions.store.byId` cache is YAGNI. Refetch on `useFocusEffect` so a stale "Settled" badge doesn't linger after a reversal.
8. **Reversed-time** — punted to v1.5. The `transactions` table has no `reversed_at` column; v1 displays `[Reversed]` badge only, no timestamp. Acceptable for v1 since reversed txns are rare.

## Architecture

Two layers added on top of v0.0.6b5-snooze-and-quiet-hours. (1) Backend gets one new `GET /transactions/:id` route, one new `transactionDetailService` that assembles the DTO, one small `maskAccount` lib, and four push-template patches that embed `transactionId` + `subWalletId` in the rendered notification's `data` field. (2) Mobile gets a new `TransactionDetailScreen`, a new `TransactionApi` in the api-client, an extension to `deepLinkFor` to recognize the four newly-deep-linkable kinds, and one route registration in `MainStack.tsx`.

The `NotificationDeepLink.transaction.subWalletId` shared type is loosened from `string` to `string | null` so principal direct-spend txns (decision #17 — `sub_wallet_id` is NULL on the row) can also be deep-linked. The screen renders direct-spend gracefully — `subWallet` becomes "Direct from master wallet", `initiatedBy.displayName` becomes "You".

Tech stack: existing only — Drizzle + Hono on backend, Zustand-free local state on mobile, vitest 2.1.2 already wired into the principal app from 6b-4. No new dependencies.

## Backend changes

### New shared type — `packages/types/src/transaction.ts` (new)

```ts
export type TransactionStatus =
  | 'draft'
  | 'rule_eval'
  | 'bump_pending'
  | 'in_flight'
  | 'settled'
  | 'failed'
  | 'reversed';

export type TransactionKind = 'spend' | 'topup' | 'refund' | 'fee' | 'reversal';

export type TransactionDetail = {
  id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountKobo: string; // BigInt as string for JSONB safety

  // Vendor — null on topups, fees, reversals
  vendorResolvedName: string | null;
  vendorAccountMasked: string | null; // "***1234" — last 4 only on the wire
  vendorBankCode: string | null;
  category: string | null;

  // Sub-wallet context — null on principal direct spend
  subWallet: { id: string; name: string } | null;

  // Initiating actor (decision #15 attribution)
  initiatedBy: { userId: string; displayName: string; role: 'principal' | 'agent' };
  initiatedAt: string; // ISO

  // Outcome timestamps
  settledAt: string | null;
  nibssSessionId: string | null; // surface prominently when present (receipt proof)
  errorMessage: string | null; // populated when status === 'failed'

  // Agent context (Q3-B)
  agentNote: string | null;
  anomalyScore: number | null; // 0..1 — surface badge only when >= 0.85

  // Geolocation (Q4 link-out)
  geolocation: { lat: number; lng: number } | null;

  // FORWARD: attachedMedia (signed URLs), bumpDecision metadata, reversedAt — see 6b-6 spec §Out-of-scope
};
```

### New service — `apps/backend/src/modules/transactions/detail.service.ts`

```ts
export const transactionDetailService = {
  /** Returns the enriched detail or null when not found / not owned by this principal. */
  async getByIdForPrincipal(
    db: PostgresJsDatabase,
    transactionId: string,
    principalUserId: string,
  ): Promise<TransactionDetail | null>;
};
```

Joins `transactions` + `master_wallets` + `households` (to verify principal ownership) + `sub_wallets` (LEFT JOIN — null for direct-spend) + `users` (initiating user). Uses `maskAccount` to redact `vendor_account`. Returns `null` if either the txn doesn't exist or the caller isn't the household principal — caller maps both to 404 with same code (no existence leak).

### New helper — `apps/backend/src/lib/mask-account.ts`

```ts
export function maskAccount(account: string | null): string | null {
  if (!account) return null;
  if (account.length <= 4) return `***${account}`;
  return `***${account.slice(-4)}`;
}
```

Pure function, ~3 vitest cases.

### Initiating-user resolution

The `transactions` table doesn't store an `initiated_by_user_id` column today (verified 2026-05-07). v1 reconstructs the initiator from the existing FK graph:

- `txn.sub_wallet_id IS NOT NULL` → initiator = `sub_wallets.agent_user_id` (the agent assigned to that sub-wallet). Role: `agent`.
- `txn.sub_wallet_id IS NULL` (principal direct-spend, decision #17) → initiator = `households.principal_user_id` (walk through `master_wallets.household_id`). Role: `principal`.

This reconstruction is correct for `kind: 'spend'`. For `kind: 'refund'` / `'reversal'` (system-triggered), the initiator is conceptually the *originating spend's* initiator — same lookup applies because refunds carry the same `sub_wallet_id` as the original spend (or `NULL` for direct-spend reversal). For `kind: 'topup'` / `'fee'`, vendor fields are null and the initiator field is rarely useful — the principal isn't expected to land on a topup/fee detail at v1, but the screen renders gracefully if they do.

No schema change. FORWARD comment in `detail.service.ts` notes that an explicit `initiated_by_user_id` column would be cleaner if the FK-reconstruction logic ever needs to handle multi-actor scenarios (e.g., principal-initiated sub-wallet txns once decision #17 expands).

### Vendor account masking

`maskAccount` lives in `apps/backend/src/lib/mask-account.ts`. Server-side only — full account number stays in the DB row, only the masked form reaches the wire. (Privacy + receipt convention.)

### Anomaly score

`transactions.anomaly_score` is `decimal(3,2)` — convert to `Number` in the DTO. Mobile renders the badge only when `score >= 0.85` (mirrors §10 STR threshold from master design). Below threshold the field is still returned (callers may use it for diagnostics) but the badge is hidden.

### Geolocation

`transactions.geolocation` is a PostGIS `geometry('point', 4326)`. Backend extracts to `{ lat, lng }` via Drizzle's `ST_Y(geolocation)` / `ST_X(geolocation)` helpers (or raw SQL). Returns `null` when the point is null.

### New route — `GET /transactions/:id` in `apps/backend/src/routes/transactions.ts`

Auth: existing `jwtAuth()` middleware + role check (principal only — agent gets 403 with `principal_only`). Calls `transactionDetailService.getByIdForPrincipal(db, id, actor.userId)`; returns 404 `not_found` if null, otherwise 200 `{ transaction: TransactionDetail }`.

### Push template patches

Four templates in `apps/backend/src/modules/notifications/templates/` get `transactionId` + `subWalletId` added to their `data` field:

- `txn-settled.ts`
- `txn-failed.ts`
- `anomaly-alert.ts`
- `refund-received.ts`

Each renderer's input shape gains `transactionId: string` and `subWalletId: string | null`. The four dispatcher call sites (already updated in 6b-5 T6 to populate `intent.subWalletId`) need the additional `transactionId` — sourced from the originating txn. Pass-through is mechanical.

The bump-related templates (`bump-requested`, `bump-decided`) already deep-link to BumpsInbox via `bumpRequestId` and don't need patching.

## Mobile changes

### `NotificationDeepLink` shape change

`packages/types/src/notification.ts` — loosen the type:

```ts
export type NotificationDeepLink =
  | { kind: 'bump'; bumpRequestId: string }
  | { kind: 'transaction'; transactionId: string; subWalletId: string | null }
  | { kind: 'none' };
```

Direct-spend txns can now be deep-linked.

### `deepLinkFor` extension — `apps/principal/src/lib/push.ts`

```ts
if (
  (kind === 'txn_settled' ||
    kind === 'txn_failed' ||
    kind === 'anomaly_alert' ||
    kind === 'refund_received') &&
  typeof p.transactionId === 'string' &&
  // subWalletId can be string OR null (direct-spend); accept both
  (typeof p.subWalletId === 'string' || p.subWalletId === null)
) {
  return {
    kind: 'transaction',
    transactionId: p.transactionId,
    subWalletId: typeof p.subWalletId === 'string' ? p.subWalletId : null,
  };
}
```

### New screen — `apps/principal/src/screens/TransactionDetailScreen.tsx`

```tsx
type Props = NativeStackScreenProps<MainStackParamList, 'TransactionDetail'>;

export function TransactionDetailScreen({ route, navigation }: Props): JSX.Element {
  const { transactionId } = route.params;
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; code: string }
    | { kind: 'ready'; txn: TransactionDetail }
  >({ kind: 'loading' });

  // Refetch on every focus — txn status can change between visits.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void api.transaction
        .getById(transactionId)
        .then((r) => {
          if (!cancelled) setState({ kind: 'ready', txn: r.transaction });
        })
        .catch((e) => {
          if (!cancelled) setState({ kind: 'error', code: ERR(e) });
        });
      return () => {
        cancelled = true;
      };
    }, [transactionId]),
  );

  // ... render based on state.kind ...
}
```

### Layout (ready state)

```
┌─────────────────────────────────────────┐
│  ₦12,300.00          [Settled]          │  ← amount + status badge
│  Mama Tola Foodstuffs                   │  ← vendor name (large)
│  GTBank ***1234                         │  ← bank + masked acct
├─────────────────────────────────────────┤
│  Sub-wallet     Tunde's allowance       │  (or "Direct from master wallet")
│  Initiated by   Tunde Adeyemi · agent   │  (or "You" for principal direct-spend)
│  Initiated      Today, 2:34 PM          │
│  Settled        Today, 2:35 PM          │  ← only when status === 'settled'
├─────────────────────────────────────────┤
│  📝 "Groceries for the week"            │  ← agentNote, hidden if null
├─────────────────────────────────────────┤
│  ⚠ Anomaly score 0.91                  │  ← only when score >= 0.85
├─────────────────────────────────────────┤
│  📍 View location                    ›  │  ← only when geolocation present
├─────────────────────────────────────────┤
│  Receipt                                │
│  NIBSS session  10000503...123456       │  ← only when nibssSessionId present
└─────────────────────────────────────────┘
```

### Status-conditional sections

| Status | Badge color | Status-specific block |
|---|---|---|
| `settled` | green | NIBSS session ID + settled-at timestamp ("Receipt" section) |
| `failed` | red | Error reason (`errorMessage`); no NIBSS row, no settled row |
| `reversed` | grey | "[Reversed]" badge only; v1 does not display the reversal timestamp |
| `bump_pending` | amber | Banner: "⏳ Awaiting your decision" + CTA `[Review request]` → navigates to `BumpsInbox` |
| `in_flight` | blue | "Sending… should appear within 30 seconds" |
| `rule_eval` / `draft` | grey | Generic "In progress" — not normally reachable from inbox tap, render gracefully |

### Direct-spend rendering

When `txn.subWallet === null`, replace "Sub-wallet" row with `"Direct from master wallet"` plain text (no chevron, no tap handler). When `txn.initiatedBy.role === 'principal'`, render `initiatedBy.displayName` as `"You"`. The two checks are independent — handled with two ternaries, not a coupled state machine.

### Geolocation tap handler

```tsx
const onViewLocation = (): void => {
  if (!txn.geolocation) return;
  const { lat, lng } = txn.geolocation;
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
};
```

### Error states

Loading → `<ActivityIndicator />`. Error → shared error component switching on `errorCode`:

| Code | Message | Action |
|---|---|---|
| `unauthorized` | (existing app-wide auth flow) | logout |
| `principal_only` | "You don't have access to this transaction" | Back |
| `not_found` | "Transaction not found" | Back |
| anything else | "Couldn't load. Try again." | Retry (refetches) |

### Navigation registration — `apps/principal/src/nav/MainStack.tsx`

Add to `MainStackParamList`:

```ts
TransactionDetail: { transactionId: string };
```

And the corresponding `<Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ title: 'Transaction' }} />`.

### Two existing call sites navigate to the new route

1. **`NotificationsInboxScreen.tsx`** — its existing tap handler calls `deepLinkFor(...)`; for the four newly-patched kinds this now returns `{kind: 'transaction', transactionId, subWalletId}`. The handler routes those to `navigation.navigate('TransactionDetail', { transactionId })`. (subWalletId is informational — the screen fetches it from the DTO and doesn't need it as a param.)

2. **`App.tsx` push-tap handler (`navigateForResponse`)** — same logic; add the txn case parallel to the existing bump case.

## API client changes

`packages/api-client/src/transaction-api.ts` — new file:

```ts
export class TransactionApi {
  constructor(private readonly client: AuthedClient) {}

  getById(transactionId: string): Promise<{ transaction: TransactionDetail }> {
    return this.client.request<{ transaction: TransactionDetail }>(
      `/transactions/${transactionId}`,
    );
  }
}
```

Wired into `AmanaApiClient` alongside existing fields:

```ts
public readonly transaction: TransactionApi;
// in constructor:
this.transaction = new TransactionApi(this);
```

## Validation changes

None. The `GET` route takes no body — only a path parameter (`transactionId`). The DTO is response-only.

## Tests

| Layer | New / extended files | Cases |
|---|---|---|
| Backend route | extend `apps/backend/tests/routes/transactions.test.ts` | ~11 |
| Backend service | new `detail.service.test.ts` | ~7 |
| Backend lib | new `mask-account.test.ts` | ~3 |
| Backend templates | extend `templates.test.ts` | ~8 (4 templates × 2 cases) |
| API client | new `transaction-api.test.ts` | ~2 |
| Mobile lib (`deepLinkFor`) | new `push.test.ts` | ~7 |
| **Total** | | **~38 new cases** |

Mobile screen stays typecheck-only (no RN testing-library), consistent with 6b-4 / 6b-5.

### Backend route tests cover

- 200 happy paths for each meaningful status (settled, failed, bump_pending, reversed, principal direct-spend) — 5 cases
- 200 verifies vendor account masking (last-4)
- 200 verifies geolocation surfaces as `{lat, lng}` when present and `null` otherwise
- 200 verifies anomalyScore returns plain number even when below threshold
- 403 — non-principal caller (agent role)
- 404 — unknown txn id
- 404 — txn exists but caller is principal of a different household (no existence leak)

### Backend service tests cover

- Joins sub-wallet name when `sub_wallet_id` is set
- Returns `subWallet=null` for direct-spend txns
- Joins initiating user — agent role, display name
- Joins initiating user — principal role for direct-spend (displayName = principal's name; mobile renders as "You")
- Masks vendor account number to last 4 digits
- Returns null for vendor fields on non-spend kinds
- Returns null when txn doesn't belong to the requested principal

### Backend templates tests cover

For each of the four patched templates (`txn-settled`, `txn-failed`, `anomaly-alert`, `refund-received`):
- `data.transactionId` populated from input
- `data.subWalletId` populated from input, including the `null` case (direct-spend)

### Mobile `deepLinkFor` tests cover

- Returns transaction deep-link for each of the four kinds when `transactionId` is present
- Accepts `subWalletId === null` for direct-spend deep-link
- Returns bump deep-link for `bump_requested` + `bump_decided` (regression)
- Returns `{kind: 'none'}` when payload is missing `transactionId`

## Migration / data

None. No schema changes — the slice is purely additive on top of existing tables and routes. The `transactions` table already has every field the DTO surfaces; `initiatedBy` is reconstructed from the existing FK graph (see §Initiating-user resolution).

## Out of scope for 6b-6 (deferred)

| Item | Why deferred | Where it would slot in |
|---|---|---|
| Per-sub-wallet transaction history list | Separate UX surface (Q1-B). Pagination, filters, empty states all warrant their own brainstorm. | Sub-plan 6b-7 candidate |
| Per-txn actions (Report a problem, Share receipt, Dispute) | Each implies a backend flow we don't have yet (dispute system, share-sheet integration, etc.). | v1.5+ |
| Inline map preview via `react-native-maps` | Adds native dep + Apple/Google Maps API key + EAS config burden. Link-out covers the use case at v1. | v1.5 if usage data shows people want it in-app |
| Static map image via Google Static Maps API | Needs backend-proxied API key (so key isn't in mobile bundle). | v1.5 |
| Attached media display (photos / notes) | Needs signed URL handling + image rendering. | v1.5 |
| Bump-decision metadata (who/when/why) for `bump_pending` and bumped `settled` txns | The CTA → BumpsInbox covers the "I need to act" case. Forensic detail is v1.5+. | v1.5 |
| Reversed-time display (`reversed_at` timestamp) | Schema add is small but adds to slice. Reversed txns rare; "Reversed" badge alone is enough at v1. | v1.5 |
| Agent-side viewing of own txns | Agent app doesn't exist yet. | When agent app ships |
| Geolocation accuracy / address resolution | Currently shows raw lat/lng; reverse-geocoding to a street address would be nicer but needs a geocoder service. | v1.5 |

### Adjacent slices

- **Indefinite-mute UX split (6b-5 follow-up)** — independent of 6b-6; can ship in parallel.
- **Vendor capture / principal direct-spend (decision #17)** — independent. Direct-spend txns will use this screen when they exist; the screen already handles `subWallet=null` and `initiatedBy.role='principal'`.
- **Per-sub-wallet history (Q1-B)** — natural follow-up. The detail screen + DTO becomes its row-tap target.

## Tag at completion

`v0.0.6b6-transaction-detail` after CI green on the final commit.

## Plan-complete criteria

- A principal can tap a `txn_settled` / `txn_failed` / `anomaly_alert` / `refund_received` notification (in-app inbox or push) and land on a transaction detail screen showing amount, status, vendor, masked account, sub-wallet (or "Direct from master wallet"), initiating actor + role, timestamps, NIBSS session ID, agent note, anomaly badge if applicable, and a "View location" link if geolocation captured.
- The screen handles all 7 transaction statuses gracefully (settled / failed / bump_pending / reversed / in_flight / rule_eval / draft), with status-specific sections where they add value.
- Direct-spend txns (`sub_wallet_id` NULL, `initiatedBy.role === 'principal'`) render with "Direct from master wallet" + "You".
- `GET /transactions/:id` returns 403 for non-principal callers and 404 (no existence leak) for non-owned txns.
- Push-tap from a transaction notification deep-links to the screen, in addition to in-app inbox tap.
- ~38 new test cases across the layer cake.
