# Fee Cover — Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-computed "fee cover" numbers in the Principal app in two places — a tappable **home hero card** showing the lifetime bank fees Amana has absorbed (`masterWallet.feesCoveredKobo`), and a **per-top-up receipt line** ("Bank fee covered: ₦50 ✓") on the transaction detail screen (`inflowFeeAbsorbedKobo`).

**Architecture:** The home-card path is UI-only — `feesCoveredKobo` is already returned by `GET /me/household` (`routes/households.ts:160`), so we only add the type field, a presentational `FeeCoverCard` in `@amana/ui`, and home-screen wiring. The per-top-up path needs one narrow **backend bridge**: `transactionDetailService` does not currently select or return `inflow_fee_absorbed_kobo`, so we add it to the SELECT + DTO + `TransactionDetail` type, then render it on `TransactionDetailScreen` (the de-facto top-up receipt — there is no dedicated top-up success screen). Money formatting is DRY'd into one `apps/principal/src/lib/format-money.ts` reused by both screens. A small static `FeeCoverInfoScreen` modal gives the hero card a tap destination.

**Tech Stack:** Existing only — Drizzle + postgres-js + Hono (backend), React Native / Expo + Zustand + `@react-navigation/native-stack` (mobile), Vitest 2.x with `react-test-renderer` under `environment: 'node'` (UI/screen tests), Biome (single quotes, 2-space, 100-col). No new runtime dependencies. No DB migration (`transactions.inflow_fee_absorbed_kobo` already exists — migration `0023`).

**Spec:** No spec file exists at `docs/superpowers/specs/2026-07-01-fee-cover-design.md` (verified absent). This plan treats the task brief as the spec. See open question #1 below.

**Base SHA:** `7a081fd` (HEAD on `main`).

---

## Spec deltas locked during plan-writing

1. **Backend bridge required (not "already built").** `feesCoveredKobo` IS exposed on `GET /me/household`, but `inflowFeeAbsorbedKobo` is **not** on the transaction detail endpoint: `detail.service.ts` `DETAIL_SELECT` omits the column, `buildDetail` omits the field, and the `TransactionDetail` type lacks it. The per-top-up line cannot render without a narrow backend addition. Task 2 adds `t.inflow_fee_absorbed_kobo::text` to the SELECT, maps it in `buildDetail`, and adds a service test. This does not change the UI approach.
2. **No dedicated "top-up success" screen exists.** Top-ups arrive via the `virtual_account.credited` webhook (`topupService.handle`); the Principal app has no top-up flow. `TransactionDetailScreen` (when `kind === 'topup'`) is the receipt surface. The fee line renders only when `kind === 'topup' && inflowFeeAbsorbedKobo !== null && BigInt(inflowFeeAbsorbedKobo) > 0n`.
3. **`feesCoveredKobo` is optional on `MasterWalletSummary`.** The `POST /households` create path (`households.ts:69-78`) omits it and `CreateHouseholdResult` reuses `MasterWalletSummary`, so right after `createHousehold()` the store's `masterWallet.feesCoveredKobo` is `undefined` until the next `bootstrap()`. The home render guards `undefined`.
4. **Formatting is 2-decimal for app consistency.** The brief illustrates the hero as "₦4,820" (no decimals), but every existing money surface (e.g. `TransactionDetailScreen`, `BalanceCard` usages) renders 2 decimals. We render `₦4,820.00` via the shared `formatNaira`. Noted as inferred.
5. **Tappable hero card → static explainer.** No data-backed fee-history screen exists. `FeeCoverCard` takes an optional `onPress` (button role only when present, mirroring `TransactionRow`); Home wires it to a new static `FeeCoverInfoScreen` modal. Inferred, not from spec.

---

## Pre-flight: docker + dist build (do once at the start)

Shared packages are consumed from `dist` by the apps, so type edits in `@amana/types` are invisible to `apps/principal` and `apps/backend` until rebuilt. Backend tests need Postgres.

```bash
cd "C:/Users/alex_/amana"
docker compose up -d postgres
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
```

Verify postgres is healthy:

```bash
docker compose ps postgres
```

Expected: STATUS `Up (healthy)`.

> After **any** task that edits `packages/types/src/*`, re-run `pnpm --filter @amana/types build` before running backend/app tests, or the new field won't resolve.

---

## File structure produced by this plan

