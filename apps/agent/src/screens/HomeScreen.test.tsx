import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { allByRole, flush, render, textContent } from '../../test/render';

vi.mock('../lib/api', () => ({
  api: {
    subWallet: {
      getTransactions: vi.fn().mockResolvedValue({
        transactions: [
          {
            id: 't1',
            kind: 'spend',
            status: 'settled',
            amountKobo: '50000',
            vendorResolvedName: 'MTN',
            vendorAccountMasked: null,
            initiatedAt: '2026-06-20T10:00:00.000Z',
            settledAt: null,
          },
        ],
      }),
    },
  },
}));

vi.mock('../state/agent.store', () => {
  const state = { selectedSubWallet: { id: 'sw1', name: 'Driver' } };
  const useAgentStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state },
  );
  return { useAgentStore };
});

import { HomeScreen } from './HomeScreen';

function props(): ComponentProps<typeof HomeScreen> {
  return {
    navigation: { navigate: vi.fn() },
    route: { params: {}, key: 'k', name: 'Home' },
  } as unknown as ComponentProps<typeof HomeScreen>;
}

describe('HomeScreen', () => {
  it('renders the balance card with the sub-wallet name', () => {
    const { root } = render(<HomeScreen {...props()} />);
    expect(textContent(root)).toContain('Driver');
    expect(textContent(root)).toContain('SUB-WALLET');
  });

  it('loads transactions and renders accessible, pressable rows', async () => {
    const { root } = render(<HomeScreen {...props()} />);
    await flush();
    expect(textContent(root)).toContain('MTN');
    // The TransactionRow exposes a button role + descriptive label.
    const rows = allByRole(root, 'button');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => String(r.props.accessibilityLabel).includes('MTN'))).toBe(true);
  });
});
