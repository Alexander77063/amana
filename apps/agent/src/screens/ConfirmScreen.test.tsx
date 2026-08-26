import { SPEND_CATEGORIES } from '@amana/types';
import type { ComponentProps } from 'react';
import { type ReactTestInstance, act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, textContent } from '../../test/render';

/**
 * Label query that counts HOST elements only.
 *
 * The shared `allByLabel` helper calls `findAll`, which defaults to `deep: true` and so counts BOTH
 * the react-native mock's forwardRef wrapper and the host element it renders — every accessible
 * node comes back twice, and "exactly one badge" becomes a coin flip on 1 vs 2. Task 5 solved that
 * locally with `{ deep: false }`, but that trades the double-count for a blind spot: `deep: false`
 * stops descending at the first match, so a SECOND copy of the label nested inside the first — a
 * real double-announcement bug for a screen reader — goes uncounted.
 *
 * Filtering to `typeof n.type === 'string'` fixes both: exactly one host element per rendered node,
 * and nested duplicates still counted. Kept local rather than pushed into `test/render.tsx`, which
 * `AccountEntryScreen.test.tsx`, `HomeScreen.test.tsx` and the principal/ui copies all depend on.
 */
const propsOf = (n: ReactTestInstance): Record<string, unknown> =>
  (n.props ?? {}) as Record<string, unknown>;
const allByLabel = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
  root.findAll((n) => typeof n.type === 'string' && propsOf(n).accessibilityLabel === label);

// `vi.mock` factories are hoisted above every import, so the spies they close over must be hoisted
// with them — a plain `const` declared above the factory is still in its TDZ when the factory runs.
const { createIntent, evaluate } = vi.hoisted(() => ({
  createIntent: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: { transaction: { createIntent, evaluate } } }));

vi.mock('../state/agent.store', () => {
  const state = { selectedSubWallet: { id: 'sw1', name: 'Driver', masterWalletId: 'mw1' } };
  const useAgentStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state },
  );
  return { useAgentStore };
});

import { ConfirmScreen } from './ConfirmScreen';

const BADGE = 'Verified Amana vendor';
const AMOUNT = 'AMOUNT (₦)';
const SUBMIT = 'CONFIRM PAYMENT';

const BASE = {
  resolvedName: 'MAMA PUT KITCHEN',
  bankCode: '058',
  accountNumber: '0123456789',
  accountMasked: '****6789',
};

/** Build the screen's navigation/route props over the four params every capture path supplies. */
function propsWith(
  params: Partial<{ vendorId: string | null; category: string | null }> | undefined,
  nav: { replace?: ReturnType<typeof vi.fn> } = {},
): ComponentProps<typeof ConfirmScreen> {
  return {
    navigation: { replace: nav.replace ?? vi.fn(), navigate: vi.fn(), goBack: vi.fn() },
    route: { params: { ...BASE, ...(params ?? {}) }, key: 'k', name: 'Confirm' },
  } as unknown as ComponentProps<typeof ConfirmScreen>;
}

const labelOf = (value: string): string =>
  SPEND_CATEGORIES.find((c) => c.value === value)?.label ?? value;

/** Which category chip is currently selected, as its stored value. */
function selectedCategory(root: ReactTestInstance): string | null {
  for (const c of SPEND_CATEGORIES) {
    const chip = allByLabel(root, c.label)[0];
    const state = chip?.props.accessibilityState as { selected?: boolean } | undefined;
    if (state?.selected) return c.value;
  }
  return null;
}

async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await flush();
}

/** Type an amount, then confirm — the screen bails before `createIntent` on a bad amount. */
async function pay(root: ReactTestInstance, naira: string): Promise<void> {
  const input = allByLabel(root, AMOUNT)[0];
  if (!input) throw new Error('amount input not found');
  await act(async () => {
    (input.props.onChangeText as (t: string) => void)(naira);
  });
  const button = allByLabel(root, SUBMIT)[0];
  if (!button) throw new Error('confirm button not found');
  await press(button);
}

beforeEach(() => {
  createIntent.mockReset();
  evaluate.mockReset();
  createIntent.mockResolvedValue({ transactionId: 't-1', status: 'pending' });
  evaluate.mockResolvedValue({ kind: 'allow' });
});