**Created:**
- `packages/ui/src/data/FeeCoverCard.tsx` — presentational hero card (pre-formatted `amount` string, optional `onPress`).
- `apps/principal/src/lib/format-money.ts` — shared `formatNaira(koboStr)` (kobo string → `₦x,xxx.xx`).
- `apps/principal/src/lib/format-money.test.ts` — unit test for `formatNaira`.
- `apps/principal/src/screens/FeeCoverInfoScreen.tsx` — static explainer modal (hero card tap destination).
- `apps/principal/src/screens/FeeCoverInfoScreen.test.tsx` — smoke test for the explainer screen.
- `apps/principal/src/screens/TransactionDetailScreen.test.tsx` — screen test (net-new; mocks `../lib/api`).

**Modified:**
- `packages/types/src/household.ts` — add `feesCoveredKobo?: string` to `MasterWalletSummary`.
- `packages/types/src/transaction.ts` — add `inflowFeeAbsorbedKobo: string | null` to `TransactionDetail`.
- `apps/backend/src/modules/transactions/detail.service.ts` — select + map `inflow_fee_absorbed_kobo`.
- `apps/backend/tests/modules/transactions/detail.service.test.ts` — assert the new field.
- `packages/ui/src/index.ts` — export `FeeCoverCard`.
- `packages/ui/test/data.test.tsx` — `FeeCoverCard` component tests.
- `apps/principal/src/screens/TransactionDetailScreen.tsx` — import shared `formatNaira`; add the top-up fee line.
- `apps/principal/src/screens/HomeDashboardScreen.tsx` — render `FeeCoverCard` from `masterWallet.feesCoveredKobo`.
- `apps/principal/src/screens/HomeDashboardScreen.test.tsx` — add `feesCoveredKobo` to the mock + assertions.
- `apps/principal/src/nav/MainStack.tsx` — register `FeeCoverInfo` route.

---

## Task 1: Types — surface the two kobo fields

**Files:**
- Modify: `packages/types/src/household.ts`
- Modify: `packages/types/src/transaction.ts`

- [ ] **Step 1: Add `feesCoveredKobo` to `MasterWalletSummary`**

In `packages/types/src/household.ts`, replace the `MasterWalletSummary` type:

```ts
export type MasterWalletSummary = {
  id: string;
  anchorVirtualAccount: string;
  anchorBankCode: string;
  currency: string;
  status?: MasterWalletStatus;
  /**
   * Lifetime sum (kobo, string) of bank inflow fees Amana absorbed on this
   * wallet's top-ups. Present on `GET /me/household`; omitted on the create
   * response (`POST /households`), hence optional.
   */
  feesCoveredKobo?: string;
};
```

- [ ] **Step 2: Add `inflowFeeAbsorbedKobo` to `TransactionDetail`**

In `packages/types/src/transaction.ts`, inside the `TransactionDetail` type, add the field immediately after `amountKobo`:

```ts
  /** BigInt-safe — string over the wire. */
  amountKobo: string;

  /**
   * Bank inflow fee (kobo, string) Amana absorbed on this specific top-up.
   * Non-null only for `kind === 'topup'` rows that recorded a fee; null otherwise.
   */
  inflowFeeAbsorbedKobo: string | null;
```

- [ ] **Step 3: Rebuild the types package**

Run: `pnpm --filter @amana/types build`
Expected: exits 0, `packages/types/dist` regenerated.

- [ ] **Step 4: Typecheck the consumers compile against the new shape**

Run: `pnpm --filter @amana/types typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/household.ts packages/types/src/transaction.ts
git commit -m "feat(types): surface feesCoveredKobo and inflowFeeAbsorbedKobo"
```

---

## Task 2: Backend bridge — expose `inflowFeeAbsorbedKobo` on the detail DTO