describe('ConfirmScreen — the verified badge', () => {
  it('shows a verified badge for a registry vendor', () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    const badge = allByLabel(root, BADGE);
    expect(badge).toHaveLength(1);
    expect(badge[0]?.props.accessibilityRole).toBe('text');
  });

  it('shows NO badge when the resolution carried no registry vendor', () => {
    const { root } = render(<ConfirmScreen {...propsWith({ vendorId: null, category: null })} />);
    expect(allByLabel(root, BADGE)).toHaveLength(0);
  });

  it('shows NO badge when the capture path omits the params entirely', () => {
    // AccountEntry, PhoneLookup and recents navigate with the four base params only — `vendorId`
    // arrives `undefined`, not `null`, and an identity claim must not turn on for absence.
    const { root } = render(<ConfirmScreen {...propsWith(undefined)} />);
    expect(allByLabel(root, BADGE)).toHaveLength(0);
  });

  it('does not crowd out the resolved name — decision #16’s trust handshake', () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    expect(textContent(root)).toContain('MAMA PUT KITCHEN');
  });
});

describe('ConfirmScreen — the registry category is a pre-fill, not a lock', () => {
  it('pre-fills the category from the registry', () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    expect(selectedCategory(root)).toBe('food');
  });

  it('falls back to Other when the registry has no category', () => {
    const { root } = render(<ConfirmScreen {...propsWith({ vendorId: 'v-1', category: null })} />);
    expect(selectedCategory(root)).toBe('other');
  });

  it('falls back to Other when the params are omitted entirely', () => {
    const { root } = render(<ConfirmScreen {...propsWith(undefined)} />);
    expect(selectedCategory(root)).toBe('other');
  });

  it('leaves every category chip enabled — the server enforces, the client only suggests', () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    for (const c of SPEND_CATEGORIES) {
      const chip = allByLabel(root, c.label)[0];
      expect(chip, `${c.label} chip is missing`).toBeTruthy();
      const state = chip?.props.accessibilityState as { disabled?: boolean } | undefined;
      expect(state?.disabled, `${c.label} chip is disabled`).toBeFalsy();
    }
  });

  it('lets the payer override the pre-fill, and sends the OVERRIDE', async () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    const transport = allByLabel(root, labelOf('transport'))[0];
    if (!transport) throw new Error('transport chip not found');
    await press(transport);

    expect(selectedCategory(root)).toBe('transport');
    await pay(root, '500');
    expect(createIntent.mock.calls[0]?.[0]).toMatchObject({ category: 'transport' });
  });

  it('sends the pre-filled category when the payer leaves it alone', async () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    await pay(root, '500');
    expect(createIntent.mock.calls[0]?.[0]).toMatchObject({ category: 'food' });
  });

  it('never pre-selects a value its own picker cannot show', async () => {
    // Both writers of `vendors.category` (the claim route and the ops route) constrain it to
    // SPEND_CATEGORY_VALUES today, so this is belt-and-braces — but `POST /transactions/intent`
    // takes `category` as free text, so an out-of-vocabulary pre-fill would leave NO chip lit and
    // then ride onto the intent unnoticed, which is exactly the silent allow/deny drift
    // `@amana/types`' closed vocabulary exists to prevent.
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'not_a_category' })} />,
    );
    expect(selectedCategory(root)).toBe('other');
    await pay(root, '500');
    expect(createIntent.mock.calls[0]?.[0]).toMatchObject({ category: 'other' });
  });
});

/**
 * `vendorId` is an OUTPUT. It rides the navigation params so this screen can show a verified badge,
 * and it must never reach the spend intent: a client-chosen vendor id would let a payer select
 * which merchant's category rules get applied to their own spend. The server re-resolves the vendor
 * from the bank code and account number for exactly that reason.
 *
 * The type system does NOT protect this. `{ ...route.params }` inside the intent literal typechecks
 * green — TypeScript exempts spreads from excess-property checking — so `vendorId` would reach the
 * wire with nothing complaining. The assertion has to be on the runtime VALUE, and on the exact key
 * set rather than on `vendorId` alone: a spread smuggles `resolvedName`, `accountMasked` and the
 * rest along with it, and only an exact set catches those too.
 */
describe('ConfirmScreen — vendorId never reaches the wire', () => {
  const INTENT_KEYS = [
    'masterWalletId',
    'subWalletId',
    'amountKobo',
    'idempotencyKey',
    'vendorBankCode',
    'vendorAccountNumber',
    'vendorResolvedName',
    'category',
    'agentNote',
    'geolocation',
  ];

  it('sends exactly the CreateIntentInput keys, and nothing from the route params', async () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    await pay(root, '500');

    const body = createIntent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toBeTruthy();
    expect(Object.keys(body).sort()).toEqual([...INTENT_KEYS].sort());
    expect(Object.keys(body)).not.toContain('vendorId');
  });

  it('still sends the vendor account itself — the server re-resolves from these', async () => {
    const { root } = render(
      <ConfirmScreen {...propsWith({ vendorId: 'v-1', category: 'food' })} />,
    );
    await pay(root, '500');

    expect(createIntent.mock.calls[0]?.[0]).toMatchObject({
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'MAMA PUT KITCHEN',
    });
  });
});