The transaction detail endpoint must return the field the UI renders (Spec delta #1). This is the only backend change.

**Files:**
- Modify: `apps/backend/src/modules/transactions/detail.service.ts`
- Test: `apps/backend/tests/modules/transactions/detail.service.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/backend/tests/modules/transactions/detail.service.test.ts`, add this test inside the `describe('transactionDetailService.getByIdForPrincipal', ...)` block (after the existing `'returns errorMessage for a failed txn'` test):

```ts
  it('surfaces inflowFeeAbsorbedKobo for a top-up and null for a spend', async () => {
    const { principal, mw } = await setup();
    const topup = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: null,
      kind: 'topup',
      amountKobo: kobo(1_000_000n),
      idempotencyKey: factories.idempotencyKey(),
      inflowFeeAbsorbedKobo: kobo(5_000n), // ₦50
    });
    const spend = await transactionsRepo.insert(testDb, {
      masterWalletId: mw.master.id,
      subWalletId: null,
      kind: 'spend',
      amountKobo: kobo(2_000n),
      idempotencyKey: factories.idempotencyKey(),
      vendorAccount: '0123456789',
      vendorBankCode: '058',
      vendorResolvedName: 'V',
    });

    const t = await transactionDetailService.getByIdForPrincipal(testDb, topup.id, principal.id);
    expect(t?.kind).toBe('topup');
    expect(t?.inflowFeeAbsorbedKobo).toBe('5000');

    const s = await transactionDetailService.getByIdForPrincipal(testDb, spend.id, principal.id);
    expect(s?.inflowFeeAbsorbedKobo).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/detail.service.test.ts -t "surfaces inflowFeeAbsorbedKobo"`
Expected: FAIL — `t?.inflowFeeAbsorbedKobo` is `undefined` (property not yet on the DTO), assertion `toBe('5000')` fails.

- [ ] **Step 3: Add the column to the `Row` type**

In `apps/backend/src/modules/transactions/detail.service.ts`, add to the `Row` type (after `amount_kobo`):

```ts
  amount_kobo: string; // pg-js bigint → string
  inflow_fee_absorbed_kobo: string | null; // pg-js bigint → string
```

- [ ] **Step 4: Add the column to `DETAIL_SELECT`**

In the same file, add the projection right after `t.amount_kobo::text AS amount_kobo,`:

```sql
    t.amount_kobo::text AS amount_kobo,
    t.inflow_fee_absorbed_kobo::text AS inflow_fee_absorbed_kobo,
```

- [ ] **Step 5: Map it in `buildDetail`**

In the returned object inside `buildDetail`, add the field right after `amountKobo`:

```ts
    amountKobo: row.amount_kobo,
    inflowFeeAbsorbedKobo: row.inflow_fee_absorbed_kobo,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @amana/backend exec vitest run tests/modules/transactions/detail.service.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 7: Typecheck the backend**

Run: `pnpm --filter @amana/backend typecheck`
Expected: PASS. (`buildDetail` here is the **only** producer of a `TransactionDetail` object literal — verified via `grep`; the agent app screen and `routes/transactions.test.ts` use `TransactionDetail` only as a type annotation on parsed JSON, so making `inflowFeeAbsorbedKobo` required breaks no other construction site.)

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/transactions/detail.service.ts apps/backend/tests/modules/transactions/detail.service.test.ts
git commit -m "feat(backend): expose inflowFeeAbsorbedKobo on transaction detail DTO"
```

---

## Task 3: `FeeCoverCard` component in `@amana/ui`

Presentational and pure — takes a **pre-formatted** `amount` string (like `BalanceCard`); `@amana/ui` holds no kobo/BigInt logic. Announces a single grouped accessibility label; becomes a button only when `onPress` is provided (mirrors `TransactionRow`).

**Files:**
- Create: `packages/ui/src/data/FeeCoverCard.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/data.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/ui/test/data.test.tsx`, add the import at the top (with the other `../src/data/*` imports):

```ts
import { FeeCoverCard } from '../src/data/FeeCoverCard';
```

Then append this `describe` block at the end of the file:

```tsx
describe('FeeCoverCard', () => {
  it('renders the amount and the "bank fees covered" copy', () => {
    const { root } = render(<FeeCoverCard amount="₦4,820.00" />);
    const content = textContent(root);
    expect(content).toContain('₦4,820.00');
    expect(content).toContain('in bank fees covered');
  });

  it('announces amount plus explainer as one grouped label', () => {
    const { root } = render(<FeeCoverCard amount="₦4,820.00" />);
    expect(
      byLabel(
        root,
        "₦4,820.00 in bank fees covered. Amana covers the bank's funding fee, so every naira you load lands.",
      ),
    ).toBeTruthy();
  });

  it('is a button and fires onPress when interactive', () => {
    let opened = false;
    const { root } = render(
      <FeeCoverCard
        amount="₦4,820.00"
        onPress={() => {
          opened = true;
        }}
      />,
    );
    const card = byRole(root, 'button');
    (card.props.onPress as () => void)();
    expect(opened).toBe(true);
  });

  it('is not a button when no onPress is given', () => {
    const { root } = render(<FeeCoverCard amount="₦0.00" />);
    expect(allByRole(root, 'button')).toHaveLength(0);
  });
});
```

Update the existing import line in this file to also pull `allByRole` from `./render`:

```ts
import { allByRole, byLabel, byRole, render, textContent } from './render';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @amana/ui exec vitest run test/data.test.tsx -t FeeCoverCard`
Expected: FAIL — module `../src/data/FeeCoverCard` not found.

- [ ] **Step 3: Implement `FeeCoverCard`**

Create `packages/ui/src/data/FeeCoverCard.tsx`:

```tsx
import { Pressable, View } from 'react-native';
import { Card } from '../layout/Card';
import { useTheme } from '../theme/ThemeContext';
import { AmountText } from '../typography/AmountText';
import { Caption } from '../typography/Caption';
import { Label } from '../typography/Label';

type Props = {
  /** Pre-formatted, e.g. "₦4,820.00". Screens format kobo → naira. */
  amount: string;
  /** When set, the card is announced as a button and fires this on tap. */
  onPress?: () => void;
};

const HEADLINE_SUFFIX = 'in bank fees covered';
const SUBTITLE = "Amana covers the bank's funding fee, so every naira you load lands.";

export function FeeCoverCard({ amount, onPress }: Props) {
  const theme = useTheme();
  const a11yLabel = `${amount} ${HEADLINE_SUFFIX}. ${SUBTITLE}`;

  const body = (
    <Card accent>
      <Label>Fees covered</Label>
      <AmountText
        size="lg"
        value={amount}
        sentiment="credit"
        style={{ marginTop: 4, marginBottom: 2 }}
      />
      <Caption style={{ color: theme.colors.credit }}>{HEADLINE_SUFFIX}</Caption>
      <Caption style={{ color: theme.colors.text.muted, marginTop: 8 }}>{SUBTITLE}</Caption>
    </Card>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Learn how fee cover works"
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}
```

- [ ] **Step 4: Export it from the package barrel**

In `packages/ui/src/index.ts`, add next to the other `./data/*` exports:

```ts
export { BalanceCard } from './data/BalanceCard';
export { TransactionRow } from './data/TransactionRow';
export { SectionHeader } from './data/SectionHeader';
export { FeeCoverCard } from './data/FeeCoverCard';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @amana/ui exec vitest run test/data.test.tsx`
Expected: PASS (existing `BalanceCard`/`TransactionRow`/`SectionHeader` tests plus the 4 new `FeeCoverCard` tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/data/FeeCoverCard.tsx packages/ui/src/index.ts packages/ui/test/data.test.tsx
git commit -m "feat(ui): add FeeCoverCard component"
```

---

## Task 4: Shared `formatNaira` helper for the Principal app

`TransactionDetailScreen` currently inlines a `formatNaira`. Promote it to a shared lib so the home screen and the top-up line reuse one formatter (DRY).

**Files:**
- Create: `apps/principal/src/lib/format-money.ts`
- Test: `apps/principal/src/lib/format-money.test.ts`
- Modify: `apps/principal/src/screens/TransactionDetailScreen.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/principal/src/lib/format-money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatNaira } from './format-money';

describe('formatNaira', () => {
  it('formats a whole-naira kobo amount with grouping and 2 decimals', () => {
    expect(formatNaira('482000')).toBe('₦4,820.00');
  });

  it('formats a small fee', () => {
    expect(formatNaira('5000')).toBe('₦50.00');
  });

  it('formats zero', () => {
    expect(formatNaira('0')).toBe('₦0.00');
  });

  it('keeps sub-naira precision', () => {
    expect(formatNaira('12345')).toBe('₦123.45');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @amana/principal exec vitest run src/lib/format-money.test.ts`
Expected: FAIL — module `./format-money` not found.

- [ ] **Step 3: Implement the helper**

Create `apps/principal/src/lib/format-money.ts`:

```ts
/**
 * Format a bigint-safe kobo string as Naira, e.g. "482000" → "₦4,820.00".
 * 1 naira = 100 kobo. Uses BigInt parsing so the string is never coerced to
 * a lossy float before the /100 division.
 */
export function formatNaira(amountKoboStr: string): string {
  const kobo = BigInt(amountKoboStr);
  const naira = Number(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @amana/principal exec vitest run src/lib/format-money.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor `TransactionDetailScreen` to use the shared helper**

In `apps/principal/src/screens/TransactionDetailScreen.tsx`, delete the local `formatNaira` function (the block starting `function formatNaira(amountKoboStr: string): string {` through its closing brace) and add the import alongside the existing `../lib/api` import:

```ts
import { api } from '../lib/api';
import { formatNaira } from '../lib/format-money';
```

- [ ] **Step 6: Run the app package tests + typecheck to confirm no regression**

Run: `pnpm --filter @amana/principal exec vitest run` then `pnpm --filter @amana/principal typecheck`
Expected: PASS — existing suites unchanged, no unused-symbol / missing-import errors.

- [ ] **Step 7: Commit**

```bash
git add apps/principal/src/lib/format-money.ts apps/principal/src/lib/format-money.test.ts apps/principal/src/screens/TransactionDetailScreen.tsx
git commit -m "refactor(principal): extract shared formatNaira helper"
```

---

## Task 5: `FeeCoverInfoScreen` — static explainer modal (hero tap destination)

**Files:**
- Create: `apps/principal/src/screens/FeeCoverInfoScreen.tsx`
- Create: `apps/principal/src/screens/FeeCoverInfoScreen.test.tsx`
- Modify: `apps/principal/src/nav/MainStack.tsx`

- [ ] **Step 1: Implement the screen**

Create `apps/principal/src/screens/FeeCoverInfoScreen.tsx`:

```tsx
import { Body, Card, Heading, Screen } from '@amana/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../nav/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'FeeCoverInfo'>;

export function FeeCoverInfoScreen(_props: Props): JSX.Element {
  return (
    <Screen title="Fee cover" scrollable>
      <Card accent>
        <Heading>Every naira lands</Heading>
        <Body muted>
          When you fund your wallet by bank transfer, the bank charges a small funding fee. Amana
          absorbs that fee for you — so the full amount you send arrives in your wallet, every time.
        </Body>
      </Card>
      <Card>
        <Body>
          The total on your home screen is the lifetime sum of bank funding fees Amana has covered
          on your top-ups.
        </Body>
      </Card>
    </Screen>
  );
}
```

- [ ] **Step 2: Add a smoke test for the screen**

Create `apps/principal/src/screens/FeeCoverInfoScreen.test.tsx` (matches how every other screen in this plan is treated):

```tsx
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, textContent } from '../../test/render';
import { FeeCoverInfoScreen } from './FeeCoverInfoScreen';

function props(): ComponentProps<typeof FeeCoverInfoScreen> {
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
    route: { params: undefined, key: 'k', name: 'FeeCoverInfo' },
  } as unknown as ComponentProps<typeof FeeCoverInfoScreen>;
}

describe('FeeCoverInfoScreen', () => {
  it('renders the title and explainer copy', () => {
    const { root } = render(<FeeCoverInfoScreen {...props()} />);
    const content = textContent(root);
    expect(content).toContain('Every naira lands');
    expect(content).toContain('Amana absorbs that fee');
  });
});
```

- [ ] **Step 3: Run the smoke test**

Run: `pnpm --filter @amana/principal exec vitest run src/screens/FeeCoverInfoScreen.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 4: Register the route in `MainStack`**

In `apps/principal/src/nav/MainStack.tsx`, add the import (alphabetically near the other screen imports):

```ts
import { FeeCoverInfoScreen } from '../screens/FeeCoverInfoScreen';
```

Add the param-list entry inside `MainStackParamList` (after `TransactionDetail`):

```ts
  TransactionDetail: { transactionId: string };
  FeeCoverInfo: undefined;
};
```

Register the screen inside `<Stack.Navigator>` (after the `TransactionDetail` screen), presented as a modal:

```tsx
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
      <Stack.Screen
        name="FeeCoverInfo"
        component={FeeCoverInfoScreen}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @amana/principal typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/principal/src/screens/FeeCoverInfoScreen.tsx apps/principal/src/screens/FeeCoverInfoScreen.test.tsx apps/principal/src/nav/MainStack.tsx
git commit -m "feat(principal): add FeeCoverInfo explainer screen"
```

---

## Task 6: Wire `FeeCoverCard` into the home dashboard

Render the hero card at the top of the dashboard body when `feesCoveredKobo` is present and greater than zero; tapping navigates to `FeeCoverInfo`.

**Files:**
- Modify: `apps/principal/src/screens/HomeDashboardScreen.tsx`
- Test: `apps/principal/src/screens/HomeDashboardScreen.test.tsx`

- [ ] **Step 1: Update the test mock + write the failing assertions**

In `apps/principal/src/screens/HomeDashboardScreen.test.tsx`, make `feesCoveredKobo` a per-test mutable value via `vi.hoisted` — the same pattern `CreateSubWalletScreen.test.tsx` uses to vary `h.members` between tests. This lets us exercise **both** branches of `showFeeCover` (present-and-positive vs. zero/undefined) without re-mocking the module.

Update the import line to pull `allByLabel`:

```ts
import { allByLabel, byLabel, render, textContent } from '../../test/render';
```

Add the hoisted holder above the mock, and read it in the store mock:

```ts
const hh = vi.hoisted(() => ({ feesCoveredKobo: '482000' as string | undefined }));

vi.mock('../state/household.store', () => ({
  useHouseholdStore: (sel: (s: unknown) => unknown) =>
    sel({
      status: 'has_household',
      household: { id: 'h1', name: 'Adegbola household' },
      masterWallet: {
        anchorVirtualAccount: '1234567890',
        anchorBankCode: '058',
        feesCoveredKobo: hh.feesCoveredKobo,
      },
      members: [{ userId: 'a1' }],
      errorCode: null,
      bootstrap: vi.fn(),
    }),
}));
```

Add this test inside the `describe('HomeDashboardScreen', ...)` block:

```tsx
  const HERO_LABEL =
    "₦4,820.00 in bank fees covered. Amana covers the bank's funding fee, so every naira you load lands.";

  it('shows the fee-cover hero card with the formatted lifetime total', () => {
    hh.feesCoveredKobo = '482000';
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(textContent(root)).toContain('₦4,820.00');
    expect(byLabel(root, HERO_LABEL)).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @amana/principal exec vitest run src/screens/HomeDashboardScreen.test.tsx -t "fee-cover hero"`
Expected: FAIL — text `₦4,820.00` and the label are not in the tree (card not wired yet).

- [ ] **Step 3: Wire the card into the screen**

In `apps/principal/src/screens/HomeDashboardScreen.tsx`, update the `@amana/ui` import to include `FeeCoverCard`, and add the `formatNaira` import:

```ts
import { Badge, Body, Button, Card, FeeCoverCard, Screen, Skeleton, useTheme } from '@amana/ui';
```

Add below the existing imports:

```ts
import { formatNaira } from '../lib/format-money';
```

Then, inside the returned `<Screen ...>` (Spec delta #4/#5), insert the card as the **first** child, before the "Top up your wallet" `<Card>`:

```tsx
  const feesCoveredKobo = masterWallet.feesCoveredKobo;
  const showFeeCover = feesCoveredKobo !== undefined && BigInt(feesCoveredKobo) > 0n;

  return (
    <Screen title={household.name} scrollable>
      {showFeeCover ? (
        <FeeCoverCard
          amount={formatNaira(feesCoveredKobo)}
          onPress={() => navigation.navigate('FeeCoverInfo')}
        />
      ) : null}

      <Card>
        <Body strong>Top up your wallet</Body>
```

> `const feesCoveredKobo`/`showFeeCover` go just above the `return (` — they reference `masterWallet`, which is already guaranteed non-null by the `if (!household || !masterWallet)` guard on line 63.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @amana/principal exec vitest run src/screens/HomeDashboardScreen.test.tsx`
Expected: PASS (existing nav-cards test + the new fee-cover test).

- [ ] **Step 5: Add the "hidden when zero/absent" tests**

Append these two tests inside the same `describe` block. They flip `hh.feesCoveredKobo` (the hoisted holder from Step 1) to exercise the false branch of `showFeeCover`. Use `allByLabel` (returns `[]`), **not** `byLabel` (which throws when it finds zero matches):

```tsx
  it('hides the hero card when fees covered is zero', () => {
    hh.feesCoveredKobo = '0';
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(allByLabel(root, HERO_LABEL)).toHaveLength(0);
    // Rest of the dashboard is intact.
    expect(byLabel(root, 'Settings')).toBeTruthy();
  });

  it('hides the hero card when fees covered is absent', () => {
    hh.feesCoveredKobo = undefined;
    const { root } = render(<HomeDashboardScreen {...props()} />);
    expect(allByLabel(root, HERO_LABEL)).toHaveLength(0);
  });
```

> `HERO_LABEL` is the `const` declared in Step 1's first test; hoist it to the top of the `describe` block (above all `it(...)` calls) so all three tests share it.

- [ ] **Step 6: Run the full principal suite + typecheck**

Run: `pnpm --filter @amana/principal exec vitest run` then `pnpm --filter @amana/principal typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/principal/src/screens/HomeDashboardScreen.tsx apps/principal/src/screens/HomeDashboardScreen.test.tsx
git commit -m "feat(principal): show fee-cover hero card on home dashboard"
```

---

## Task 7: Per-top-up "Bank fee covered" line on the detail screen

Render `Bank fee covered: ₦X ✓` on `TransactionDetailScreen` only for top-ups that recorded a positive absorbed fee (Spec delta #2). The screen already imports `formatNaira` (Task 4) and `theme`.

**Files:**
- Modify: `apps/principal/src/screens/TransactionDetailScreen.tsx`
- Test: `apps/principal/src/screens/TransactionDetailScreen.test.tsx` (create)

- [ ] **Step 1: Write the failing screen test**

Create `apps/principal/src/screens/TransactionDetailScreen.test.tsx`. This mocks `../lib/api` (the screen calls `api.transaction.getById` directly — unlike `HomeDashboardScreen`, which only reads stores). The nav mock at `apps/principal/test/mocks/react-navigation-native.tsx` already exports `useFocusEffect`, so the focus fetch runs on mount.

```tsx
import type { TransactionDetail } from '@amana/types';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { byLabel, render, textContent } from '../../test/render';

const h = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { transaction: { getById: h.getById } },
}));

import { TransactionDetailScreen } from './TransactionDetailScreen';

function baseTxn(overrides: Partial<TransactionDetail>): TransactionDetail {
  return {
    id: 't1',
    kind: 'topup',
    status: 'settled',
    amountKobo: '1000000',
    inflowFeeAbsorbedKobo: '5000',
    vendorResolvedName: null,
    vendorAccountMasked: null,
    vendorBankCode: null,
    category: null,
    subWallet: null,
    initiatedBy: { userId: 'p1', displayName: '+2348011112222', role: 'principal' },
    initiatedAt: '2026-07-01T10:00:00.000Z',
    settledAt: '2026-07-01T10:00:05.000Z',
    nibssSessionId: null,
    errorMessage: null,
    agentNote: null,
    anomalyScore: null,
    geolocation: null,
    ...overrides,
  };
}

function props(): ComponentProps<typeof TransactionDetailScreen> {
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
    route: { params: { transactionId: 't1' }, key: 'k', name: 'TransactionDetail' },
  } as unknown as ComponentProps<typeof TransactionDetailScreen>;
}

async function renderResolved(txn: TransactionDetail) {
  h.getById.mockResolvedValue({ transaction: txn });
  let rendered!: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(<TransactionDetailScreen {...props()} />);
  });
  return rendered;
}

describe('TransactionDetailScreen — fee cover line', () => {
  it('shows "Bank fee covered" with the formatted fee for a top-up', async () => {
    const { root } = await renderResolved(baseTxn({ kind: 'topup', inflowFeeAbsorbedKobo: '5000' }));
    expect(textContent(root)).toContain('Bank fee covered: ₦50.00 ✓');
  });

  it('hides the line for a top-up with zero absorbed fee', async () => {
    const { root } = await renderResolved(baseTxn({ kind: 'topup', inflowFeeAbsorbedKobo: '0' }));
    expect(textContent(root)).not.toContain('Bank fee covered');
  });

  it('hides the line for a spend', async () => {
    const { root } = await renderResolved(
      baseTxn({ kind: 'spend', inflowFeeAbsorbedKobo: null, vendorResolvedName: 'MTN' }),
    );
    expect(textContent(root)).not.toContain('Bank fee covered');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @amana/principal exec vitest run src/screens/TransactionDetailScreen.test.tsx`
Expected: FAIL — first test can't find `Bank fee covered: ₦50.00 ✓` (line not rendered yet). The other two already pass (nothing rendered), which is fine.

- [ ] **Step 3: Add the fee-cover line to the screen**

In `apps/principal/src/screens/TransactionDetailScreen.tsx`, insert this block immediately **after** the details `<Card style={{ gap: 12 }}>...</Card>` (the one containing the `Row` components) and before the `agentNote` card:

```tsx
      {txn.kind === 'topup' &&
      txn.inflowFeeAbsorbedKobo !== null &&
      BigInt(txn.inflowFeeAbsorbedKobo) > 0n ? (
        <Card accessible accessibilityLabel={`Bank fee covered ${formatNaira(txn.inflowFeeAbsorbedKobo)}`}>
          <Body style={{ color: theme.colors.credit }}>
            {`Bank fee covered: ${formatNaira(txn.inflowFeeAbsorbedKobo)} ✓`}
          </Body>
        </Card>
      ) : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @amana/principal exec vitest run src/screens/TransactionDetailScreen.test.tsx`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Run the full principal suite + typecheck + lint**

Run:
```bash
pnpm --filter @amana/principal exec vitest run
pnpm --filter @amana/principal typecheck
pnpm exec biome check apps/principal packages/ui
```
Expected: PASS / no lint errors. (If Biome reports formatting, run `pnpm exec biome check --write apps/principal packages/ui` and re-commit.)

- [ ] **Step 6: Commit**

```bash
git add apps/principal/src/screens/TransactionDetailScreen.tsx apps/principal/src/screens/TransactionDetailScreen.test.tsx
git commit -m "feat(principal): show bank-fee-covered line on top-up detail"
```

---

## Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Rebuild shared packages (types changed in Task 1)**

Run:
```bash
pnpm --filter @amana/types build
pnpm --filter @amana/api-client build
```
Expected: exit 0.

- [ ] **Step 2: Run backend tests (Postgres must be up)**

Run: `pnpm --filter @amana/backend test`
Expected: PASS (includes the extended `detail.service.test.ts`).

- [ ] **Step 3: Run UI + Principal tests**

Run:
```bash
pnpm --filter @amana/ui exec vitest run
pnpm --filter @amana/principal exec vitest run
```
Expected: PASS.

- [ ] **Step 4: Repo-wide typecheck + lint**

Run:
```bash
pnpm --filter @amana/backend typecheck
pnpm --filter @amana/principal typecheck
pnpm exec biome check .
```
Expected: PASS / clean.

- [ ] **Step 5: Backend coverage gate (guard against dropping below thresholds)**

Run: `pnpm --filter @amana/backend test:coverage`
Expected: PASS — lines/statements ≥ 92, functions ≥ 90, branches ≥ 80.

- [ ] **Step 6: Final commit (only if lint auto-fixed anything)**

```bash
git add -A
git commit -m "chore: biome autofix for fee-cover UI"
```

---

## Self-Review

**1. Spec coverage** (task brief is the spec — see open question #1):

| Brief requirement | Task |
|---|---|
| api-client: surface `feesCoveredKobo` on household response type | Task 1 (`MasterWalletSummary.feesCoveredKobo`); already returned by the route, no client-method change needed |
| api-client: surface `inflowFeeAbsorbedKobo` on top-up txn type | Task 1 (`TransactionDetail.inflowFeeAbsorbedKobo`) + Task 2 (backend actually returns it) |
| `FeeCoverCard` in `@amana/ui` with props, a11yRole/Label, formatNaira-style formatting, component test | Task 3 (component + 4 tests); formatting done by caller via shared `formatNaira` (Task 4), matching `BalanceCard`'s pre-formatted-string convention |
| Wire card into home screen fed by household query/store, with a screen test mocking api-client | Task 6 (fed by `useHouseholdStore().masterWallet.feesCoveredKobo`; screen test mocks the store, matching `HomeDashboardScreen.test.tsx`'s existing store-only pattern) |
| Per-top-up "Bank fee covered: ₦X ✓" line on top-up success screen, with a test | Task 7 (rendered on `TransactionDetailScreen` for `kind==='topup'` — the de-facto receipt; test mocks `../lib/api`) |
| Follow test harness + accessibility conventions | Tasks 3/6/7 use `render`/`byLabel`/`byRole`/`textContent`, `accessibilityRole`/`accessibilityLabel`, and the `react/jsx` + RN mock aliases already configured in each `vitest.config.ts` |

No requirement is left without a task.

**2. Placeholder scan:** No `TBD`/`TODO`/`implement later`/"add error handling"/"similar to Task N" strings. Every code step contains complete, copy-pasteable code and every command has an expected result. The only "not shown in full" edits are single-line insertions into existing files, and each quotes the surrounding anchor lines.

**3. Type consistency:**
- `feesCoveredKobo?: string` (optional) — defined Task 1, guarded with `!== undefined` in Task 6. Consistent.
- `inflowFeeAbsorbedKobo: string | null` — defined Task 1, returned Task 2 (`row.inflow_fee_absorbed_kobo`), consumed Task 7 with `!== null && BigInt(...) > 0n`. Consistent name/shape across backend Row (`inflow_fee_absorbed_kobo`), DTO field, and UI guard.
- `FeeCoverCard` props `{ amount: string; onPress?: () => void }` — identical in Task 3 definition and Task 6 usage.
- `formatNaira(amountKoboStr: string): string` — defined Task 4, imported unchanged in Tasks 4/6/7.
- `MainStackParamList.FeeCoverInfo: undefined` — defined Task 5, navigated as `navigation.navigate('FeeCoverInfo')` in Task 6. Consistent.
- Home test's `masterWallet` mock gains `feesCoveredKobo: '482000'` → `formatNaira` → `'₦4,820.00'`, matching the asserted card text and label. Consistent.

**Open questions / assumptions:**
1. **Spec file absent.** `docs/superpowers/specs/2026-07-01-fee-cover-design.md` does not exist; this plan uses the task brief as the spec. If a real spec surfaces, reconcile copy/behaviour (esp. the hero decimal format and the tap destination).
2. **No dedicated top-up success screen** — the per-top-up line lives on `TransactionDetailScreen` (`kind==='topup'`), the receipt reached from the notifications inbox / deep links. If a top-up success flow is later added, move/duplicate the line there.
3. **Backend bridge counted as in-scope** — the brief said the backend "already" exposes both fields, but `inflowFeeAbsorbedKobo` was not on the detail DTO (`feesCoveredKobo` was). Task 2 adds the ~3-line backend bridge; if that must ship separately, land Task 2 first, then Tasks 3–7.
4. **Hero tap destination inferred** — routes to a static `FeeCoverInfoScreen` explainer modal (Task 5). If product wants a fee-history list instead, that needs a new endpoint (out of scope here).
5. **2-decimal formatting** for the hero (`₦4,820.00`) vs the brief's illustrative `₦4,820`, chosen for consistency with every other money surface.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-fee-cover-mobile-ui.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
